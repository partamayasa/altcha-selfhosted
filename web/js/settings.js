/**
 * ALTCHA Sentinel - Engine & Settings Module
 */

const SentinelSettings = {
  config: null,

  async init() {
    await Promise.all([
      this.loadConfig(),
      this.loadAppSettings(),
    ]);
  },

  // Engine / PoW Config

  async loadConfig() {
    try {
      const data = await SentinelAPI.getConfig();
      this.config = data;
      this.renderConfig();
    } catch (err) {
      SentinelApp.showToast('Failed to load engine configuration: ' + err.message, 'error');
    }
  },

  renderConfig() {
    if (!this.config) return;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val !== undefined && val !== null ? val : '-';
    };

    setVal('cfg-algorithm', this.config.algorithm);
    setVal('cfg-cost', Number(this.config.cost).toLocaleString());
    setVal('cfg-expires', `${this.config.expiresIn} seconds`);
    setVal('cfg-ratelimit-max', `${this.config.rateLimitMax} requests`);
    setVal('cfg-ratelimit-window', `${Math.round(this.config.rateLimitWindowMs / 1000)} seconds`);
    setVal('cfg-redis-status', this.config.redisConnected ? 'Active (Connected)' : 'Disconnected (In-Memory fallback)');
    setVal('cfg-trust-proxy', String(this.config.trustProxy));
    setVal('cfg-port', String(this.config.port));

    const redisBtn = document.getElementById('btn-flush-redis');
    if (redisBtn) {
      redisBtn.disabled = !this.config.redisConnected;
    }

    this.calculateEstimate();
  },

  calculateEstimate() {
    const cost = this.config?.cost || 50000;
    const estEl = document.getElementById('calc-estimate-result');
    if (!estEl) return;

    // Approximate benchmark: PBKDF2 single iteration check speed ~ 100-200k/sec in modern JS workers
    const approxSec = (cost / 150000).toFixed(2);
    estEl.innerHTML = `Estimated client PoW solve time on browser: <strong>~${Math.max(approxSec * 1000, 30).toFixed(0)} ms</strong> (${approxSec}s).`;
  },

  async flushRedisCache() {
    if (!confirm('Are you sure you want to flush the anti-replay cache in Redis? In-flight challenges may potentially be reused.')) {
      return;
    }

    try {
      const res = await SentinelAPI.flushRedis();
      SentinelApp.showToast(res.message || 'Redis cache successfully flushed!', 'success');
    } catch (err) {
      SentinelApp.showToast('Failed to flush Redis cache: ' + err.message, 'error');
    }
  },

  // App Settings (Name, Tagline, Footer)

  async loadAppSettings() {
    try {
      const settings = await SentinelAPI.getAppSettings();
      this.renderAppSettings(settings);
    } catch (err) {
      SentinelApp.showToast('Failed to load app settings: ' + err.message, 'error');
    }
  },

  renderAppSettings(settings) {
    if (!settings) return;
    const fields = ['app_name', 'app_tagline', 'app_footer'];
    for (const key of fields) {
      const el = document.getElementById(`app-setting-${key}`);
      if (el && settings[key] !== undefined) {
        el.value = settings[key];
      }
    }
  },

  async saveAppSettings() {
    const fields = ['app_name', 'app_tagline', 'app_footer'];
    const payload = {};
    for (const key of fields) {
      const el = document.getElementById(`app-setting-${key}`);
      if (el) payload[key] = el.value.trim();
    }

    if (!payload.app_name) {
      SentinelApp.showToast('App name cannot be empty.', 'error');
      return;
    }

    try {
      const res = await SentinelAPI.saveAppSettings(payload);
      if (res.success) {
        // Bust cached settings so all pages pick up the change on next load
        if (typeof AppSettings !== 'undefined') {
          AppSettings.bustCache();
          AppSettings.apply(res.settings);
        }
        SentinelApp.showToast('App settings saved successfully!', 'success');
      }
    } catch (err) {
      SentinelApp.showToast('Failed to save app settings: ' + err.message, 'error');
    }
  }
};

window.SentinelSettings = SentinelSettings;

