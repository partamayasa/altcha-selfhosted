/**
 * ALTCHA Sentinel - Engine & Settings Module
 */

const SentinelSettings = {
  config: null,

  async init() {
    await this.loadConfig();
  },

  async loadConfig() {
    try {
      const data = await SentinelAPI.getConfig();
      this.config = data;
      this.render();
    } catch (err) {
      SentinelApp.showToast('Failed to load engine configuration: ' + err.message, 'error');
    }
  },

  render() {
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
  }
};

window.SentinelSettings = SentinelSettings;
