/**
 * @fileoverview Live equity quotes for Clustr — Yahoo bulk first.
 *
 * Primary: Yahoo Finance quote API (many symbols per request).
 * Fallback: Yahoo chart API (single symbol).
 * Last resort: QUOTE_API_URL (clever-api) if Yahoo is blocked (CORS).
 */

(function () {
  const CACHE_TTL_MS = 90 * 1000;
  const FAIL_TTL_MS = 15 * 1000;
  const BULK_CHUNK = 40;
  const SINGLE_CONCURRENCY = 4;
  const MAX_RETRIES = 2;

  /** @type {Map<string, {data: Quote|null, expires: number}>} */
  const cache = new Map();
  /** @type {Map<string, Promise<Quote|null>>} */
  const inflight = new Map();

  let activeFetches = 0;
  /** @type {Array<() => void>} */
  const waitQueue = [];

  /**
   * @typedef {Object} Quote
   * @property {number|null} price
   * @property {number|null} changePercent
   * @property {string} [symbol]
   * @property {string} [name]
   */

  function key(symbol) {
    return String(symbol || '')
      .trim()
      .toUpperCase();
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function quoteBaseUrl() {
    const cfg = window.ClustrConfig || {};
    return String(cfg.QUOTE_API_URL || '').replace(/\/$/, '');
  }

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

  function putCache(symbol, data) {
    cache.set(key(symbol), {
      data,
      expires: Date.now() + (data ? CACHE_TTL_MS : FAIL_TTL_MS)
    });
  }

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
   * Yahoo v7 bulk quote — many tickers in one call.
   * @param {string[]} symbols
   * @returns {Promise<Object.<string, Quote|null>>}
   */
  async function fetchYahooBulk(symbols) {
    const list = symbols.map(key).filter(Boolean);
    /** @type {Object.<string, Quote|null>} */
    const out = {};
    if (!list.length) return out;

    for (let i = 0; i < list.length; i += BULK_CHUNK) {
      const chunk = list.slice(i, i + BULK_CHUNK);
      const url =
        'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' +
        encodeURIComponent(chunk.join(',')) +
        '&fields=regularMarketPrice,regularMarketChangePercent,shortName,longName,symbol';

      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('yahoo bulk HTTP ' + res.status);

      const json = await res.json();
      const results =
        (json &&
          json.quoteResponse &&
          Array.isArray(json.quoteResponse.result) &&
          json.quoteResponse.result) ||
        [];

      const found = new Set();
      for (const row of results) {
        const sym = key(row.symbol);
        if (!sym) continue;
        found.add(sym);
        const price =
          row.regularMarketPrice != null
            ? Number(row.regularMarketPrice)
            : null;
        const changePercent =
          row.regularMarketChangePercent != null
            ? Number(row.regularMarketChangePercent)
            : null;
        if (price == null && changePercent == null) {
          out[sym] = null;
          continue;
        }
        out[sym] = {
          symbol: sym,
          name: row.shortName || row.longName || sym,
          price,
          changePercent
        };
      }
      for (const sym of chunk) {
        if (!(sym in out)) out[sym] = null;
      }
    }
    return out;
  }

  /**
   * Yahoo chart API — single symbol.
   * @param {string} symbol
   * @returns {Promise<Quote|null>}
   */
  async function fetchYahooChart(symbol) {
    const sym = key(symbol);
    if (!sym) return null;

    const url =
      'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(sym) +
      '?interval=1d&range=5d';

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('yahoo chart HTTP ' + res.status);

    const json = await res.json();
    const result =
      json && json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.meta) return null;

    const meta = result.meta;
    const price =
      meta.regularMarketPrice != null
        ? Number(meta.regularMarketPrice)
        : meta.previousClose != null
          ? Number(meta.previousClose)
          : null;
    const prev =
      meta.chartPreviousClose != null
        ? Number(meta.chartPreviousClose)
        : meta.previousClose != null
          ? Number(meta.previousClose)
          : null;

    let changePercent = null;
    if (price != null && prev != null && prev !== 0) {
      changePercent = ((price - prev) / prev) * 100;
    }
    if (price == null && changePercent == null) return null;

    return {
      symbol: sym,
      name: meta.longName || meta.shortName || sym,
      price,
      changePercent
    };
  }

  /**
   * clever-api fallback (single).
   * @param {string} symbol
   * @returns {Promise<Quote|null>}
   */
  async function fetchClever(symbol) {
    const base = quoteBaseUrl();
    const sym = key(symbol);
    if (!base || !sym) return null;

    const url = `${base}?symbol=${encodeURIComponent(sym)}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error('clever HTTP ' + res.status);
    const json = await res.json();
    const price = json.price ?? json.c ?? json.regularMarketPrice ?? null;
    const changePercent =
      json.changePercent ?? json.dp ?? json.regularMarketChangePercent ?? null;
    if (price == null && changePercent == null) return null;
    return {
      symbol: sym,
      name: json.name || json.shortName || sym,
      price: price != null ? Number(price) : null,
      changePercent: changePercent != null ? Number(changePercent) : null
    };
  }

  /**
   * Single symbol: Yahoo chart → clever-api.
   * @param {string} symbol
   * @returns {Promise<Quote|null>}
   */
  async function fetchSingle(symbol) {
    const sym = key(symbol);
    if (!sym) return null;

    await acquireSlot();
    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const q = await fetchYahooChart(sym);
          if (q) return q;
        } catch (e) {
          if (attempt === MAX_RETRIES) {
            try {
              return await fetchClever(sym);
            } catch (e2) {
              return null;
            }
          }
          await sleep(200 * (attempt + 1));
        }
      }
      try {
        return await fetchClever(sym);
      } catch (e) {
        return null;
      }
    } finally {
      releaseSlot();
    }
  }

  /**
   * @param {string} symbol
   * @returns {Promise<Quote|null>}
   */
  async function getQuote(symbol) {
    const s = key(symbol);
    if (!s) return null;

    const cached = getCached(s);
    if (cached !== undefined) return cached;

    if (inflight.has(s)) return inflight.get(s);

    const p = fetchSingle(s)
      .then(data => {
        putCache(s, data);
        inflight.delete(s);
        return data;
      })
      .catch(() => {
        putCache(s, null);
        inflight.delete(s);
        return null;
      });

    inflight.set(s, p);
    return p;
  }

  /**
   * Bulk quotes — Yahoo bulk first, then fill gaps.
   * @param {string[]} symbols
   * @returns {Promise<Object.<string, Quote|null>>}
   */
  async function getQuotes(symbols) {
    const uniq = [...new Set((symbols || []).map(key).filter(Boolean))];
    /** @type {Object.<string, Quote|null>} */
    const out = {};
    if (!uniq.length) return out;

    const need = [];
    for (const s of uniq) {
      const cached = getCached(s);
      if (cached !== undefined) out[s] = cached;
      else need.push(s);
    }
    if (!need.length) return out;

    // 1) Yahoo bulk
    try {
      const bulk = await fetchYahooBulk(need);
      for (const s of need) {
        const q = bulk[s] ?? null;
        if (q) {
          out[s] = q;
          putCache(s, q);
        }
      }
    } catch (err) {
      console.warn('ClustrQuotes: Yahoo bulk failed', err.message || err);
    }

    // 2) Fill gaps via single (Yahoo chart / clever)
    const missing = need.filter(s => !out[s]);
    if (missing.length) {
      await Promise.all(
        missing.map(async s => {
          const q = await getQuote(s);
          out[s] = q;
        })
      );
    }

    return out;
  }

  function clearQuoteCache() {
    cache.clear();
    inflight.clear();
  }

  function isEnabled() {
    // Always "enabled" — Yahoo is primary, clever is optional fallback
    return true;
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
