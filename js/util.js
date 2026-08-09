/**
 * @fileoverview Shared pure helpers for Clustr public UI.
 * TradingView: exact same as https://github.com/SamuelGimse/Clustr render.js
 */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeSymbol(symbol) {
  return String(symbol || '')
    .trim()
    .toUpperCase();
}

function formatPct(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '';
  const n = Number(value);
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function formatMoney(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(digits);
}

function deltaSincePublish(publishPrice, livePrice) {
  if (publishPrice == null || livePrice == null || Number(publishPrice) === 0) {
    return null;
  }
  return ((Number(livePrice) - Number(publishPrice)) / Number(publishPrice)) * 100;
}

function toneClass(value) {
  if (value == null || Number.isNaN(Number(value))) return '';
  return Number(value) >= 0 ? 'tone-up' : 'tone-down';
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uniqueSymbols(symbols) {
  return [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))];
}

function isLightTheme() {
  const light =
    (window.ClustrConfig && window.ClustrConfig.LIGHT_THEMES) ||
    new Set([
      'github-light',
      'nord-light',
      'paper',
      'kermit',
      'coral-navy',
      'charcoal-sand',
      'berry-mint',
      'plum-cream',
      'forest-mist',
      'sea-foam'
    ]);
  const t = document.documentElement.getAttribute('data-theme') || 'dark';
  return light.has(t);
}

function toolbarBgHex() {
  return isLightTheme() ? 'ffffff' : '0a0a0a';
}

/** Exact tvUrl from github.com/SamuelGimse/Clustr */
function tradingViewUrl(symbol) {
  const theme = isLightTheme() ? 'light' : 'dark';
  const toolbarbg = toolbarBgHex();
  return (
    `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(symbol)}` +
    `&interval=D&theme=${theme}&style=1&locale=en` +
    `&hide_top_toolbar=1&hide_legend=1&hidesidetoolbar=1` +
    `&symboledit=0&saveimage=0&toolbarbg=${toolbarbg}`
  );
}

window.ClustrUtil = {
  sleep,
  normalizeSymbol,
  formatPct,
  formatMoney,
  deltaSincePublish,
  toneClass,
  escapeHtml,
  uniqueSymbols,
  isLightTheme,
  toolbarBgHex,
  tradingViewUrl
};
