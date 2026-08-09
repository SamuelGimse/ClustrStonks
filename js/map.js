/**
 * @fileoverview Leaflet world map with country event bubbles.
 */

(function () {
  /** @type {L.Map|null} */
  let map = null;
  /** @type {L.Layer[]} */
  let mapMarkers = [];

  /**
   * Ensure Leaflet map exists and is sized.
   * @returns {L.Map}
   */
  function ensureMap() {
    if (map) {
      map.invalidateSize(true);
      return map;
    }

    map = L.map('map', {
      worldCopyJump: true,
      minZoom: 1,
      maxZoom: 6
    }).setView([20, 0], 2);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 6
    }).addTo(map);

    return map;
  }

  /**
   * Remove all country markers.
   * @returns {void}
   */
  function clearMarkers() {
    if (!map) return;
    mapMarkers.forEach(layer => {
      try {
        map.removeLayer(layer);
      } catch (e) {
        /* ignore */
      }
    });
    mapMarkers = [];
  }

  /**
   * Force Leaflet to recalculate container size.
   * @returns {void}
   */
  function invalidate() {
    if (map) map.invalidateSize(true);
  }

  /**
   * DivIcon sized by event count.
   * @param {number} count
   * @returns {L.DivIcon}
   */
  function countIcon(count) {
    const size = count > 9 ? 36 : 28;
    return L.divIcon({
      className: 'map-count-bubble',
      html: `<div class="count-dot" aria-hidden="true">${count}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  /**
   * Render country bubbles for current groups.
   * @param {Array<Object>} groups
   * @param {{onCountry?: (country: string, coords: [number, number]) => void}} [handlers]
   * @returns {void}
   */
  function render(groups, handlers = {}) {
    const m = ensureMap();
    clearMarkers();

    const coordsMap =
      (window.ClustrConfig && window.ClustrConfig.COUNTRY_COORDS) || {};
    const countries =
      window.ClustrRender && window.ClustrRender.collectCountries
        ? window.ClustrRender.collectCountries(groups || [])
        : [];

    for (const c of countries) {
      const coords =
        coordsMap[c.country] || coordsMap.Global || [20, 0];

      const marker = L.marker(coords, {
        icon: countIcon(c.count),
        keyboard: true,
        title: `${c.country}: ${c.count} events`
      }).addTo(m);

      marker.bindPopup(
        `<strong>${c.country}</strong><br>${c.count} event${
          c.count === 1 ? '' : 's'
        }`
      );

      marker.on('click', () => {
        if (handlers.onCountry) handlers.onCountry(c.country, coords);
      });

      mapMarkers.push(marker);
    }

    setTimeout(() => m.invalidateSize(true), 80);
  }

  /**
   * Pan map to a country.
   * @param {string} country
   * @returns {void}
   */
  function focusCountry(country) {
    if (!map) return;
    const coordsMap =
      (window.ClustrConfig && window.ClustrConfig.COUNTRY_COORDS) || {};
    const coords = coordsMap[country] || coordsMap.Global || [20, 0];
    map.setView(coords, 3);
  }

  window.ClustrMap = {
    ensureMap,
    clearMarkers,
    invalidate,
    render,
    renderBubbles: render,
    focusCountry
  };

  /** @deprecated */
  window.EventlineMap = window.ClustrMap;
})();
