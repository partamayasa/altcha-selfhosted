/**
 * ALTCHA Sentinel - Core Application Controller
 */

const SentinelApp = {
  currentTab: 'dashboard',
  refreshInterval: null,
  refreshSeconds: 0,

  async init() {
    this.initTheme();
    this.initNavigation();
    this.initRefreshControls();
    this.checkHealth();

    // Initial module loads
    await SentinelDashboard.init();
    await SentinelLogs.init();
    await SentinelWhitelist.init();
    await SentinelSettings.init();
    SentinelPlayground.init();

    // Set default auto refresh to 10 seconds for real-time live monitoring
    const refreshSelect = document.getElementById('global-refresh-interval');
    if (refreshSelect) {
      refreshSelect.value = '10';
      this.setRefreshInterval(10);
    }
  },

  initTheme() {
    const savedTheme = localStorage.getItem('sentinel_theme') || 'dark';
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    document.documentElement.setAttribute('data-theme', savedTheme);
    this.updateThemeIcon(savedTheme);

    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const isDark = document.body.classList.contains('dark-mode');
        const next = isDark ? 'light' : 'dark';
        if (next === 'dark') {
          document.body.classList.add('dark-mode');
        } else {
          document.body.classList.remove('dark-mode');
        }
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('sentinel_theme', next);
        this.updateThemeIcon(next);
      });
    }
  },

  updateThemeIcon(theme) {
    const iconEl = document.getElementById('theme-icon');
    if (!iconEl) return;
    if (theme === 'light') {
      iconEl.className = 'fas fa-moon';
    } else {
      iconEl.className = 'fas fa-sun';
    }
  },

  initNavigation() {
    // AdminLTE PushMenu (Sidebar toggle)
    const pushMenuBtn = document.getElementById('pushmenu-btn');
    if (pushMenuBtn) {
      pushMenuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (window.innerWidth < 768) {
          // Mobile drawer mode
          document.body.classList.toggle('sidebar-open');
        } else {
          // Desktop mini sidebar toggle
          const isCollapsed = document.body.classList.contains('sidebar-collapse');
          if (isCollapsed) {
            document.body.classList.remove('sidebar-collapse', 'sidebar-closed');
            localStorage.setItem('sentinel_sidebar_collapsed', 'false');
          } else {
            document.body.classList.add('sidebar-collapse', 'sidebar-closed');
            localStorage.setItem('sentinel_sidebar_collapsed', 'true');
          }
        }
      });
    }

    // Restore saved sidebar collapsed state on desktop
    if (window.innerWidth >= 768 && localStorage.getItem('sentinel_sidebar_collapsed') === 'true') {
      document.body.classList.add('sidebar-collapse', 'sidebar-closed');
    }

    const navLinks = document.querySelectorAll('.nav-sidebar .nav-link');
    navLinks.forEach((item) => {
      item.addEventListener('click', () => {
        const targetTab = item.getAttribute('data-tab');
        if (targetTab) {
          this.switchTab(targetTab);
          // Close mobile sidebar on select
          if (window.innerWidth <= 767.98) {
            document.body.classList.remove('sidebar-open');
          }
        }
      });
    });
  },

  switchTab(tabId) {
    this.currentTab = tabId;

    // Update active nav links
    document.querySelectorAll('.nav-sidebar .nav-link').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-tab') === tabId);
    });

    // Update active pane
    document.querySelectorAll('.tab-pane').forEach((el) => {
      el.classList.toggle('active', el.id === `tab-${tabId}`);
    });

    // Update page title & breadcrumbs
    const titles = {
      dashboard: { title: 'Overview & Telemetry', desc: '', breadcrumb: 'Dashboard' },
      logs: { title: 'Audit Logs', desc: 'Traffic history & verification stream', breadcrumb: 'Logs' },
      whitelist: { title: 'Security Whitelist', desc: 'Domain origin protection rules', breadcrumb: 'Whitelist' },
      settings: { title: 'PoW Engine Policy', desc: 'Proof-of-Work engine parameters', breadcrumb: 'Policy' },
      playground: { title: 'Playground & Snippets', desc: 'Widget live testing & integration', breadcrumb: 'Playground' }
    };

    const t = titles[tabId] || { title: 'ALTCHA Manager', desc: '', breadcrumb: tabId };
    const titleEl = document.getElementById('header-title');
    const descEl = document.getElementById('header-desc');
    const breadcrumbEl = document.getElementById('breadcrumb-current');

    if (titleEl) titleEl.textContent = t.title;
    if (descEl) descEl.textContent = t.desc;
    if (breadcrumbEl) breadcrumbEl.textContent = t.breadcrumb;

    // Trigger tab-specific refresh if needed
    if (tabId === 'dashboard') SentinelDashboard.refresh();
    else if (tabId === 'logs') SentinelLogs.refresh();
    else if (tabId === 'whitelist') SentinelWhitelist.load();
    else if (tabId === 'settings') SentinelSettings.loadConfig();
  },

  initRefreshControls() {
    const refreshSelect = document.getElementById('global-refresh-interval');
    if (refreshSelect) {
      refreshSelect.addEventListener('change', (e) => {
        this.setRefreshInterval(parseInt(e.target.value, 10) || 0);
      });
    }

    const manualRefreshBtn = document.getElementById('manual-refresh-btn');
    if (manualRefreshBtn) {
      manualRefreshBtn.addEventListener('click', () => {
        this.refreshCurrent();
        this.showToast('Data refreshed', 'info');
      });
    }
  },

  setRefreshInterval(seconds) {
    this.refreshSeconds = seconds;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    if (seconds > 0) {
      this.refreshInterval = setInterval(() => {
        this.refreshCurrent();
      }, seconds * 1000);
    }
  },

  refreshCurrent() {
    this.checkHealth();
    if (this.currentTab === 'dashboard') {
      SentinelDashboard.refresh();
    } else if (this.currentTab === 'logs') {
      SentinelLogs.refresh();
    }
  },

  async checkHealth() {
    try {
      const res = await fetch('/health');
      const data = await res.json();
      const dot = document.getElementById('node-status-dot');
      const text = document.getElementById('node-status-text');

      if (data.status === 'ok') {
        if (dot) dot.style.background = 'var(--status-success)';
        if (text) text.textContent = 'Operational';
      } else {
        if (dot) dot.style.background = 'var(--status-danger)';
        if (text) text.textContent = 'Degraded';
      }
    } catch {
      const dot = document.getElementById('node-status-dot');
      const text = document.getElementById('node-status-text');
      if (dot) dot.style.background = 'var(--status-danger)';
      if (text) text.textContent = 'Offline';
    }
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  SentinelApp.init();
});

window.SentinelApp = SentinelApp;
