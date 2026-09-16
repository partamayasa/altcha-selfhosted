/**
 * ALTCHA Sentinel - Whitelist & Security Rules Module
 */

const SentinelWhitelist = {
  config: {
    enabled: true,
    allowDirectAccess: false,
    domains: []
  },

  async init() {
    await this.load();
  },

  async load() {
    try {
      const data = await SentinelAPI.getWhitelist();
      this.config = data;
      this.render();
    } catch (err) {
      SentinelApp.showToast('Failed to load whitelist: ' + err.message, 'error');
    }
  },

  render() {
    const enabledToggle = document.getElementById('whitelist-enabled-toggle');
    const directAccessToggle = document.getElementById('whitelist-direct-toggle');
    const countEl = document.getElementById('whitelist-count-badge');

    if (enabledToggle) enabledToggle.checked = !!this.config.enabled;
    if (directAccessToggle) directAccessToggle.checked = !!this.config.allowDirectAccess;
    if (countEl) {
      const count = this.config.domains ? this.config.domains.length : 0;
      countEl.textContent = `${count} Domain${count !== 1 ? 's' : ''}`;
    }

    this.renderDomainList();
  },

  renderDomainList() {
    const container = document.getElementById('whitelist-domains-list');
    if (!container) return;

    if (!this.config.domains || this.config.domains.length === 0) {
      container.innerHTML = `
        <div class="text-center p-3 text-muted" style="font-size:0.9rem;">
          No domain rules currently registered in the whitelist.
        </div>
      `;
      return;
    }

    let html = `
      <table class="table table-bordered table-striped mb-0">
        <thead>
          <tr>
            <th>Domain / Rule Pattern</th>
            <th style="width:100px;">Type</th>
            <th style="width:80px;text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    this.config.domains.forEach((rule, idx) => {
      const isWildcard = rule.includes('*');
      const badge = isWildcard 
        ? `<span class="badge badge-warning">Wildcard</span>` 
        : `<span class="badge badge-info">Exact</span>`;

      html += `
        <tr>
          <td><code style="font-size:0.9rem;">${rule}</code></td>
          <td>${badge}</td>
          <td style="text-align:center;">
            <button class="btn btn-danger btn-sm" onclick="SentinelWhitelist.removeDomain(${idx})" title="Remove Rule">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  },

  addDomain() {
    const input = document.getElementById('new-domain-input');
    if (!input) return;

    let val = input.value.trim();
    if (!val) {
      SentinelApp.showToast('Please enter a URL or domain pattern!', 'info');
      return;
    }

    // Basic normalizer
    if (!val.startsWith('http://') && !val.startsWith('https://') && val !== '*') {
      val = 'https://' + val;
    }

    if (this.config.domains.includes(val)) {
      SentinelApp.showToast('Domain is already in the whitelist', 'info');
      return;
    }

    this.config.domains.push(val);
    input.value = '';
    this.render();
    SentinelApp.showToast(`Domain ${val} added to draft. Click "Save Changes" to apply.`, 'info');
  },

  removeDomain(idx) {
    const removed = this.config.domains.splice(idx, 1);
    this.render();
    SentinelApp.showToast(`Domain rule ${removed} removed from draft. Click "Save Changes" to apply.`, 'info');
  },

  async save() {
    const enabledToggle = document.getElementById('whitelist-enabled-toggle');
    const directAccessToggle = document.getElementById('whitelist-direct-toggle');

    const payload = {
      enabled: enabledToggle ? enabledToggle.checked : true,
      allowDirectAccess: directAccessToggle ? directAccessToggle.checked : false,
      domains: this.config.domains
    };

    try {
      const res = await SentinelAPI.saveWhitelist(payload);
      this.config = res.config;
      this.render();
      SentinelApp.showToast('Whitelist configuration successfully saved!', 'success');
    } catch (err) {
      SentinelApp.showToast('Failed to save whitelist: ' + err.message, 'error');
    }
  },

  async testRule() {
    const input = document.getElementById('test-origin-input');
    const resultBox = document.getElementById('test-origin-result');
    if (!input || !resultBox) return;

    const origin = input.value.trim();
    if (!origin) {
      SentinelApp.showToast('Please enter an Origin URL to test!', 'info');
      return;
    }

    resultBox.style.display = 'block';
    resultBox.innerHTML = `<span class="text-muted" style="font-size:0.85rem;"><i class="fas fa-spinner fa-spin"></i> Testing ${origin}...</span>`;

    try {
      const res = await SentinelAPI.testWhitelist(origin);
      if (res.allowed) {
        resultBox.innerHTML = `
          <div class="callout callout-success mb-0">
            <h5><i class="fas fa-check-circle text-success"></i> ALLOWED</h5>
            <p>Origin <code>${origin}</code> is allowed by security policy.</p>
            <small class="text-muted">Matched rule: <strong>${res.matchedRule || 'Whitelist Disabled / Direct Access'}</strong></small>
          </div>
        `;
      } else {
        resultBox.innerHTML = `
          <div class="callout callout-danger mb-0">
            <h5><i class="fas fa-times-circle text-danger"></i> FORBIDDEN (403)</h5>
            <p>Origin <code>${origin}</code> does not match any allowed domain rules.</p>
          </div>
        `;
      }
    } catch (err) {
      resultBox.innerHTML = `<div class="callout callout-danger"><p>Test failed: ${err.message}</p></div>`;
    }
  }
};

window.SentinelWhitelist = SentinelWhitelist;
