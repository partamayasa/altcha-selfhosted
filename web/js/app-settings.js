/**
 * ALTCHA Sentinel - App Settings Dynamic Loader
 *
 * Fetches app settings from /api/sentinel/app-settings and applies them
 * dynamically to document.title, sidebar brand text, footer, login logo,
 * and any DOM element with data-setting="<key>" attribute.
 * Results are cached in sessionStorage for instant loading without flicker.
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
      // Invalidate cached templates so they re-render with updated values
      sessionStorage.removeItem('sentinel_tpl_./templates/sidebar.html');
      sessionStorage.removeItem('sentinel_tpl_./templates/footer.html');
      sessionStorage.removeItem('sentinel_tpl_./templates/header.html');
    } catch { }
  }

  /**
   * Apply settings object to document title, brand texts, and DOM elements.
   * - Updates document.title: "<Page Name> | <Application Name>"
   * - Updates sidebar & header brand texts (.brand-text and [data-setting="app_name"])
   * - Updates brand link title and brand image alt attributes
   * - Updates login page logo (#login-app-logo)
   * - Fills any element with data-setting="<key>" with the corresponding value
   */
  function applySettings(settings) {
    if (!settings) return;
    activeSettings = settings;
    saveToCache(settings);

    const appName = (settings.app_name || 'ALTCHA Manager').trim();

    // 1. Update document.title dynamically: "<Page Title> | <Application Name>"
    if (!global.__sentinelPageTitlePrefix) {
      const rawTitle = document.title || '';
      if (rawTitle.includes('|')) {
        global.__sentinelPageTitlePrefix = rawTitle.split('|')[0].trim();
      } else {
        global.__sentinelPageTitlePrefix = rawTitle.trim();
      }
    }

    const pagePrefix = global.__sentinelPageTitlePrefix;
    if (pagePrefix && pagePrefix !== appName && pagePrefix !== 'AdminLTE v4' && pagePrefix !== 'Dashboard') {
      document.title = `${pagePrefix} | ${appName}`;
    } else {
      document.title = appName;
    }

    // 2. Update brand text (Sidebar & Header)
    const brandTexts = document.querySelectorAll('[data-setting="app_name"], .brand-text');
    brandTexts.forEach((el) => {
      el.textContent = appName;
    });

    // 3. Update brand-link title attribute
    const brandLinks = document.querySelectorAll('.brand-link');
    brandLinks.forEach((el) => {
      el.setAttribute('title', appName);
    });

    // 4. Update brand-image alt attribute
    const brandImages = document.querySelectorAll('.brand-image');
    brandImages.forEach((img) => {
      img.setAttribute('alt', `${appName} Logo`);
    });

    // 5. Update login page logo if present
    const loginLogo = document.getElementById('login-app-logo');
    if (loginLogo) {
      loginLogo.textContent = appName;
    }

    // 6. Apply to all generic data-setting elements
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
      // Background revalidation
      fetch('/api/sentinel/app-settings')
        .then((r) => (r.ok ? r.json() : null))
        .then((fresh) => {
          if (fresh && JSON.stringify(fresh) !== JSON.stringify(cached)) {
            applySettings(fresh);
          }
        })
        .catch(() => {});
      return cached;
    }

    try {
      const res = await fetch('/api/sentinel/app-settings');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const settings = await res.json();
      applySettings(settings);
      return settings;
    } catch (err) {
      console.warn('[AppSettings] Could not load app settings:', err.message);
      return null;
    }
  }

  // Fast-path: Immediate synchronous check from cache before DOM ready
  const initialCache = loadFromCache();
  if (initialCache) {
    applySettings(initialCache);
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAndApply);
  } else {
    loadAndApply();
  }

  // Re-apply settings whenever dynamic templates (sidebar/footer) finish loading
  document.addEventListener('templates:loaded', () => {
    if (activeSettings) {
      applySettings(activeSettings);
    } else {
      loadAndApply();
    }
  });

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
      return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    }
  };

})(typeof window !== 'undefined' ? window : this);
