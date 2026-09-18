/**
 * ALTCHA Sentinel API Client
 */

const SentinelAPI = {
  baseUrl: '',

  async request(endpoint, options = {}) {
    try {
      const res = await fetch(this.baseUrl + endpoint, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      const contentType = res.headers.get('content-type') || '';
      let data = null;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        data = { message: await res.text() };
      }

      if (!res.ok) {
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }

      return data;
    } catch (err) {
      console.error(`Sentinel API Error [${endpoint}]:`, err);
      throw err;
    }
  },

  // Telemetry & Stats
  async getStats(params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, value);
      }
    }
    const qs = query.toString();
    return this.request(`/api/sentinel/stats${qs ? `?${qs}` : ''}`);
  },

  // Audit Logs
  async getLogs(params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, value);
      }
    }
    const qs = query.toString();
    return this.request(`/api/sentinel/logs${qs ? `?${qs}` : ''}`);
  },

  async getLogDates() {
    return this.request('/api/sentinel/logs/dates');
  },

  async deleteLogs(payload = {}) {
    return this.request('/api/sentinel/logs', {
      method: 'DELETE',
      body: JSON.stringify(payload),
    });
  },

  // Whitelist Management
  async getWhitelist() {
    return this.request('/api/sentinel/whitelist');
  },

  async saveWhitelist(payload) {
    return this.request('/api/sentinel/whitelist', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async testWhitelist(origin) {
    return this.request('/api/sentinel/whitelist/test', {
      method: 'POST',
      body: JSON.stringify({ origin }),
    });
  },

  // Server Engine Config
  async getConfig() {
    return this.request('/api/sentinel/config');
  },

  // PoW Engine Config (Database-managed)
  async getPowConfig() {
    return this.request('/api/sentinel/pow-config');
  },

  async savePowConfig(payload) {
    return this.request('/api/sentinel/pow-config', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Redis Actions
  async flushRedis() {
    return this.request('/api/sentinel/redis/flush', {
      method: 'POST',
    });
  },

  // Captcha Testing
  async getChallenge(options = {}) {
    return this.request('/challenge', options);
  },

  async verify(payload, options = {}) {
    const { headers = {}, ...rest } = options;
    return this.request('/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify({ payload, ...(options.body || {}) }),
      ...rest
    });
  },

  // App Settings
  async getAppSettings() {
    return this.request('/api/sentinel/app-settings');
  },

  async saveAppSettings(payload) {
    return this.request('/api/sentinel/app-settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
};

window.SentinelAPI = SentinelAPI;
