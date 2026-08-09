/**
 * @fileoverview Theme switcher (Material surface tokens via data-theme).
 */

(function () {
  const cfg = window.ClustrConfig || {};
  const THEMES = cfg.THEMES || ['dark'];
  const STORAGE_KEY = 'clustr-theme';

  const root = document.documentElement;
  const themeBtn = document.getElementById('themeBtn');
  const themeMenu = document.getElementById('themeMenu');

  /**
   * @returns {boolean}
   */
  function isLightTheme() {
    return window.ClustrUtil
      ? window.ClustrUtil.isLightTheme()
      : false;
  }

  /**
   * Refresh TradingView iframes when theme light/dark flips.
   * @returns {void}
   */
    function refreshTradingViewIframes() {
    // Exact logic from github.com/SamuelGimse/Clustr themes.js
    document.querySelectorAll('.chart iframe').forEach(iframe => {
      const src = iframe.getAttribute('src');
      if (!src || !src.includes('tradingview.com')) return;
      try {
        const u = new URL(src);
        const light = isLightTheme();
        u.searchParams.set('theme', light ? 'light' : 'dark');
        u.searchParams.set('toolbarbg', light ? 'ffffff' : '0a0a0a');
        iframe.setAttribute('src', u.toString());
      } catch (e) {}
    });
  }

  /**
   * Apply a theme id and persist.
   * @param {string} name
   * @returns {void}
   */
  function applyTheme(name) {
    // Apply the clicked theme id; only fall back if empty
    const theme = (name || '').trim() || 'dark';
    root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* ignore */
    }

    if (themeMenu) {
      themeMenu.querySelectorAll('[data-theme]').forEach(btn => {
        const on = btn.getAttribute('data-theme') === theme;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    if (window.ClustrMap && typeof window.ClustrMap.invalidate === 'function') {
      setTimeout(() => window.ClustrMap.invalidate(), 50);
    }
    refreshTradingViewIframes();
  }

  /**
   * Restore saved theme or default.
   * @returns {void}
   */
  function initTheme() {
    let saved = 'dark';
    try {
      saved = localStorage.getItem(STORAGE_KEY) || 'dark';
    } catch (e) {
      /* ignore */
    }
    applyTheme(saved);
  }

  if (themeBtn && themeMenu) {
    themeBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = themeMenu.classList.toggle('is-open');
      themeMenu.classList.toggle('hidden', !open);
      themeBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    themeMenu.querySelectorAll('[data-theme]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        applyTheme(btn.getAttribute('data-theme'));
        themeMenu.classList.remove('is-open');
        themeMenu.classList.add('hidden');
        themeBtn.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('click', () => {
      themeMenu.classList.remove('is-open');
      themeMenu.classList.add('hidden');
      themeBtn.setAttribute('aria-expanded', 'false');
    });
  }

  /**
   * Mobile drawer: sticky burger opens nav-rail.
   * @returns {void}
   */
  function initMobileNav() {
    const burger = document.getElementById('burgerBtn');
    const backdrop = document.getElementById('navBackdrop');
    const side = document.getElementById('side');
    if (!burger || !side) return;

    /**
     * @param {boolean} open
     * @returns {void}
     */
    function setOpen(open) {
      document.body.classList.toggle('nav-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (backdrop) {
        if (open) {
          backdrop.hidden = false;
          backdrop.removeAttribute('hidden');
        } else {
          backdrop.hidden = true;
          backdrop.setAttribute('hidden', '');
        }
      }
    }

    burger.addEventListener('click', e => {
      e.stopPropagation();
      setOpen(!document.body.classList.contains('nav-open'));
    });

    if (backdrop) {
      backdrop.addEventListener('click', () => setOpen(false));
    }

    // Close drawer after choosing a primary nav item on mobile
    side.querySelectorAll('.nav-rail-btn:not(#themeBtn)').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 768px)').matches) {
          setOpen(false);
        }
      });
    });

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') setOpen(false);
    });
  }

  window.ClustrThemes = { applyTheme, initTheme, isLightTheme, initMobileNav };
  /** @deprecated */
  window.EventlineThemes = window.ClustrThemes;

  initTheme();
  initMobileNav();
})();
