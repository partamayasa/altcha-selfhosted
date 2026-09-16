/**
 * ALTCHA Sentinel - Dashboard & Telemetry Module
 */

const SentinelDashboard = {
  currentStats: null,

  async init() {
    await this.refresh();
  },

  async refresh() {
    try {
      const dateSelect = document.getElementById('dashboard-date-filter');
      const selectedDate = dateSelect ? dateSelect.value : '';
      const stats = await SentinelAPI.getStats(selectedDate);
      this.currentStats = stats;
      this.renderMetrics(stats);
      this.renderActivityChart(stats.hourlyActivity || []);
      this.renderTopOrigins(stats.topOrigins || []);
      this.renderTopIps(stats.topIps || []);
      this.renderTelemetry(stats.system || {});
    } catch (err) {
      SentinelApp.showToast('Failed to load statistics data: ' + err.message, 'error');
    }
  },

  renderMetrics(stats) {
    const total = stats.totalRequests || 0;
    const challenges = stats.challengesCount || 0;
    const verified = stats.verificationsCount || 0;
    const blocked = stats.blockedCount || 0;
    const rateLimited = stats.rateLimitedCount || 0;
    const avgLatency = stats.avgLatencyMs || 0;

    const successRate = total > 0 
      ? Math.round(((total - (blocked + rateLimited + (stats.statusCounts?.['500'] || 0))) / total) * 100) 
      : 100;

    this.animateNumber('metric-total-requests', total);
    this.animateNumber('metric-challenges', challenges);
    this.animateNumber('metric-verifications', verified);
    this.animateNumber('metric-blocked', blocked);
    this.animateNumber('metric-ratelimited', rateLimited);
    
    const latencyEl = document.getElementById('metric-latency');
    if (latencyEl) latencyEl.textContent = `${avgLatency} ms`;

    const successRateEl = document.getElementById('metric-success-rate');
    if (successRateEl) successRateEl.textContent = `${successRate}% Success`;
  },

  animateNumber(id, targetVal) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
    if (current === targetVal) {
      el.textContent = targetVal.toLocaleString();
      return;
    }

    const duration = 400;
    const steps = 15;
    const stepDiff = (targetVal - current) / steps;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      const val = Math.round(current + stepDiff * step);
      el.textContent = val.toLocaleString();
      if (step >= steps) {
        clearInterval(timer);
        el.textContent = targetVal.toLocaleString();
      }
    }, duration / steps);
  },

  renderActivityChart(hourlyData) {
    const container = document.getElementById('hourly-activity-chart');
    if (!container) return;

    if (!hourlyData || hourlyData.length === 0) {
      container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:0.85rem;">No activity data recorded for this period.</div>`;
      return;
    }

    const maxCount = Math.max(...hourlyData.map(h => h.count), 10);

    let barsHtml = '<div class="bar-chart">';
    hourlyData.forEach(item => {
      const heightPercent = Math.max(Math.round((item.count / maxCount) * 100), item.count > 0 ? 6 : 2);
      const tooltip = `${item.hour}:00 - ${item.count} Req (${item.success} OK, ${item.errors} Err)`;
      
      barsHtml += `
        <div class="bar-col" title="${tooltip}">
          <div class="bar-fill" style="height: ${heightPercent}%;"></div>
          <span class="bar-label">${item.hour}</span>
        </div>
      `;
    });
    barsHtml += '</div>';

    container.innerHTML = barsHtml;
  },

  renderTopOrigins(origins) {
    const container = document.getElementById('top-origins-list');
    if (!container) return;

    if (origins.length === 0) {
      container.innerHTML = `<div class="p-3 text-muted text-center" style="font-size:0.85rem;">No origin records available.</div>`;
      return;
    }

    const total = origins.reduce((acc, curr) => acc + curr.count, 0) || 1;

    let html = `
      <table class="table table-striped table-valign-middle mb-0">
        <thead>
          <tr>
            <th>Origin Domain</th>
            <th style="width:120px;">Requests</th>
            <th style="width:80px;">Share</th>
          </tr>
        </thead>
        <tbody>
    `;

    origins.slice(0, 5).forEach((item) => {
      const pct = Math.round((item.count / total) * 100);
      const isDirect = item.origin === '-' || !item.origin;
      const label = isDirect ? 'Direct / No Origin' : item.origin;

      html += `
        <tr>
          <td>
            <code style="font-size:0.85rem;">${label}</code>
          </td>
          <td><strong>${item.count}</strong></td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="flex:1;height:6px;background:rgba(0,0,0,0.1);border-radius:3px;overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:var(--primary);"></div>
              </div>
              <small class="text-muted">${pct}%</small>
            </div>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  },

  renderTopIps(ips) {
    const container = document.getElementById('top-ips-list');
    if (!container) return;

    if (ips.length === 0) {
      container.innerHTML = `<div class="p-3 text-muted text-center" style="font-size:0.85rem;">No client IP records available.</div>`;
      return;
    }

    let html = `
      <table class="table table-striped table-valign-middle mb-0">
        <thead>
          <tr>
            <th>Client IP</th>
            <th style="width:120px;">Total Requests</th>
            <th style="width:90px;">Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    ips.slice(0, 5).forEach((item) => {
      html += `
        <tr>
          <td><code style="font-size:0.88rem;">${item.ip}</code></td>
          <td><strong>${item.count}</strong></td>
          <td><span class="badge badge-info">Active</span></td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  },

  renderTelemetry(system) {
    const uptimeEl = document.getElementById('telemetry-uptime');
    if (uptimeEl) {
      uptimeEl.textContent = this.formatUptime(system.uptime || 0);
    }

    const memoryEl = document.getElementById('telemetry-memory');
    if (memoryEl && system.memory) {
      memoryEl.textContent = `${system.memory.rssMb} MB RSS / ${system.memory.heapUsedMb} MB Heap`;
    }

    const redisStatusEl = document.getElementById('telemetry-redis');
    if (redisStatusEl) {
      if (system.redis?.connected) {
        redisStatusEl.innerHTML = `<span class="badge badge-success">Connected</span>`;
      } else {
        redisStatusEl.innerHTML = `<span class="badge badge-warning">Standalone / Memory</span>`;
      }
    }

    const rateLimitEl = document.getElementById('telemetry-ratelimit');
    if (rateLimitEl && system.rateLimiter) {
      rateLimitEl.textContent = `${system.rateLimiter.max} req / ${Math.round(system.rateLimiter.windowMs / 1000)}s (${system.rateLimiter.store})`;
    }
  },

  formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
};

window.SentinelDashboard = SentinelDashboard;
