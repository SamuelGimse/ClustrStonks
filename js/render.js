/**
 * @fileoverview Event clusters, movers strip, country panels, days list.
 */

(function () {
  const U = () => window.ClustrUtil;

  /**
   * Average % since publish for a stock list (uses priceAtPublish vs live).
   * @param {Array<Object>} list
   * @returns {Promise<number|null>}
   */
  async function averageSincePublish(list) {
    const stocks = list || [];
    if (!stocks.length || !window.ClustrQuotes) return null;

    const slice = stocks.slice(0, 12);
    const symbols = slice.map(s => s.symbol).filter(Boolean);
    const quotes = await window.ClustrQuotes.getQuotes(symbols);
    const deltas = [];

    for (const s of slice) {
      const pub = s.priceAtPublish ?? s.price;
      if (pub == null || Number(pub) === 0) continue;
      const live = quotes[U().normalizeSymbol(s.symbol)];
      if (!live || live.price == null) continue;
      deltas.push(
        ((Number(live.price) - Number(pub)) / Number(pub)) * 100
      );
    }
    if (!deltas.length) return null;
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
  }

  /**
   * @deprecated use averageSincePublish on fixed_stocks
   * @param {Object} group
   * @returns {Promise<number|null>}
   */
  async function sectorDefaultSincePublish(group) {
    return averageSincePublish(group.fixed_stocks || group.default_stocks || []);
  }

  /**
   * History rows for same-named clusters across publishes (oldest → newest).
   * Includes cluster-default stock snapshots for price math.
   * @param {string} clusterName
   * @returns {Array<Object>}
   */
  function stanceHistoryForCluster(clusterName) {
    const name = String(clusterName || '').trim().toLowerCase();
    if (!name) return [];
    const publishes =
      (window.ClustrApp && typeof window.ClustrApp.getPublishes === 'function'
        ? window.ClustrApp.getPublishes()
        : []) || [];

    /** @type {Array} */
    const rows = [];
    const ordered = publishes.slice().reverse();
    for (const p of ordered) {
      const groups = p.groups_json || p.groups || [];
      const match = groups.find(
        g => String(g.name || '').trim().toLowerCase() === name
      );
      if (!match) continue;
      const defaults =
        match.fixed_stocks || match.default_stocks || [];
      rows.push({
        stance: String(match.stance || 'watch').toLowerCase(),
        confidence: String(match.confidence || '').toLowerCase(),
        horizon: String(match.time_horizon || '').toLowerCase(),
        date: p.created_at || '',
        title: p.title || '',
        defaults: defaults.map(s => ({
          symbol: s.symbol,
          priceAtPublish: s.priceAtPublish ?? s.price ?? null
        }))
      });
    }
    return rows;
  }

  /**
   * @param {string} stance
   * @returns {number}
   */
  function stanceScore(stance) {
    const s = String(stance || 'watch').toLowerCase();
    if (s === 'constructive') return 1;
    if (s === 'cautious') return 0;
    return 0.5;
  }

  /**
   * For each history row, avg % of cluster defaults from that publish price → live.
   * @param {Array<Object>} history
   * @returns {Promise<Array<Object>>}
   */
  async function attachDefaultReturns(history) {
    if (!window.ClustrQuotes || !history.length) {
      return history.map(h => ({ ...h, defaultRet: null }));
    }
    const symSet = new Set();
    for (const h of history) {
      for (const s of h.defaults || []) {
        if (s.symbol) symSet.add(U().normalizeSymbol(s.symbol));
      }
    }
    const quotes = await window.ClustrQuotes.getQuotes([...symSet]);

    return history.map(h => {
      const deltas = [];
      for (const s of h.defaults || []) {
        const pub = s.priceAtPublish;
        if (pub == null || Number(pub) === 0) continue;
        const live = quotes[U().normalizeSymbol(s.symbol)];
        if (!live || live.price == null) continue;
        deltas.push(
          ((Number(live.price) - Number(pub)) / Number(pub)) * 100
        );
      }
      const defaultRet =
        deltas.length > 0
          ? deltas.reduce((a, b) => a + b, 0) / deltas.length
          : null;
      return { ...h, defaultRet, sampleN: deltas.length };
    });
  }

  /**
   * Aggregate default returns by stance label.
   * @param {Array<Object>} enriched
   * @returns {{constructive: number|null, watch: number|null, cautious: number|null, insight: string}}
   */
  function stancePriceStats(enriched) {
    const buckets = { constructive: [], watch: [], cautious: [] };
    for (const row of enriched) {
      if (row.defaultRet == null) continue;
      const k = row.stance;
      if (buckets[k]) buckets[k].push(row.defaultRet);
    }
    const avg = arr =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const constructive = avg(buckets.constructive);
    const watch = avg(buckets.watch);
    const cautious = avg(buckets.cautious);

    let insight = 'Not enough default prices to score stance vs returns.';
    if (constructive != null || cautious != null) {
      if (
        constructive != null &&
        cautious != null &&
        constructive > cautious + 0.15
      ) {
        insight =
          'Defaults did better after Constructive stamps than Cautious — stance and basket mostly agree.';
      } else if (
        constructive != null &&
        cautious != null &&
        cautious > constructive + 0.15
      ) {
        insight =
          'Defaults held up better under Cautious stamps than Constructive — stance may be lagging price.';
      } else if (constructive != null && constructive > 0.2) {
        insight =
          'When stance was Constructive, cluster defaults are up vs those publish prints.';
      } else if (cautious != null && cautious < -0.2) {
        insight =
          'Cautious periods line up with softer default-basket performance vs publish prices.';
      } else {
        insight =
          'Stance and default-basket moves are mixed — treat stance as context, not a timer.';
      }
    }

    return { constructive, watch, cautious, insight };
  }

  /**
   * Build SVG dual chart: stance dots + default return line (normalized).
   * @param {Array<Object>} enriched
   * @returns {string}
   */
  function stancePriceChartSvg(enriched) {
    const util = U();
    const w = 300;
    const h = 120;
    const padX = 22;
    const padY = 16;
    const n = enriched.length;
    if (!n) return '';

    const rets = enriched
      .map(r => r.defaultRet)
      .filter(v => v != null && Number.isFinite(v));
    const maxAbs = rets.length
      ? Math.max(2, ...rets.map(v => Math.abs(v)))
      : 2;

    const points = enriched.map((row, i) => {
      const x =
        n === 1 ? w / 2 : padX + (i / (n - 1)) * (w - padX * 2);
      const yStance =
        padY + (1 - stanceScore(row.stance)) * (h - padY * 2);
      let yPrice = null;
      if (row.defaultRet != null) {
        const t = (row.defaultRet / maxAbs + 1) / 2; // 0..1
        yPrice = padY + (1 - t) * (h - padY * 2);
      }
      return { x, yStance, yPrice, row };
    });

    const stancePath = points
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.yStance.toFixed(1)}`
      )
      .join(' ');

    const pricePts = points.filter(p => p.yPrice != null);
    const pricePath = pricePts
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.yPrice.toFixed(1)}`
      )
      .join(' ');

    const stanceDots = points
      .map(p => {
        const color =
          p.row.stance === 'constructive'
            ? 'var(--up)'
            : p.row.stance === 'cautious'
              ? 'var(--down)'
              : 'var(--text-meta)';
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.yStance.toFixed(
          1
        )}" r="4.5" fill="${color}" stroke="var(--bg)" stroke-width="1.5"/>`;
      })
      .join('');

    const priceDots = pricePts
      .map(
        p =>
          `<circle cx="${p.x.toFixed(1)}" cy="${p.yPrice.toFixed(
            1
          )}" r="3" fill="var(--accent)" opacity="0.9"/>`
      )
      .join('');

    return `
      <svg class="stance-history-chart" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Stance and default basket returns">
        <line x1="${padX}" y1="${h / 2}" x2="${w - padX}" y2="${
      h / 2
    }" class="stance-grid" />
        <text x="2" y="${padY + 4}" class="stance-axis">C+</text>
        <text x="2" y="${h / 2 + 3}" class="stance-axis">0</text>
        <text x="2" y="${h - padY + 4}" class="stance-axis">C−</text>
        <path d="${stancePath}" class="stance-history-line" fill="none" />
        ${
          pricePath
            ? `<path d="${pricePath}" class="stance-price-line" fill="none" />`
            : ''
        }
        ${stanceDots}
        ${priceDots}
      </svg>
      <div class="stance-chart-legend">
        <span class="leg-stance">● Stance</span>
        <span class="leg-price">● Defaults → live %</span>
      </div>`;
  }

  /**
   * Async-filled panel HTML shell; content written after quotes load.
   * @param {Object} group
   * @returns {Promise<string>}
   */
  async function stanceHistoryPanelHtml(group) {
    const util = U();
    const history = stanceHistoryForCluster(group.name);
    if (history.length < 1) {
      return `<div class="stance-history-empty">No prior publishes with this cluster name yet.</div>`;
    }

    const enriched = await attachDefaultReturns(history);
    const stats = stancePriceStats(enriched);
    const chart = stancePriceChartSvg(enriched);

    const fmt = v => (v == null ? '—' : util.formatPct(v));

    const list = enriched
      .slice()
      .reverse()
      .map(row => {
        const d = row.date ? new Date(row.date).toLocaleString() : '—';
        const ret =
          row.defaultRet == null
            ? '<span class="muted">n/a</span>'
            : `<span class="${util.toneClass(row.defaultRet)}">${util.formatPct(
                row.defaultRet
              )}</span>`;
        return `<div class="stance-history-row stance-${util.escapeHtml(
          row.stance
        )}">
          <span class="stance-history-dot"></span>
          <span class="stance-history-stance">${util.escapeHtml(
            row.stance
          )}</span>
          <span class="stance-history-ret" title="Cluster defaults vs live">${ret}</span>
          <span class="stance-history-date">${util.escapeHtml(d)}</span>
        </div>`;
      })
      .join('');

    return `
      <div class="stance-history-panel">
        <div class="stance-history-title">Stance × cluster defaults</div>
        <div class="stance-history-chart-wrap">${chart}</div>
        <div class="stance-stat-grid">
          <div class="stance-stat">
            <div class="stance-stat-k">When Constructive</div>
            <div class="stance-stat-v ${util.toneClass(
              stats.constructive
            )}">${fmt(stats.constructive)}</div>
            <div class="stance-stat-h">defaults → live</div>
          </div>
          <div class="stance-stat">
            <div class="stance-stat-k">When Watch</div>
            <div class="stance-stat-v ${util.toneClass(
              stats.watch
            )}">${fmt(stats.watch)}</div>
            <div class="stance-stat-h">defaults → live</div>
          </div>
          <div class="stance-stat">
            <div class="stance-stat-k">When Cautious</div>
            <div class="stance-stat-v ${util.toneClass(
              stats.cautious
            )}">${fmt(stats.cautious)}</div>
            <div class="stance-stat-h">defaults → live</div>
          </div>
        </div>
        <p class="stance-insight">${util.escapeHtml(stats.insight)}</p>
        <div class="stance-history-list">${list}</div>
      </div>`;
  }

  /**
   * Stance badge + button (panel mounts in .stance-aside).
   * @param {Object} group
   * @param {number|null} _sectorAvg
   * @returns {string}
   */
  function stanceHtml(group, _sectorAvg) {
    const util = U();
    const stance = String(group.stance || 'watch').toLowerCase();
    const horizon = String(group.time_horizon || '').toLowerCase();
    const confidence = String(group.confidence || '').toLowerCase();

    const stanceText = {
      watch: 'Watch — monitor, no clear action yet',
      constructive: 'Constructive — possible upside if thesis holds',
      cautious: 'Cautious — higher risk / unclear payoff'
    }[stance] || 'Watch — monitor, no clear action yet';

    const horizonText = {
      days: 'Days — short-term move',
      weeks: 'Weeks — medium-term setup',
      months: 'Months — longer theme'
    }[horizon] || '';

    const confidenceText = {
      low: 'Low confidence',
      medium: 'Medium confidence',
      high: 'High confidence'
    }[confidence] || '';

    return `
      <div class="stance-wrap">
        <button type="button" class="stance-history-icon-btn" data-stance-history="1"
          title="Stance history" aria-label="Stance history">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 9-9"/>
            <path d="M3 4v5h5"/>
            <path d="M12 7v5l3 2"/>
          </svg>
        </button>
        <div class="stance stance-${util.escapeHtml(stance)}">
          <div class="stance-title">${util.escapeHtml(stanceText)}</div>
          <div class="stance-sub">${util.escapeHtml(
            [horizonText, confidenceText].filter(Boolean).join(' · ')
          )}</div>
        </div>
      </div>`;
  }

  /**
   * Stock layer buckets for a cluster.
   * @param {Object} group
   * @returns {{groups: Array<{id:string,label:string,list:Array}>, chartPool: Array}}
   */
  function stockBuckets(group) {
    const mentioned = group.mentioned_stocks || [];
    const close = group.close_stocks || group.direct_stocks || [];
    const original = group.original_stocks || group.related_stocks || [];
    const fixed = group.fixed_stocks || group.default_stocks || [];
    const winners =
      group.connected_winners ||
      (group.movers || []).filter(
        m => m.side === 'winner' || (m.changePercent != null && m.changePercent > 0)
      );
    const losers =
      group.connected_losers ||
      (group.movers || []).filter(
        m => m.side === 'loser' || (m.changePercent != null && m.changePercent < 0)
      );

    const groups = [
      { id: 'mentioned', label: 'Mentioned in articles', list: mentioned },
      { id: 'close', label: 'Close links', list: close },
      { id: 'original', label: 'Original ideas', list: original },
      { id: 'fixed', label: 'Cluster defaults', list: fixed },
      { id: 'winners', label: 'Connected winners', list: winners },
      { id: 'losers', label: 'Connected losers', list: losers }
    ].filter(g => (g.list || []).length > 0);

    const chartPool = [];
    const seen = new Set();
    for (const g of groups) {
      for (const s of g.list) {
        const sym = U().normalizeSymbol(s.symbol);
        if (!sym || seen.has(sym)) continue;
        seen.add(sym);
        chartPool.push(s);
      }
    }
    return { groups, chartPool };
  }

  /**
   * Stock bubble button HTML.
   * @param {Object} s
   * @returns {string}
   */
  function bubbleBtn(s) {
    const util = U();
    const pctVal = s.changePercent ?? s.changePercentAtPublish;
    const pct = util.formatPct(pctVal);
    const tone = util.toneClass(pctVal);
    const debt =
      s.debtToEv != null
        ? ` · Debt/EV ${(Number(s.debtToEv) * 100).toFixed(0)}%`
        : '';
    return `
      <button type="button" class="md-chip md-chip--filter ${tone}" data-symbol="${util.escapeHtml(
        s.symbol || ''
      )}" title="${util.escapeHtml((s.name || s.symbol || '') + debt)}">
        <span class="chip-label">${util.escapeHtml(s.symbol || s.name || '?')}</span>
        ${pct ? `<span class="chip-meta">${util.escapeHtml(pct)}</span>` : ''}
      </button>`;
  }

  /**
   * Publish / live / since price bar.
   * @param {string} symbol
   * @param {string} name
   * @param {number|null} publishPrice
   * @param {number|null} publishPct
   * @param {{price?: number|null, changePercent?: number|null}|null} live
   * @returns {string}
   */
  function priceBarHtml(symbol, name, publishPrice, publishPct, live) {
    const util = U();
    const livePrice = live?.price ?? null;
    const livePct = live?.changePercent ?? null;
    const since = util.deltaSincePublish(publishPrice, livePrice);
    const hasProxy = !!(window.ClustrQuotes && window.ClustrQuotes.isEnabled());

    return `
      <div class="price-bar" data-price-symbol="${util.escapeHtml(symbol)}">
        <div class="price-bar-title">${util.escapeHtml(symbol)}${
          name ? ' — ' + util.escapeHtml(name) : ''
        }</div>
        <div class="price-bar-grid">
          <div class="price-cell">
            <div class="price-label">At publish</div>
            <div class="price-value">${util.formatMoney(publishPrice)}</div>
            <div class="price-sub">${util.formatPct(publishPct) || '—'}</div>
          </div>
          <div class="price-cell">
            <div class="price-label">Live</div>
            <div class="price-value">${
              livePrice != null ? util.formatMoney(livePrice) : '—'
            }</div>
            <div class="price-sub">${
              util.formatPct(livePct) || (hasProxy ? '…' : 'quotes off')
            }</div>
          </div>
          <div class="price-cell">
            <div class="price-label">Since publish</div>
            <div class="price-value ${util.toneClass(since)}">${
              since == null ? '—' : util.formatPct(since)
            }</div>
            <div class="price-sub">signal track</div>
          </div>
        </div>
      </div>`;
  }

  /**
   * Collect unique movers across groups.
   * @param {Array<Object>} groups
   * @returns {Array<Object>}
   */
  function collectMovers(groups) {
    const map = new Map();
    for (const g of groups || []) {
      const push = (m, sideHint) => {
        const sym = U().normalizeSymbol(m.symbol);
        if (!sym) return;
        if (!map.has(sym)) {
          map.set(sym, {
            symbol: sym,
            name: m.name || sym,
            changePercent: m.changePercent,
            side: sideHint || m.side || '',
            clusterRelevance: m.clusterRelevance,
            clusters: [g.name]
          });
        } else {
          const row = map.get(sym);
          if (g.name && !row.clusters.includes(g.name)) row.clusters.push(g.name);
        }
      };
      for (const m of g.movers || []) push(m, m.side);
      for (const m of g.connected_winners || []) push(m, 'winner');
      for (const m of g.connected_losers || []) push(m, 'loser');
    }
    return [...map.values()];
  }

  /**
   * @param {Array<Object>} list
   * @param {string} mode
   * @returns {Array<Object>}
   */
  function filterMovers(list, mode) {
    if (mode === 'winners') {
      return list.filter(
        m => m.side === 'winner' || (m.changePercent != null && m.changePercent > 0)
      );
    }
    if (mode === 'losers') {
      return list.filter(
        m => m.side === 'loser' || (m.changePercent != null && m.changePercent < 0)
      );
    }
    return list
      .slice()
      .sort(
        (a, b) =>
          Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0)
      );
  }

  /**
   * @param {Array<Object>} groups
   * @param {string} mode
   * @param {(symbol: string) => void} [onPick]
   * @returns {void}
   */
  function renderMoversStrip(groups, mode, onPick) {
    const strip = document.getElementById('moversStrip');
    if (!strip) return;
    const util = U();
    const list = filterMovers(collectMovers(groups), mode || 'active');
    const body = strip.querySelector('.movers-chips');
    if (!body) return;

    body.innerHTML = list.length
      ? list
          .slice(0, 40)
          .map(m => {
            const t = util.toneClass(m.changePercent);
            return `
            <button type="button" class="md-chip md-chip--filter ${t}" data-symbol="${util.escapeHtml(
              m.symbol
            )}">
              <span class="chip-label">${util.escapeHtml(m.symbol)}</span>
              <span class="chip-meta">${util.escapeHtml(
                util.formatPct(m.changePercent) || ''
              )}</span>
            </button>`;
          })
          .join('')
      : '<span class="movers-empty">No movers in this publish</span>';

    body.querySelectorAll('[data-symbol]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (onPick) onPick(btn.getAttribute('data-symbol'));
      });
    });
  }

  /**
   * @param {Array<Object>} groups
   * @param {string} symbol
   * @returns {Array<Object>}
   */
  function clustersForSymbol(groups, symbol) {
    const s = U().normalizeSymbol(symbol);
    return (groups || []).filter(g => {
      const all = [
        ...(g.mentioned_stocks || []),
        ...(g.close_stocks || []),
        ...(g.original_stocks || []),
        ...(g.fixed_stocks || []),
        ...(g.direct_stocks || []),
        ...(g.related_stocks || []),
        ...(g.stocks || []),
        ...(g.connected_winners || []),
        ...(g.connected_losers || []),
        ...(g.movers || [])
      ];
      return all.some(x => U().normalizeSymbol(x.symbol) === s);
    });
  }

  /**
   * @param {Array<Object>} groups
   * @returns {Array<{country: string, count: number}>}
   */
  function collectCountries(groups) {
    const counts = {};
    for (const g of groups || []) {
      for (const a of g.articles || []) {
        const c = a.primary_country || 'Global';
        counts[c] = (counts[c] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * @param {Array<Object>} groups
   * @param {string} country
   * @returns {Array<Object>}
   */
  function articlesForCountry(groups, country) {
    const out = [];
    for (const g of groups || []) {
      for (const a of g.articles || []) {
        const primary = a.primary_country || 'Global';
        const list = Array.isArray(a.countries) ? a.countries : [primary];
        if (primary === country || list.includes(country)) {
          out.push({ ...a, cluster: g.name || '' });
        }
      }
    }
    const seen = new Set();
    return out.filter(a => {
      const k = (a.title || '') + '|' + (a.link || '');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /**
   * @param {string} title
   * @param {Array<Object>} clusters
   * @param {HTMLElement} mountEl
   * @returns {void}
   */
  function renderRelatedClusters(title, clusters, mountEl) {
    if (!mountEl) return;
    const util = U();
    if (mountEl.classList.contains('related-under-chart')) {
      mountEl.innerHTML = '';
    }
    let panel = mountEl.querySelector('.related-clusters-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'related-clusters related-clusters-panel';
      mountEl.appendChild(panel);
    }
    panel.innerHTML = `
      <div class="related-head">
        <div class="related-title">${util.escapeHtml(title)}</div>
        <div class="related-count">${clusters.length} cluster${
          clusters.length === 1 ? '' : 's'
        }</div>
      </div>
      <div class="related-list">
        ${
          clusters.length
            ? clusters
                .map(
                  g => `
                <button type="button" class="related-item" data-cluster="${util.escapeHtml(
                  g.name
                )}">
                  <div class="related-item-t">${util.escapeHtml(g.name)}</div>
                  <div class="related-item-s">${(g.articles || []).length} articles</div>
                </button>`
                )
                .join('')
            : '<div class="related-empty">No other clusters for this ticker</div>'
        }
      </div>`;
    panel.querySelectorAll('.related-item').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.ClustrApp) {
          window.ClustrApp.jumpToCluster(btn.getAttribute('data-cluster'));
        }
      });
    });
  }

  /**
   * Build one cluster card element.
   * @param {Object} group
   * @param {number} index
   * @param {Array<Object>} currentGroups
   * @returns {HTMLElement}
   */
  function buildGroupElement(group, index, currentGroups) {
    const util = U();
    const { groups: stockGroups, chartPool } = stockBuckets(group);
    const angles = group.opportunity_angles || group.angles || [];
    const articles = group.articles || [];
    const count = group.count || articles.length || 0;
    const defaultGroupId = stockGroups[0]?.id || '';

    const el = document.createElement('section');
    el.className = 'md-card cluster-card';
    el.dataset.cluster = group.name || '';

    el.innerHTML = `
      <div class="cluster-layout">
      <div class="cluster-main">
      <div class="cluster-top">
        <h2 class="cluster-name">${util.escapeHtml(group.name || 'Cluster')}</h2>
        <div class="stance-mount">${stanceHtml(group, null)}</div>
      </div>

      <div class="cluster-body">
        <p class="cluster-reason">${util.escapeHtml(
          group.reason || group.summary || ''
        )}</p>
        ${angles
          .map(
            a =>
              `<div class="cluster-angle">• ${util.escapeHtml(String(a))}</div>`
          )
          .join('')}

        <div class="stock-panel">
          <div class="stock-panel-head">
            <label class="md-label" for="stock-group-${index}">Stock group</label>
            <select class="md-select stock-group-select" id="stock-group-${index}">
              ${stockGroups
                .map(
                  g =>
                    `<option value="${util.escapeHtml(g.id)}">${util.escapeHtml(
                      g.label
                    )} (${g.list.length})</option>`
                )
                .join('')}
            </select>
            <div class="group-since-publish" aria-live="polite"></div>
          </div>
          <div class="bubbles-scroll stock-bubbles" role="list"></div>
        </div>

        <div class="price-bar-mount"></div>
        <div class="chart" id="chart-${index}"></div>
        <div class="related-under-chart"></div>
        <button type="button" class="md-btn md-btn--text toggle-articles">
          Show articles (${count})
        </button>
      </div>
      </div>

      <aside class="stance-aside" aria-label="Stance history panel">
        <div class="stance-history-mount hidden" hidden></div>
      </aside>
      </div>

      <div class="article-grid articles hidden">
        ${articles
          .map(
            a => `
          <article class="md-card md-card--outlined article-card">
            <h3 class="article-title">${util.escapeHtml(a.title || '')}</h3>
            <div class="article-meta">
              ${util.escapeHtml(a.source || '')}
              ${
                a.date
                  ? ' · ' + util.escapeHtml(new Date(a.date).toLocaleString())
                  : ''
              }
              ${
                a.primary_country
                  ? `<span class="country-pill">${util.escapeHtml(
                      a.primary_country
                    )}</span>`
                  : ''
              }
            </div>
            <p class="article-summary">${util.escapeHtml(
              a.short_summary || a.summary || ''
            )}</p>
            ${
              a.link
                ? `<a class="md-link" href="${util.escapeHtml(
                    a.link
                  )}" target="_blank" rel="noopener">Read →</a>`
                : ''
            }
          </article>`
          )
          .join('')}
      </div>`;

    const stanceMount = el.querySelector('.stance-mount');
    const historyBtn =
      stanceMount && stanceMount.querySelector('[data-stance-history]');
    const historyMount = el.querySelector('.stance-history-mount');
    const stanceAside = el.querySelector('.stance-aside');
    if (historyBtn && historyMount) {
      historyBtn.addEventListener('click', async () => {
        const open = historyMount.classList.contains('hidden');
        if (open) {
          historyBtn.disabled = true;
          historyMount.innerHTML =
            '<div class="stance-history-empty">Loading stance × defaults…</div>';
          historyMount.classList.remove('hidden');
          historyMount.hidden = false;
          if (stanceAside) stanceAside.classList.add('is-open');
          try {
            historyMount.innerHTML = await stanceHistoryPanelHtml(group);
          } catch (err) {
            historyMount.innerHTML =
              '<div class="stance-history-empty">Could not load history</div>';
          }
          historyBtn.disabled = false;
          historyBtn.classList.add('is-open');
          historyBtn.setAttribute('aria-pressed', 'true');
          historyBtn.title = 'Hide stance history';
          requestAnimationFrame(() => {
            const target = stanceAside || historyMount;
            if (target && typeof target.scrollIntoView === 'function') {
              target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          });
        } else {
          historyMount.innerHTML = '';
          historyMount.classList.add('hidden');
          historyMount.hidden = true;
          if (stanceAside) stanceAside.classList.remove('is-open');
          historyBtn.classList.remove('is-open');
          historyBtn.setAttribute('aria-pressed', 'false');
          historyBtn.title = 'Stance history';
        }
      });
    }

    const toggleBtn = el.querySelector('.toggle-articles');
    const articlesGrid = el.querySelector('.articles');
    toggleBtn.addEventListener('click', () => {
      const hidden = articlesGrid.classList.contains('hidden');
      articlesGrid.classList.toggle('hidden', !hidden);
      toggleBtn.textContent = hidden
        ? `Hide articles (${count})`
        : `Show articles (${count})`;
    });

    const select = el.querySelector('.stock-group-select');
    const bubblesEl = el.querySelector('.stock-bubbles');
    const chart = el.querySelector(`#chart-${index}`);
    const priceMount = el.querySelector('.price-bar-mount');
    const relatedMount = el.querySelector('.related-under-chart');

    const findStock = symbol => {
      const s = util.normalizeSymbol(symbol);
      return (
        chartPool.find(x => util.normalizeSymbol(x.symbol) === s) || {
          symbol: s,
          name: s
        }
      );
    };

    const showRelatedForSymbol = symbol => {
      if (!symbol || !relatedMount) return;
      const clusters = clustersForSymbol(currentGroups, symbol).filter(
        g => (g.name || '') !== (group.name || '')
      );
      renderRelatedClusters(
        `Related clusters · ${symbol}`,
        clusters,
        relatedMount
      );
    };

    /**
     * @param {string} symbol
     * @param {string} [name]
     * @returns {Promise<void>}
     */
    const showChart = async (symbol, name) => {
      if (!symbol) return;
      const stock = findStock(symbol);
      const publishPrice = stock.priceAtPublish ?? stock.price ?? null;
      const publishPct =
        stock.changePercentAtPublish ?? stock.changePercent ?? null;

      priceMount.innerHTML = priceBarHtml(
        symbol,
        name || stock.name,
        publishPrice,
        publishPct,
        null
      );
      // Same as github.com/SamuelGimse/Clustr — plain iframe only
      chart.innerHTML = `
        <div class="chart-name">${symbol} — ${name || stock.name || symbol}</div>
        <iframe src="${util.tradingViewUrl(symbol)}" width="100%" height="320" frameborder="0" allowtransparency="true" scrolling="no"></iframe>`;

      bubblesEl.querySelectorAll('[data-symbol]').forEach(b => {
        b.classList.toggle(
          'is-selected',
          b.getAttribute('data-symbol') === symbol
        );
      });
      showRelatedForSymbol(symbol);

      if (window.ClustrQuotes) {
        const live = await window.ClustrQuotes.getQuote(symbol);
        if (live) {
          priceMount.innerHTML = priceBarHtml(
            symbol,
            name || stock.name,
            publishPrice,
            publishPct,
            live
          );
        }
      }
    };

    function bindBubbles() {
      bubblesEl.querySelectorAll('[data-symbol]').forEach(btn => {
        btn.addEventListener('click', () => {
          const symbol = btn.getAttribute('data-symbol');
          if (!symbol) return;
          showChart(symbol, btn.getAttribute('title') || symbol);
        });
      });
    }

    const sinceEl = el.querySelector('.group-since-publish');

    /**
     * Update average since-publish for the active stock bucket.
     * @param {string} groupId
     * @returns {Promise<void>}
     */
    async function updateGroupSincePublish(groupId) {
      if (!sinceEl) return;
      const g = stockGroups.find(x => x.id === groupId) || stockGroups[0];
      if (!g || !(g.list || []).length) {
        sinceEl.textContent = '';
        sinceEl.className = 'group-since-publish';
        return;
      }
      sinceEl.className = 'group-since-publish is-loading';
      sinceEl.textContent = `${g.label} · loading…`;
      const avg = await averageSincePublish(g.list);
      if (avg == null) {
        sinceEl.className = 'group-since-publish';
        sinceEl.textContent = `${g.label} · no publish prices`;
        return;
      }
      const tone = util.toneClass(avg);
      sinceEl.className = `group-since-publish ${tone}`;
      sinceEl.innerHTML = `<span class="group-since-label">${util.escapeHtml(
        g.label
      )}</span> <span class="group-since-value">${util.formatPct(
        avg
      )}</span> <span class="group-since-hint">since publish</span>`;
    }

    function renderBubbleGroup(groupId) {
      const g = stockGroups.find(x => x.id === groupId) || stockGroups[0];
      if (!g) {
        bubblesEl.innerHTML = '<span class="stock-empty">No stocks</span>';
        return;
      }
      bubblesEl.innerHTML = g.list.map(bubbleBtn).join('');
      bindBubbles();
      // Stagger so many clusters don't stampede the quote edge function
      const delay = (Number(el.dataset.clusterIndex) || 0) * 350;
      setTimeout(() => updateGroupSincePublish(g.id), delay);
    }

    if (select && stockGroups.length) {
      select.value = defaultGroupId;
      select.addEventListener('change', () => {
        renderBubbleGroup(select.value);
        const firstBtn = bubblesEl.querySelector('[data-symbol]');
        if (firstBtn) firstBtn.click();
      });
      renderBubbleGroup(defaultGroupId);
    } else if (bubblesEl) {
      bubblesEl.innerHTML = '<span class="stock-empty">No stocks</span>';
    }

    const first = chartPool[0];
    if (first && first.symbol) {
      showChart(first.symbol, first.name || first.symbol);
    }

    return el;
  }

  /**
   * @param {Array<Object>} groups
   * @param {Array<Object>} currentGroups
   * @returns {Promise<void>}
   */
  async function renderEvents(groups, currentGroups) {
    const target = document.getElementById('eventsList');
    if (!target) return;
    target.innerHTML = '';
    if (!groups.length) {
      target.innerHTML =
        '<p class="empty-state">No clusters in this publish</p>';
      return;
    }
    for (let i = 0; i < groups.length; i++) {
      const el = buildGroupElement(groups[i], i, currentGroups);
      target.appendChild(el);
      requestAnimationFrame(() => el.classList.add('is-visible'));
      await U().sleep(36);
    }
  }

  /**
   * @param {Array<Object>} groups
   * @param {(country: string) => void} onCountry
   * @returns {void}
   */
  function renderCountryPanel(groups, onCountry) {
    const countryPanel = document.getElementById('countryPanel');
    if (!countryPanel) return;
    const util = U();
    const countries = collectCountries(groups);
    countryPanel.innerHTML = countries
      .map(
        c => `
      <button type="button" class="country-card" data-country="${util.escapeHtml(
        c.country
      )}">
        <div class="c-name">${util.escapeHtml(c.country)}</div>
        <div class="c-count">${c.count} event${c.count === 1 ? '' : 's'}</div>
      </button>`
      )
      .join('');
    countryPanel.querySelectorAll('.country-card').forEach(card => {
      card.addEventListener('click', () =>
        onCountry(card.getAttribute('data-country'))
      );
    });
  }

  /**
   * @param {string} country
   * @returns {void}
   */
  function highlightCountryCard(country) {
    document.querySelectorAll('.country-card').forEach(card => {
      card.classList.toggle(
        'is-active',
        card.getAttribute('data-country') === country
      );
    });
  }

  /**
   * @param {Array<Object>} groups
   * @param {string|null} country
   * @returns {void}
   */
  function renderCountryArticles(groups, country) {
    const countryArticles = document.getElementById('countryArticles');
    if (!countryArticles) return;
    const util = U();
    if (!country) {
      countryArticles.innerHTML =
        '<div class="country-articles-head"><div class="c-count">Select a country</div></div>';
      return;
    }
    const items = articlesForCountry(groups, country);
    countryArticles.innerHTML = `
      <div class="country-articles-head">
        <div class="c-name">${util.escapeHtml(country)}</div>
        <div class="c-count">${items.length} article${
          items.length === 1 ? '' : 's'
        }</div>
      </div>
      <div class="article-grid">
        ${
          items.length
            ? items
                .map(
                  a => `
                <article class="md-card md-card--outlined article-card">
                  <h3 class="article-title">${util.escapeHtml(a.title || '')}</h3>
                  <div class="article-meta">
                    ${a.cluster ? util.escapeHtml(a.cluster) + ' · ' : ''}${util.escapeHtml(
                      a.source || ''
                    )}
                    ${
                      a.date
                        ? ' · ' +
                          util.escapeHtml(new Date(a.date).toLocaleString())
                        : ''
                    }
                  </div>
                  <p class="article-summary">${util.escapeHtml(
                    a.short_summary || a.summary || ''
                  )}</p>
                  ${
                    a.link
                      ? `<a class="md-link" href="${util.escapeHtml(
                          a.link
                        )}" target="_blank" rel="noopener">Read →</a>`
                      : ''
                  }
                </article>`
                )
                .join('')
            : '<p class="empty-state">No articles for this country</p>'
        }
      </div>`;
  }

  /**
   * @param {Array<Object>} publishes
   * @param {number} publishIndex
   * @param {(idx: number) => void} onSelect
   * @returns {void}
   */
  function renderDaysList(publishes, publishIndex, onSelect) {
    const daysView = document.getElementById('daysView');
    if (!daysView) return;
    const util = U();
    daysView.innerHTML = publishes
      .map(
        (p, i) => `
      <button type="button" class="day-item ${
        i === publishIndex ? 'is-active' : ''
      }" data-index="${i}">
        <div>
          <div class="day-t">${util.escapeHtml(
            p.title || 'Publish #' + p.id
          )}</div>
          <div class="day-s">${util.escapeHtml(
            new Date(p.created_at).toLocaleString()
          )}</div>
        </div>
        <div class="day-s">${(p.groups_json || []).length} clusters</div>
      </button>`
      )
      .join('');
    daysView.querySelectorAll('.day-item').forEach(item => {
      item.addEventListener('click', () =>
        onSelect(Number(item.getAttribute('data-index')))
      );
    });
  }

  window.ClustrRender = {
    sectorDefaultSincePublish,
    collectCountries,
    clustersForSymbol,
    collectMovers,
    renderMoversStrip,
    renderEvents,
    renderCountryPanel,
    highlightCountryCard,
    renderCountryArticles,
    renderRelatedClusters,
    renderDaysList
  };

  /** @deprecated */
  window.EventlineRender = window.ClustrRender;
})();
