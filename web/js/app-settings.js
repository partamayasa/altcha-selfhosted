/**
 * ALTCHA Sentinel - App Settings Dynamic Loader
 *
 * Fetches app settings from /api/sentinel/app-settings and applies them
 * to document.title and any element with data-setting="<key>" attribute.
 * Results are cached in sessionStorage to minimize API calls.
 */
(function (global) {
  'use strict';

  const CACHE_KEY = 'sentinel_app_settings';
  const CACHE_TTL_MS = 60 * 1000; // 1 minute cache
  let activeSettings = null;

  /**
   * Attempt to load settings from sessionStorage cache.
   */
  function loadFromCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL_MS) return null;
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Save settings to sessionStorage cache.
   */
  function saveToCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch { }
  }

  /**
   * Bust the settings cache (call after saving new settings).
   */
  function bustCache() {
    activeSettings = null;
    try {
      sessionStorage.removeItem(CACHE_KEY);
    } catch { }
  }

  /**
   * Apply settings object to the DOM.
   * - Updates document.title (appends app_name suffix)
   * - Fills any element with data-setting="<key>" with the setting value
   */
  function applySettings(settings) {
    if (!settings) return;
    activeSettings = settings;

    // Update document title: prepend page-specific part, append app name
    const appName = settings.app_name || 'ALTCHA Manager';
    const currentTitle = document.title || '';
    if (!currentTitle || currentTitle === appName) {
      document.title = appName;
    } else if (currentTitle.includes('|')) {
      const parts = currentTitle.split('|');
      parts[parts.length - 1] = ` ${appName}`;
      document.title = parts.join('|');
    } else {
      if (!currentTitle.includes(appName)) {
        document.title = `${currentTitle} | ${appName}`;
      }
    }

    // Apply to all data-setting elements
    const elements = document.querySelectorAll('[data-setting]');
    elements.forEach((el) => {
      const key = el.getAttribute('data-setting');
      if (key && settings[key] !== undefined) {
        el.textContent = settings[key];
      }
    });

    document.dispatchEvent(new CustomEvent('app-settings:loaded', { detail: settings }));
  }

  /**
   * Fetch settings from API (or use cache), then apply to DOM.
   */
  async function loadAndApply() {
    const cached = loadFromCache();
    if (cached) {
      applySettings(cached);
      return cached;
    }

    try {
      const res = await fetch('/api/sentinel/app-settings');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const settings = await res.json();
      saveToCache(settings);
      applySettings(settings);
      return settings;
    } catch (err) {
      console.warn('[AppSettings] Could not load app settings:', err.message);
      return null;
    }
  }

  // Auto-run on DOMContentLoaded or immediately if DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAndApply);
  } else {
    loadAndApply();
  }

  // Export public API
  global.AppSettings = {
    load: loadAndApply,
    apply: applySettings,
    bustCache,
    get: function (key, fallback = '') {
      if (activeSettings && activeSettings[key] !== undefined) {
        return activeSettings[key];
      }
      const cached = loadFromCache();
      if (cached && cached[key] !== undefined) {
        return cached[key];
      }
      return fallback;
    },
    getBaseUrl: function () {
      const configured = this.get('app_url');
      if (configured && typeof configured === 'string' && configured.trim().length > 0) {
        return configured.trim().replace(/\/+$/, '');
      }
      return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000';
    }
  };

})(typeof window !== 'undefined' ? window : this);
