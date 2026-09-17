/**
 * AdminLTE v4 Reusable Template Loader
 * Loads header, sidebar, footer and partial templates dynamically.
 */
(function (global) {
  'use strict';

  const defaultOptions = {
    baseDir: './templates',
    headerSelector: '[data-template="header"]',
    sidebarSelector: '[data-template="sidebar"]',
    footerSelector: '[data-template="footer"]',
    autoInitAdminLTE: true,
    highlightActiveMenu: true,
  };

  /**
   * Determine base directory for templates based on document or script location.
   */
  function resolveBaseDir(configuredBaseDir) {
    if (configuredBaseDir) return configuredBaseDir;
    const bodyBase = document.body?.getAttribute('data-template-base');
    if (bodyBase) return bodyBase;
    return './templates';
  }

  /**
   * Fetch template file text.
   */
  async function fetchTemplate(url) {
    const cacheBuster = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    const response = await fetch(cacheBuster, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load template from ${url} (HTTP ${response.status})`);
    }
    return await response.text();
  }

  /**
   * Insert template HTML string in place of a target element.
   */
  function replaceWithHtml(targetEl, htmlString) {
    const template = document.createElement('template');
    template.innerHTML = htmlString.trim();
    const fragment = template.content;
    const firstElement = fragment.firstElementChild;
    targetEl.replaceWith(fragment);
    return firstElement;
  }

  /**
   * Initialize OverlayScrollbars on sidebar wrapper.
   */
  function initSidebarScrollbar() {
    const sidebarWrapper = document.querySelector('.sidebar-wrapper');
    const isMobile = window.innerWidth <= 992;
    if (
      sidebarWrapper &&
      global.OverlayScrollbarsGlobal?.OverlayScrollbars !== undefined &&
      !isMobile
    ) {
      global.OverlayScrollbarsGlobal.OverlayScrollbars(sidebarWrapper, {
        scrollbars: {
          theme: 'os-theme-light',
          autoHide: 'leave',
          clickScroll: true,
        },
      });
    }
  }

  /**
   * Automatically highlight active menu item based on current URL or data-active-menu.
   */
  function applyActiveMenu() {
    const activeMenuKey = document.body?.getAttribute('data-active-menu');
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';

    const links = document.querySelectorAll('.app-sidebar .nav-link');
    links.forEach((link) => {
      const href = link.getAttribute('href');
      const itemKey = link.getAttribute('data-menu-key');

      let isMatch = false;
      if (activeMenuKey && itemKey && activeMenuKey === itemKey) {
        isMatch = true;
      } else if (!activeMenuKey && href) {
        const linkPath = href.split('/').pop();
        if (linkPath === currentPath) {
          isMatch = true;
        }
      }

      if (isMatch) {
        link.classList.add('active');
        // Expand parents if in treeview
        let parentItem = link.closest('.nav-item');
        while (parentItem) {
          const parentTreeview = parentItem.closest('.nav-treeview');
          if (parentTreeview) {
            const grandParentItem = parentTreeview.closest('.nav-item');
            if (grandParentItem) {
              grandParentItem.classList.add('menu-open');
              const grandParentLink = grandParentItem.querySelector(':scope > .nav-link');
              if (grandParentLink) {
                grandParentLink.classList.add('active');
              }
              parentItem = grandParentItem;
              continue;
            }
          }
          break;
        }
      }
    });
  }

  let tabListenersInitialized = false;
  function initTabListeners() {
    if (tabListenersInitialized) return;
    tabListenersInitialized = true;
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.app-sidebar [data-tab]');
      if (!link) return;
      const tabId = link.getAttribute('data-tab');
      if (!tabId) return;

      if (typeof global.SentinelApp?.switchTab === 'function') {
        e.preventDefault();
        global.SentinelApp.switchTab(tabId);
        document.querySelectorAll('.app-sidebar .nav-link').forEach((l) => l.classList.remove('active'));
        link.classList.add('active');
      } else {
        const targetSection = document.getElementById(`tab-${tabId}`);
        if (targetSection) {
          e.preventDefault();
          document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active', 'show'));
          targetSection.classList.add('active', 'show');
          document.querySelectorAll('.app-sidebar .nav-link').forEach((l) => l.classList.remove('active'));
          link.classList.add('active');
        }
      }
    });
  }

  /**
   * Main loader function.
   */
  async function loadTemplates(options = {}) {
    const config = { ...defaultOptions, ...options };
    const baseDir = resolveBaseDir(config.baseDir).replace(/\/+$/, '');

    const tasks = [];

    // Header
    const headerPlaceholder = document.querySelector(config.headerSelector);
    if (headerPlaceholder) {
      const headerUrl = headerPlaceholder.getAttribute('data-src') || `${baseDir}/header.html`;
      tasks.push(
        fetchTemplate(headerUrl)
          .then((html) => replaceWithHtml(headerPlaceholder, html))
          .catch((err) => console.error('[TemplateLoader] Error loading header:', err))
      );
    }

    // Sidebar
    const sidebarPlaceholder = document.querySelector(config.sidebarSelector);
    if (sidebarPlaceholder) {
      const sidebarUrl = sidebarPlaceholder.getAttribute('data-src') || `${baseDir}/sidebar.html`;
      tasks.push(
        fetchTemplate(sidebarUrl)
          .then((html) => replaceWithHtml(sidebarPlaceholder, html))
          .catch((err) => console.error('[TemplateLoader] Error loading sidebar:', err))
      );
    }

    // Footer
    const footerPlaceholder = document.querySelector(config.footerSelector);
    if (footerPlaceholder) {
      const footerUrl = footerPlaceholder.getAttribute('data-src') || `${baseDir}/footer.html`;
      tasks.push(
        fetchTemplate(footerUrl)
          .then((html) => replaceWithHtml(footerPlaceholder, html))
          .catch((err) => console.error('[TemplateLoader] Error loading footer:', err))
      );
    }

    // Generic [data-include] elements
    const genericPlaceholders = document.querySelectorAll('[data-include]');
    genericPlaceholders.forEach((el) => {
      const url = el.getAttribute('data-include');
      if (url) {
        tasks.push(
          fetchTemplate(url)
            .then((html) => replaceWithHtml(el, html))
            .catch((err) => console.error(`[TemplateLoader] Error loading ${url}:`, err))
        );
      }
    });

    await Promise.all(tasks);

    // Re-initialize AdminLTE components (PushMenu, Treeview, ColorMode, etc.)
    if (config.autoInitAdminLTE && global.adminlte?.initialize) {
      try {
        global.adminlte.initialize();
      } catch (e) {
        console.warn('[TemplateLoader] AdminLTE initialize warning:', e);
      }
    }

    // Initialize Scrollbar for sidebar
    initSidebarScrollbar();

    // Highlight active menu
    if (config.highlightActiveMenu) {
      applyActiveMenu();
    }

    // Dispatch global completion event
    document.dispatchEvent(new CustomEvent('templates:loaded', { bubbles: true }));
  }

  // Export API
  global.TemplateLoader = {
    load: loadTemplates,
    initSidebarScrollbar,
    applyActiveMenu,
  };

  // Auto-run if placeholders are present
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadTemplates();
    });
  } else {
    loadTemplates();
  }
})(typeof window !== 'undefined' ? window : this);
