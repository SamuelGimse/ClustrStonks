/**
 * @fileoverview Supabase REST client for Clustr publishes.
 */

(function () {
  /**
   * @typedef {Object} PublishRow
   * @property {number|string} id
   * @property {string} [title]
   * @property {string} [notes]
   * @property {string} [created_at]
   * @property {Array<Object>} [groups_json]
   * @property {Array<Object>} [groups]
   */

  /**
   * @returns {{url: string, key: string}}
   */
  function creds() {
    const cfg = window.ClustrConfig || {};
    return {
      url: String(cfg.SUPABASE_URL || '').replace(/\/$/, ''),
      key: String(cfg.SUPABASE_ANON_KEY || '')
    };
  }

  /**
   * Load recent publishes (newest first).
   * @param {number} [limit=30]
   * @returns {Promise<PublishRow[]>}
   */
  async function fetchPublishes(limit = 30) {
    const { url, key } = creds();
    if (!url || !key) throw new Error('Missing Supabase config');

    const endpoint =
      `${url}/rest/v1/publishes?select=*&order=id.desc&limit=${encodeURIComponent(
        String(limit)
      )}`;

    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error('Could not load publishes (' + res.status + ')');
    }
    return res.json();
  }

  /**
   * Extract cluster groups from a publish row.
   * @param {PublishRow|null|undefined} publish
   * @returns {Array<Object>}
   */
  function groupsFromPublish(publish) {
    if (!publish) return [];
    if (Array.isArray(publish.groups_json)) return publish.groups_json;
    if (Array.isArray(publish.groups)) return publish.groups;
    return [];
  }

  window.ClustrApi = {
    fetchPublishes,
    groupsFromPublish
  };
})();
