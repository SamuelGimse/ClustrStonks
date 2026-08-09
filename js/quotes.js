/**
 * @fileoverview Live equity quotes for Clustr.
 *
 * Prefer one bulk request to QUOTE_API_URL (server runs Yahoo chart fetches).
 * Falls back to concurrent single-symbol requests. Client cache + inflight dedupe.
 *
 * Edge function contract (recommended):
 *   GET /?symbols=AAPL,MSFT,XOM
 *   → { "AAPL": { "price": 190.1, "changePercent": 1.2 }, ... }
 *   or { "quotes": { "AAPL": {...} } }
 *
 * Legacy single:
 *   GET /?symbol=AAPL → { "price": 190.1, "changePercent": 1.2 }
 */

(function () {
  /** @constant {number} Cache time-to-live in ms. */
  const CACHE_TTL_MS = 90 * 1000;

  /** @constant {number} Short TTL when edge returns empty / error. */
  const FAIL_TTL_MS = 12 * 1000;

  /** @constant {number} Max symbols per bulk HTTP call. */
  const BULK_CHUNK = 40;

  /**
   * Keep low — clever-api / Yahoo dies under parallel load (HTTP 502).
   * Global across the whole page, not per getQuotes call.
   * @constant {number}
   */
  const SINGLE_CONCURRENCY = 2;

  /** @constant {number} Retries for 502/503/429. */
  const MAX_RETRIES = 3;

  /**
   * clever-api currently only supports ?symbol= (singular).
   * @type {boolean}
   */
  let bulkSupported = false;

  /** Global request slots so many clusters don't open 40 fetches at once. */
  let activeFetches = 0;
  /** @type {Array<() => void>} */
  const waitQueue = [];

  /** @type {Map<string, {data: Quote|null, expires: number}>} */
  const cache = new Map();

  /** @type {Map<string, Promise<Quote|null>>} */
  const inflight = new Map();

  /**
   * @typedef {Object} Quote
   * @property {number|null} price
   * @property {number|null} changePercent
   * @property {string} [symbol]
   * @property {string} [name]
   */

  /**
   * @returns {string}
   */
  function quoteBaseUrl() {
    const cfg = window.ClustrConfig || {};
    return String(cfg.QUOTE_API_URL || '').replace(/\/$/, '');
  }

  /**
   * @returns {Record<string, string>}
   */
  function authHeaders() {
    const cfg = window.ClustrConfig || {};
    const headers = { Accept: 'application/json' };
    const anon = cfg.SUPABASE_ANON_KEY;
    if (anon) {
      headers.Authorization = `Bearer ${anon}`;
      headers.apikey = anon;
    }
    return headers;
  }

  /**
   * @param {string} symbol
   * @returns {string}
   */
  function key(symbol) {
    return String(symbol || '')
      .trim()
      .toUpperCase();
  }

  /**
   * Normalize one quote object from various API shapes.
   * @param {string} symbol
   * @param {Object|null|undefined} raw
   * @returns {Quote|null}
   */
  function normalizeQuote(symbol, raw) {
    if (!raw || typeof raw !== 'object') return null;
    const price = raw.price ?? raw.c ?? raw.regularMarketPrice ?? null;
    const changePercent =
      raw.changePercent ?? raw.dp ?? raw.regularMarketChangePercent ?? null;
    if (price == null && changePercent == null) return null;
    return {
      symbol: key(symbol),
      name: raw.name || raw.shortName || raw.longName || symbol,
      price: price != null ? Number(price) : null,
      changePercent: changePercent != null ? Number(changePercent) : null
    };
  }

  /**
   * Parse bulk response into a symbol → Quote map.
   * @param {Object} json
   * @param {string[]} requested
   * @returns {Object.<string, Quote|null>}
   */
  function parseBulkBody(json, requested) {
    /** @type {Object.<string, Quote|null>} */
    const out = {};
    if (!json || typeof json !== 'object') return out;

    const bag =
      json.quotes && typeof json.quotes === 'object'
        ? json.quotes
        : json.data && typeof json.data === 'object'
          ? json.data
          : json;

    for (const sym of requested) {
      const raw = bag[sym] ?? bag[sym.toLowerCase()] ?? null;
      out[sym] = normalizeQuote(sym, raw);
    }

    // Single-quote shaped body when only one symbol was requested
    if (requested.length === 1 && out[requested[0]] == null) {
      out[requested[0]] = normalizeQuote(requested[0], json);
    }
    return out;
  }

  /**
   * Bulk fetch via edge function (Yahoo runs server-side).
   * @param {string[]} symbols
   * @returns {Promise<Object.<string, Quote|null>>}
   */
  async function fetchBulkChunk(symbols) {
    const base = quoteBaseUrl();
    if (!base || !symbols.length) return {};

    const url =
      `${base}?symbols=${encodeURIComponent(symbols.join(','))}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error('bulk quote HTTP ' + res.status);
    const json = await res.json();
    return parseBulkBody(json, symbols);
  }

  /**
   * Acquire a global fetch slot (max SINGLE_CONCURRENCY).
   * @returns {Promise<void>}
   */
  function acquireSlot() {
    if (activeFetches < SINGLE_CONCURRENCY) {
      activeFetches += 1;
      return Promise.resolve();
    }
    return new Promise(resolve => {
      waitQueue.push(() => {
        activeFetches += 1;
        resolve();
      });
    });
  }

  function releaseSlot() {
    activeFetches = Math.max(0, activeFetches - 1);
    const next = waitQueue.shift();
    if (next) next();
  }

  /**
   * Sleep helper.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Single-symbol fetch with global throttle + retry on 502/503/429.
   * @param {string} symbol
   * @returns {Promise<Quote|null>}
   */
  async function fetchSingleRaw(symbol) {
    const base = quoteBaseUrl();
    if (!base || !symbol) return null;
    const url = `${base}?symbol=${encodeURIComponent(symbol)}`;

    await acquireSlot();
    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await fetch(url, { headers: authHeaders() });
          if (res.status === 502 || res.status === 503 || res.status === 429) {
            if (attempt < MAX_RETRIES) {
              await sleep(400 * Math.pow(2, attempt) + Math.random() * 200);
              continue;
            }
            return null;
          }
          if (!res.ok) return null;
          const json = await res.json();
          return normalizeQuote(symbol, json);
        } catch {
          if (attempt < MAX_RETRIES) {
            await sleep(400 * Math.pow(2, attempt));
            continue;
          }
          return null;
        }
      }
      return null;
    } finally {
      releaseSlot();
    }
  }

  /**
   * Run async workers over a list with fixed concurrency.
   * @template T,R
   * @param {T[]} items
   * @param {number} concurrency
   * @param {(item: T, index: number) => Promise<R>} fn
   * @returns {Promise<R[]>}
   */
  async function mapPool(items, concurrency, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }
    const n = Math.min(concurrency, Math.max(items.length, 1));
    await Promise.all(Array.from({ length: n }, () => worker()));
    return results;
  }

  /**
   * Write quote into cache.
   * @param {string} symbol
   * @param {Quote|null} data
   */
  function putCache(symbol, data) {
    cache.set(key(symbol), {
      data,
      expires: Date.now() + (data ? CACHE_TTL_MS : FAIL_TTL_MS)
    });
  }

  /**
   * Read quote from cache if still valid.
   * @param {string} symbol
   * @returns {Quote|null|undefined} undefined = miss
   */
  function getCached(symbol) {
    const hit = cache.get(key(symbol));
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      cache.delete(key(symbol));
      return undefined;
    }
    return hit.data;
  }

  /**
   * Get one live quote (cache → inflight → network).
   * @param {string} symbol
   * @returns {Promise<Quote|null>}
   */
  async function getQuote(symbol) {
    const s = key(symbol);
    if (!s) return null;
    if (!quoteBaseUrl()) return null;

    const cached = getCached(s);
    if (cached !== undefined) return cached;

    if (inflight.has(s)) return inflight.get(s);

    const p = fetchSingleRaw(s)
      .then(data => {
        putCache(s, data);
        inflight.delete(s);
        return data;
      })
      .catch(() => {
        inflight.delete(s);
        return null;
      });

    inflight.set(s, p);
    return p;
  }

  /**
   * Bulk live quotes for many symbols (preferred path).
   * Uses chunked `?symbols=` then fills gaps with concurrent singles.
   *
   * @param {string[]} symbols
   * @param {{ chunkSize?: number, concurrency?: number }} [opts]
   * @returns {Promise<Object.<string, Quote|null>>}
   */
  async function getQuotes(symbols, opts = {}) {
    const chunkSize = opts.chunkSize || BULK_CHUNK;
    const concurrency = opts.concurrency || SINGLE_CONCURRENCY;
    const uniq = [
      ...new Set((symbols || []).map(key).filter(Boolean))
    ];

    /** @type {Object.<string, Quote|null>} */
    const out = {};
    if (!uniq.length || !quoteBaseUrl()) return out;

    const need = [];
    for (const s of uniq) {
      const cached = getCached(s);
      if (cached !== undefined) out[s] = cached;
      else need.push(s);
    }
    if (!need.length) return out;

    // Bulk only if edge function supports ?symbols=
    if (bulkSupported) {
      for (let i = 0; i < need.length; i += chunkSize) {
        const chunk = need.slice(i, i + chunkSize);
        try {
          const part = await fetchBulkChunk(chunk);
          for (const s of chunk) {
            const q = part[s] ?? null;
            out[s] = q;
            putCache(s, q);
          }
        } catch (err) {
          console.warn(
            'ClustrQuotes bulk failed — using single-symbol path',
            err.message || err
          );
          bulkSupported = false;
          break;
        }
      }
    }

    // Sequential-ish singles (global slot pool caps real parallelism)
    const missing = need.filter(s => out[s] === undefined || out[s] === null);
    if (missing.length) {
      const limit = Math.min(concurrency, SINGLE_CONCURRENCY);
      await mapPool(missing, limit, async sym => {
        const q = await getQuote(sym);
        out[sym] = q;
      });
    }

    return out;
  }

  /**
   * Clear in-memory quote cache.
   * @returns {void}
   */
  function clearQuoteCache() {
    cache.clear();
    inflight.clear();
  }

  /**
   * @returns {boolean}
   */
  function isEnabled() {
    return Boolean(quoteBaseUrl());
  }

  window.ClustrQuotes = {
    getQuote,
    getQuotes,
    clearQuoteCache,
    isEnabled
  };

  /** @deprecated */
  window.EventlineQuotes = window.ClustrQuotes;
})();
