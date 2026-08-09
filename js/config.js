/**
 * @fileoverview Clustr public app configuration.
 * Static frontend only — no AI keys. Edit SUPABASE_* and QUOTE_API_URL for your project.
 */

/**
 * Supabase project URL (REST).
 * @type {string}
 */
const SUPABASE_URL = 'https://yrykmwjcarytyroofiar.supabase.co';

/**
 * Supabase anon / publishable key (safe for browser).
 * @type {string}
 */
const SUPABASE_ANON_KEY = 'sb_publishable_I6HgMNkoKiMcAghe0oyMxA_YNKfurSq';

/**
 * Live quote edge function (Yahoo bulk on the server).
 * Supports:
 *   GET  ?symbols=AAPL,MSFT,XOM
 *   GET  ?symbol=AAPL  (single, legacy)
 * Leave empty to disable live quotes.
 * @type {string}
 */
const QUOTE_API_URL =
  'https://yrykmwjcarytyroofiar.supabase.co/functions/v1/clever-api';

/**
 * Boot sequence lines shown before data loads.
 * @type {string[]}
 */
const BOOT_LINES = [
  '→ open signal mesh',
  '→ lock global wires',
  '→ policy · filings · contracts',
  '→ weather extremes · movers',
  '→ score commercial relevance',
  '→ cluster events by theme',
  '→ tag geography',
  '→ map US equity exposure',
  '→ stance · horizon · confidence',
  '→ snapshot prices at publish',
  '→ enter opportunity map'
];

/**
 * Approximate map coordinates for country bubbles [lat, lng].
 * @type {Object.<string, [number, number]>}
 */
const COUNTRY_COORDS = {
  'United States': [37.1, -95.7],
  'United Kingdom': [54.0, -2.0],
  China: [35.9, 104.2],
  Taiwan: [23.7, 121.0],
  Japan: [36.2, 138.3],
  'South Korea': [35.9, 127.8],
  'North Korea': [40.3, 127.5],
  Russia: [61.5, 105.3],
  Ukraine: [48.4, 31.2],
  Iran: [32.4, 53.7],
  Israel: [31.0, 34.8],
  Palestine: [31.95, 35.23],
  Greece: [39.1, 21.8],
  Poland: [51.9, 19.1],
  Hungary: [47.2, 19.5],
  'Saudi Arabia': [23.9, 45.1],
  'United Arab Emirates': [23.4, 53.8],
  Turkey: [39.0, 35.2],
  Germany: [51.2, 10.5],
  France: [46.2, 2.2],
  Norway: [60.5, 8.5],
  'European Union': [50.1, 9.0],
  India: [20.6, 79.0],
  Australia: [-25.3, 133.8],
  Canada: [56.1, -106.3],
  Mexico: [23.6, -102.5],
  Brazil: [-14.2, -51.9],
  // Mid-Atlantic open ocean — not over Africa
  Global: [5, -30]
};

/**
 * Theme ids applied via data-theme on <html>.
 * @type {string[]}
 */
/**
 * Refined list — distinct accents, not 10× blue-grey.
 * Aurora kept as signature theme.
 */
const THEMES = [
  'aurora',
  'pure-black',
  'graphite',
  'dark',
  'ember',
  'pine',
  'gold',
  'volcanic',
  'tokyo-night',
  'dracula',
  'gruvbox',
  'catppuccin',
  'indigo-peach',
  'crt',
  'dos-amber',
  'vt220',
  'paper',
  'github-light',
  'kermit'
];

/**
 * Themes that use light TradingView chrome.
 * @type {Set<string>}
 */
const LIGHT_THEMES = new Set([
  'github-light',
  'paper',
  'kermit'
]);

/**
 * TradingView toolbar / frame background per theme (hex without #).
 * Chart candles still only support light|dark from TV; this tints chrome.
 * @type {Record<string, string>}
 */
const THEME_CHART_BG = {
  aurora: '061018',
  'pure-black': '000000',
  graphite: '121212',
  dark: '0a0a0a',
  ember: '140c08',
  pine: '0a120c',
  gold: '12100a',
  volcanic: '12080a',
  'tokyo-night': '1a1b26',
  dracula: '282a36',
  gruvbox: '282828',
  catppuccin: '1e1e2e',
  'indigo-peach': '0b0742',
  crt: '020904',
  'dos-amber': '0c0a04',
  vt220: '001a00',
  paper: 'faf8f5',
  'github-light': 'ffffff',
  kermit: 'e8f6f0'
};

/**
 * Global config namespace (legacy EventlineConfig alias kept for compatibility).
 * @namespace ClustrConfig
 */
window.ClustrConfig = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  QUOTE_API_URL,
  BOOT_LINES,
  COUNTRY_COORDS,
  THEMES,
  LIGHT_THEMES,
  THEME_CHART_BG
};

/** @deprecated Use window.ClustrConfig */
window.EventlineConfig = window.ClustrConfig;
