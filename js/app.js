/**
 * @fileoverview Clustr public app shell — navigation, boot, publish load.
 */

(function () {
  const cfg = window.ClustrConfig || {};

  /** @type {Array<Object>} */
  let publishes = [];
  /** @type {number} */
  let publishIndex = 0;
  /** @type {Array<Object>} */
  let currentGroups = [];
  /** @type {string} */
  let moversMode = 'active';
  /** @type {string} */
  let view = 'events';

  const meta = document.getElementById('meta');
  const status = document.getElementById('status');
  const boot = document.getElementById('boot');
  const bootLog = document.getElementById('bootLog');

  const eventsView = document.getElementById('eventsView');
  const mapView = document.getElementById('mapView');
  const daysView = document.getElementById('daysView');
  const signalView = document.getElementById('signalView');

  const navEvents = document.getElementById('navEvents');
  const navMap = document.getElementById('navMap');
  const navDays = document.getElementById('navDays');
  const navSignal = document.getElementById('navSignal');

  /**
   * Update header meta + enable/disable publish arrows.
   * Publishes are newest-first: index 0 = latest.
   * Prev = older (higher index), Next = newer (lower index).
   * @returns {void}
   */
  function setMeta() {
    const p = publishes[publishIndex];
    const prevBtn = document.getElementById('prevPublishBtn');
    const nextBtn = document.getElementById('nextPublishBtn');

    if (!p) {
      if (meta) meta.textContent = '';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }

    const n = publishes.length;
    const pos = publishIndex + 1;
    if (meta) {
      meta.textContent = `${p.title || 'Publish'} · ${new Date(
        p.created_at
      ).toLocaleString()} · ${currentGroups.length} clusters · ${pos}/${n}`;
    }
    // Older = higher index
    if (prevBtn) prevBtn.disabled = publishIndex >= n - 1;
    // Newer = lower index
    if (nextBtn) nextBtn.disabled = publishIndex <= 0;
  }

  /**
   * Move to another publish by delta (-1 = newer, +1 = older).
   * @param {number} delta
   * @returns {Promise<void>}
   */
  async function stepPublish(delta) {
    const next = publishIndex + delta;
    if (next < 0 || next >= publishes.length) return;
    publishIndex = next;
    await paintCurrent();
    if (view !== 'events') setNav(view);
  }

  /**
   * Switch primary view.
   * @param {'events'|'map'|'days'|'signal'} which
   * @returns {void}
   */
  function setNav(which) {
    view = which;
    const R = window.ClustrRender;
    const MapApi = window.ClustrMap;

    [navEvents, navMap, navDays, navSignal].forEach(b => {
      if (b) {
        b.classList.remove('is-active');
        b.setAttribute('aria-current', 'false');
      }
    });

    if (eventsView) eventsView.classList.add('hidden');
    if (mapView) mapView.classList.add('hidden');
    if (daysView) daysView.classList.add('hidden');
    if (signalView) signalView.classList.add('hidden');

    if (which === 'events') {
      if (navEvents) {
        navEvents.classList.add('is-active');
        navEvents.setAttribute('aria-current', 'page');
      }
      if (eventsView) eventsView.classList.remove('hidden');
    } else if (which === 'map') {
      if (navMap) {
        navMap.classList.add('is-active');
        navMap.setAttribute('aria-current', 'page');
      }
      if (mapView) mapView.classList.remove('hidden');
      if (MapApi && R) {
        MapApi.render(currentGroups, {
          onCountry: country => {
            R.highlightCountryCard(country);
            R.renderCountryArticles(currentGroups, country);
          }
        });
        if (typeof MapApi.invalidate === 'function') {
          setTimeout(() => MapApi.invalidate(), 50);
        }
      }
    } else if (which === 'days') {
      if (navDays) {
        navDays.classList.add('is-active');
        navDays.setAttribute('aria-current', 'page');
      }
      if (daysView) daysView.classList.remove('hidden');
    } else if (which === 'signal') {
      if (navSignal) {
        navSignal.classList.add('is-active');
        navSignal.setAttribute('aria-current', 'page');
      }
      if (signalView) signalView.classList.remove('hidden');
      if (window.ClustrSignal) {
        window.ClustrSignal.renderSignalPage(currentGroups);
      }
    }
  }

  /**
   * Jump to events view and scroll to a cluster card.
   * @param {string} name
   * @returns {void}
   */
  function jumpToCluster(name) {
    setNav('events');
    const el = document.querySelector(
      `.cluster-card[data-cluster="${CSS.escape(name)}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('is-flash');
      setTimeout(() => el.classList.remove('is-flash'), 1200);
    }
  }

  /**
   * @param {string} symbol
   * @returns {void}
   */
  function onMoverPick(symbol) {
    const R = window.ClustrRender;
    if (!R) return;
    const clusters = R.clustersForSymbol(currentGroups, symbol);
    if (!clusters.length) return;
    setNav('events');
    jumpToCluster(clusters[0].name);
  }

  /**
   * @returns {void}
   */
  function refreshMovers() {
    const R = window.ClustrRender;
    if (R && typeof R.renderMoversStrip === 'function') {
      R.renderMoversStrip(currentGroups, moversMode, onMoverPick);
    }
    document.querySelectorAll('[data-movers-mode]').forEach(btn => {
      btn.classList.toggle(
        'is-active',
        btn.getAttribute('data-movers-mode') === moversMode
      );
    });
  }

  /**
   * Paint events, map panel, days for current publish index.
   * @returns {Promise<void>}
   */
  async function paintCurrent() {
    const R = window.ClustrRender;
    const MapApi = window.ClustrMap;
    if (!R) {
      if (status) status.textContent = 'Render module not loaded';
      return;
    }

    const p = publishes[publishIndex];
    currentGroups = window.ClustrApi.groupsFromPublish(p);
    setMeta();
    refreshMovers();

    await R.renderEvents(currentGroups, currentGroups);

    if (typeof R.renderCountryPanel === 'function') {
      R.renderCountryPanel(currentGroups, country => {
        R.highlightCountryCard(country);
        R.renderCountryArticles(currentGroups, country);
        if (MapApi && typeof MapApi.focusCountry === 'function') {
          MapApi.focusCountry(country);
        }
      });
    }

    if (typeof R.renderCountryArticles === 'function') {
      R.renderCountryArticles(currentGroups, null);
    }

    if (MapApi && typeof MapApi.render === 'function') {
      MapApi.render(currentGroups, {
        onCountry: country => {
          R.highlightCountryCard(country);
          R.renderCountryArticles(currentGroups, country);
        }
      });
    }

    if (typeof R.renderDaysList === 'function') {
      R.renderDaysList(publishes, publishIndex, idx => {
        publishIndex = idx;
        paintCurrent();
        setNav('events');
      });
    }
  }

  const INTRO_HEADLINES = [
    { t: 'US strikes risk Strait of Hormuz', tag: 'Geopolitics' },
    { t: 'Fed holds rates — markets reprice', tag: 'Macro' },
    { t: 'Defense contracts surge this week', tag: 'Contracts' },
    { t: 'AI chip demand outruns supply', tag: 'Tech' },
    { t: 'Oil jumps on shipping risk', tag: 'Energy' },
    { t: 'Pharma breakthrough clears phase 3', tag: 'Health' }
  ];

  /**
   * Cinematic intro — charts, news, clusters — no terminal spam.
   * @returns {Promise<void>}
   */
  async function runBoot() {
    if (!boot) return;
    const util = window.ClustrUtil;
    const fill = document.getElementById('introFill');
    const sub = document.getElementById('introSub');
    const eventsHost = document.getElementById('introEvents');

    document.documentElement.classList.add('boot-lock');
    boot.classList.remove('hidden', 'is-leaving');
    boot.setAttribute('aria-busy', 'true');
    boot.classList.add('is-live');
    if (fill) fill.style.width = '8%';

    // Spawn floating news cards
    if (eventsHost) {
      eventsHost.innerHTML = '';
      INTRO_HEADLINES.forEach((h, i) => {
        const card = document.createElement('div');
        card.className = 'intro-news';
        card.style.setProperty('--i', String(i));
        card.innerHTML = `<span class="intro-news-tag">${h.tag}</span><span class="intro-news-t">${h.t}</span>`;
        eventsHost.appendChild(card);
      });
    }

    const steps = [
      { p: 22, msg: 'Reading global event streams…' },
      { p: 40, msg: 'Clustering catalysts…' },
      { p: 58, msg: 'Linking US equity exposure…' },
      { p: 76, msg: 'Attaching stance & horizon…' },
      { p: 92, msg: 'Snapshotting the signal map…' },
      { p: 100, msg: 'Enter Clustr' }
    ];

    for (const step of steps) {
      if (fill) fill.style.width = `${step.p}%`;
      if (sub) sub.textContent = step.msg;
      await util.sleep(380);
    }
    await util.sleep(320);
  }

  /**
   * Fade out intro into the live app.
   * @returns {Promise<void>}
   */
  async function endBoot() {
    if (!boot) return;
    boot.classList.add('is-leaving');
    boot.setAttribute('aria-busy', 'false');
    document.documentElement.classList.remove('boot-lock');
    const util = window.ClustrUtil;
    await util.sleep(750);
    boot.classList.add('hidden');
    boot.classList.remove('is-live');
  }

  /**
   * App entry.
   * @returns {Promise<void>}
   */
  async function init() {
    try {
      const bootP = runBoot();
      // Load data while the sequence runs so enter feels instant
      const dataP = window.ClustrApi.fetchPublishes(30);
      await bootP;
      publishes = await dataP;
      publishIndex = 0;
      await endBoot();

      if (!publishes.length) {
        if (status) status.textContent = 'No publishes yet';
        return;
      }

      await paintCurrent();
      setNav('events');
    } catch (err) {
      console.error(err);
      await endBoot();
      if (status) status.textContent = err.message || 'Load failed';
    }
  }

  if (navEvents) navEvents.addEventListener('click', () => setNav('events'));
  if (navMap) navMap.addEventListener('click', () => setNav('map'));
  if (navDays) navDays.addEventListener('click', () => setNav('days'));
  if (navSignal) navSignal.addEventListener('click', () => setNav('signal'));

  const prevPublishBtn = document.getElementById('prevPublishBtn');
  const nextPublishBtn = document.getElementById('nextPublishBtn');
  // Newest-first list: +1 = older, -1 = newer
  if (prevPublishBtn) {
    prevPublishBtn.addEventListener('click', () => stepPublish(1));
  }
  if (nextPublishBtn) {
    nextPublishBtn.addEventListener('click', () => stepPublish(-1));
  }

  document.querySelectorAll('[data-movers-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      moversMode = btn.getAttribute('data-movers-mode');
      refreshMovers();
    });
  });

  window.ClustrApp = {
    jumpToCluster,
    showView: setNav,
    getGroups: () => currentGroups,
    getPublishes: () => publishes,
    getPublishIndex: () => publishIndex,
    stepPublish
  };

  /** @deprecated */
  window.EventlineApp = window.ClustrApp;

  init();
})();
