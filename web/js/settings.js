/**
 * ALTCHA Sentinel - Engine & Settings Module
 */

const SentinelSettings = {
  config: null,
  powSettings: null,

  async init() {
    await this.loadConfig();
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

    // Also load PoW settings from database
    try {
      const powData = await SentinelAPI.getPowConfig();
      this.powSettings = powData.settings;
      this.renderPowSettings();
    } catch (err) {
      console.warn('Failed to load PoW settings from database:', err.message);
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

    const redisStatusEl = document.getElementById('cfg-redis-status');
    if (redisStatusEl) {
      redisStatusEl.className = 'badge';
      if (this.config.redisConnected) {
        redisStatusEl.classList.add('text-bg-success');
      } else {
        redisStatusEl.classList.add('text-bg-danger');
      }
    }
    setVal('cfg-trust-proxy', String(this.config.trustProxy));
    setVal('cfg-port', String(this.config.port));

    const redisBtn = document.getElementById('btn-flush-redis');
    if (redisBtn) {
      redisBtn.disabled = !this.config.redisConnected;
    }

    const inputCost = document.getElementById('input-cost');
    if (inputCost) inputCost.value = this.config.cost;

    const inputExpires = document.getElementById('input-expires');
    if (inputExpires) inputExpires.value = this.config.expiresIn;

    const inputRateMax = document.getElementById('input-ratelimit-max');
    if (inputRateMax) inputRateMax.value = this.config.rateLimitMax;

    const inputRateWindow = document.getElementById('input-ratelimit-window');
    if (inputRateWindow) inputRateWindow.value = this.config.rateLimitWindowMs;

    this.calculateEstimate();
  },

  renderPowSettings() {
    if (!this.powSettings) return;

    const setField = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null) el.value = val;
    };

    setField('pow-cost', this.powSettings.altcha_cost);
    setField('pow-expires', this.powSettings.expires_in);
    setField('pow-rate-max', this.powSettings.rate_limit_max);
    setField('pow-rate-window', this.powSettings.rate_limit_window_ms);

    // Live update estimate when user changes cost in the form
    const powCostInput = document.getElementById('pow-cost');
    if (powCostInput) {
      powCostInput.addEventListener('input', () => {
        const val = parseInt(powCostInput.value, 10);
        if (!isNaN(val) && val > 0) {
          this.calculateEstimate(val);
        }
      });
    }
  },

  async savePowSettingsFromCard() {
    const btn = document.getElementById('btn-save-pow-card');
    const btnText = document.getElementById('btn-save-pow-card-text');
    const spinner = document.getElementById('btn-save-pow-card-spinner');

    if (btn) {
      btn.disabled = true;
      if (spinner) spinner.classList.remove('d-none');
      if (btnText) btnText.textContent = 'Saving...';
    }

    const payload = {
      altcha_cost: document.getElementById('pow-cost')?.value,
      expires_in: document.getElementById('pow-expires')?.value,
      rate_limit_max: document.getElementById('pow-rate-max')?.value,
      rate_limit_window_ms: document.getElementById('pow-rate-window')?.value,
    };

    try {
      const res = await SentinelAPI.savePowConfig(payload);
      if (res.success) {
        SentinelApp.showToast('PoW Engine Policy saved to database!', 'success');
        // Reload config to refresh display values
        this.powSettings = {
          altcha_cost: payload.altcha_cost,
          expires_in: payload.expires_in,
          rate_limit_max: payload.rate_limit_max,
          rate_limit_window_ms: payload.rate_limit_window_ms,
        };
        // Also refresh the main config display
        if (this.config) {
          this.config.cost = parseInt(payload.altcha_cost, 10) || this.config.cost;
          this.config.expiresIn = parseInt(payload.expires_in, 10) || this.config.expiresIn;
          this.config.rateLimitMax = parseInt(payload.rate_limit_max, 10) || this.config.rateLimitMax;
          this.config.rateLimitWindowMs = parseInt(payload.rate_limit_window_ms, 10) || this.config.rateLimitWindowMs;
          this.renderConfig();
        }
      } else {
        throw new Error(res.error || 'Unknown error');
      }
    } catch (err) {
      SentinelApp.showToast('Failed to save PoW policy: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        if (spinner) spinner.classList.add('d-none');
        if (btnText) btnText.textContent = 'Save Policy';
      }
    }
  },

  calculateEstimate(costOverride) {
    const cost = costOverride || this.config?.cost || 50000;
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

