/**
 * @fileoverview Signal track — publish vs live prices across clusters.
 */

(function () {
  const U = () => window.ClustrUtil;
  const R = () => window.ClustrRender;

  /**
   * @typedef {Object} SignalRow
   * @property {string} symbol
   * @property {string} name
   * @property {string} cluster
   * @property {number|null} priceAtPublish
   * @property {number|null} changePercentAtPublish
   * @property {number|null} livePrice
   * @property {number|null} liveChangePercent
   * @property {number|null} sincePublish
   * @property {string} side
   * @property {string} rowType
   */

  /**
   * Flatten all stock layers into signal rows (excludes pure defaults mix rules optional).
   * @param {Array<Object>} groups
   * @returns {SignalRow[]}
   */
  function flattenStocks(groups) {
    /** @type {SignalRow[]} */
    const rows = [];
    const seen = new Set();

    for (const g of groups || []) {
      const cluster = g.name || 'Cluster';
      const buckets = [
        ...(g.mentioned_stocks || []),
        ...(g.close_stocks || g.direct_stocks || []),
        ...(g.original_stocks || g.related_stocks || []),
        ...(g.fixed_stocks || g.default_stocks || []),
        ...(g.stocks || []),
        ...(g.connected_winners || []),
        ...(g.connected_losers || []),
        ...(g.movers || [])
      ];

      for (const s of buckets) {
        const symbol = U().normalizeSymbol(s.symbol);
        if (!symbol) continue;
        const key = symbol + '|' + cluster;
        if (seen.has(key)) continue;
        seen.add(key);

        rows.push({
          symbol,
          name: s.name || symbol,
          cluster,
          priceAtPublish: s.priceAtPublish ?? s.price ?? null,
          changePercentAtPublish:
            s.changePercentAtPublish ?? s.changePercent ?? null,
          livePrice: null,
          liveChangePercent: null,
          sincePublish: null,
          side: s.side || '',
          rowType: s.side ? 'mover' : 'linked'
        });
      }
    }
    return rows;
  }

  /**
   * Hydrate rows with bulk live quotes.
   * @param {SignalRow[]} rows
   * @returns {Promise<SignalRow[]>}
   */
  async function hydrateLive(rows) {
    const symbols = [...new Set(rows.map(r => r.symbol).filter(Boolean))];
    const quotes =
      window.ClustrQuotes && window.ClustrQuotes.isEnabled()
        ? await window.ClustrQuotes.getQuotes(symbols)
        : {};

    for (const r of rows) {
      const live = quotes[r.symbol] || null;
      if (!live) continue;
      r.livePrice = live.price;
      r.liveChangePercent = live.changePercent;
      r.sincePublish = U().deltaSincePublish(r.priceAtPublish, live.price);
    }
    return rows;
  }

  /**
   * @param {SignalRow[]} rows
   * @param {string} mode
   * @returns {SignalRow[]}
   */
  function sortRows(rows, mode) {
    const out = rows.slice();
    switch (mode) {
      case 'cluster':
        out.sort(
          (a, b) =>
            (a.cluster || '').localeCompare(b.cluster || '') ||
            a.symbol.localeCompare(b.symbol)
        );
        break;
      case 'since':
        out.sort((a, b) => (b.sincePublish ?? -999) - (a.sincePublish ?? -999));
        break;
      case 'live':
        out.sort(
          (a, b) =>
            (b.liveChangePercent ?? -999) - (a.liveChangePercent ?? -999)
        );
        break;
      case 'symbol':
      default:
        out.sort((a, b) => a.symbol.localeCompare(b.symbol));
        break;
    }
    return out;
  }

  /**
   * @param {SignalRow[]} rows
   * @param {Array<Object>} groups
   * @returns {void}
   */
  function renderGrid(rows, groups) {
    const mount = document.getElementById('signalGrid');
    if (!mount) return;
    const util = U();

    mount.innerHTML = rows
      .map(r => {
        const linked = (R().clustersForSymbol(groups, r.symbol) || [])
          .map(g => g.name)
          .filter(n => n !== r.cluster)
          .slice(0, 4);

        return `
        <div class="signal-row" data-symbol="${util.escapeHtml(r.symbol)}" data-cluster="${util.escapeHtml(r.cluster)}" role="row">
          <div class="signal-sym">
            <div class="signal-t">${util.escapeHtml(r.symbol)}</div>
            <div class="signal-s">${util.escapeHtml(r.name)}</div>
          </div>
          <div class="signal-cluster">${util.escapeHtml(r.cluster)}</div>
          <div class="signal-num">
            <div class="signal-s">Publish</div>
            <div>${util.formatMoney(r.priceAtPublish)}</div>
          </div>
          <div class="signal-num">
            <div class="signal-s">Live</div>
            <div>${util.formatMoney(r.livePrice)}</div>
          </div>
          <div class="signal-num ${util.toneClass(r.sincePublish)}">
            <div class="signal-s">Since</div>
            <div>${util.formatPct(r.sincePublish) || '—'}</div>
          </div>
          <div class="signal-num ${util.toneClass(r.liveChangePercent)}">
            <div class="signal-s">Day</div>
            <div>${util.formatPct(r.liveChangePercent) || '—'}</div>
          </div>
          <div class="signal-links">
            ${
              linked.length
                ? linked
                    .map(
                      n =>
                        `<span class="md-chip md-chip--assist">${util.escapeHtml(
                          n
                        )}</span>`
                    )
                    .join('')
                : '<span class="signal-s">—</span>'
            }
          </div>
        </div>`;
      })
      .join('');

    mount.querySelectorAll('.signal-row').forEach(row => {
      row.addEventListener('click', () => {
        const cluster = row.getAttribute('data-cluster');
        if (window.ClustrApp) {
          window.ClustrApp.showView('events');
          window.ClustrApp.jumpToCluster(cluster);
        }
      });
    });
  }

  /**
   * Render the full Signal track view for current groups.
   * @param {Array<Object>} groups
   * @returns {Promise<void>}
   */
  async function renderSignalPage(groups) {
    const status = document.getElementById('signalStatus');
    const sortEl = document.getElementById('signalSort');
    if (status) status.textContent = 'Loading live quotes…';

    let rows = flattenStocks(groups);
    rows = await hydrateLive(rows);

    const apply = () => {
      const mode = sortEl ? sortEl.value : 'since';
      renderGrid(sortRows(rows, mode), groups);
      if (status) {
        status.textContent = `${rows.length} stock–cluster rows · sorted by ${mode}`;
      }
    };

    if (sortEl && !sortEl.dataset.bound) {
      sortEl.addEventListener('change', apply);
      sortEl.dataset.bound = '1';
    }
    apply();
  }

  window.ClustrSignal = { renderSignalPage };
  /** @deprecated */
  window.EventlineSignal = window.ClustrSignal;
})();
