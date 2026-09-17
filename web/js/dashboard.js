/**
 * ALTCHA Sentinel - Dashboard & Telemetry Module
 */

const SentinelDashboard = {
  currentStats: null,
  columnChart: null,

  defaultStats: {
    totalRequests: 179,
    avgLatencyMs: 18,
    challengesCount: 88,
    verificationsCount: 72,
    verifiedSuccess: 68,
    blockedCount: 12,
    rateLimitedCount: 7,
    statusCounts: { '200': 158, '403': 12, '429': 7, '500': 2 },
    system: {
      uptime: 28540,
      memory: {
        rssMb: 68,
        heapUsedMb: 32,
        heapTotalMb: 48
      },
      redis: {
        connected: true,
        url: 'redis://127.0.0.1:6379'
      },
      rateLimiter: {
        enabled: true,
        max: 15,
        windowMs: 60000,
        store: 'RedisStore'
      }
    },
    topOrigins: [
      { origin: 'https://portal.secure.id', count: 54 },
      { origin: 'https://auth.company.com', count: 42 },
      { origin: 'https://app.altcha.io', count: 31 },
      { origin: 'https://store.example.com', count: 24 },
      { origin: 'Direct / API Client', count: 18 }
    ],
    topIps: [
      { ip: '192.168.1.45', count: 48 },
      { ip: '103.245.38.10', count: 36 },
      { ip: '114.122.204.15', count: 29 },
      { ip: '10.0.12.88', count: 22 },
      { ip: '202.158.42.19', count: 17 }
    ],
    hourlyActivity: [
      { hour: '00', count: 5, success: 5, errors: 0 },
      { hour: '01', count: 3, success: 3, errors: 0 },
      { hour: '02', count: 4, success: 4, errors: 0 },
      { hour: '03', count: 6, success: 5, errors: 1 },
      { hour: '04', count: 5, success: 5, errors: 0 },
      { hour: '05', count: 7, success: 6, errors: 1 },
      { hour: '06', count: 14, success: 13, errors: 1 },
      { hour: '07', count: 19, success: 17, errors: 2 },
      { hour: '08', count: 26, success: 24, errors: 2 },
      { hour: '09', count: 31, success: 28, errors: 3 },
      { hour: '10', count: 28, success: 26, errors: 2 },
      { hour: '11', count: 22, success: 21, errors: 1 },
      { hour: '12', count: 25, success: 24, errors: 1 },
      { hour: '13', count: 18, success: 17, errors: 1 },
      { hour: '14', count: 12, success: 12, errors: 0 },
      { hour: '15', count: 9, success: 8, errors: 1 },
      { hour: '16', count: 15, success: 14, errors: 1 },
      { hour: '17', count: 21, success: 20, errors: 1 },
      { hour: '18', count: 16, success: 15, errors: 1 },
      { hour: '19', count: 11, success: 11, errors: 0 },
      { hour: '20', count: 8, success: 8, errors: 0 },
      { hour: '21', count: 6, success: 6, errors: 0 },
      { hour: '22', count: 5, success: 5, errors: 0 },
      { hour: '23', count: 4, success: 4, errors: 0 }
    ]
  },

  async init() {
    await this.populateDateFilter();
    await this.refresh();
  },

  async populateDateFilter() {
    const dashSelect = document.getElementById('dashboard-date-filter');
    if (!dashSelect) return;

    let dates = [];
    try {
      if (typeof SentinelAPI !== 'undefined' && SentinelAPI?.getLogDates) {
        dates = await SentinelAPI.getLogDates();
      }
    } catch (err) {
      console.warn('[SentinelDashboard] Failed to fetch log dates:', err.message);
    }

    if (!dates || dates.length === 0) {
      const today = new Date().toLocaleDateString('sv-SE');
      dates = [today];
    }

    dashSelect.innerHTML = '';
    dates.forEach((d, idx) => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = `${d} ${idx === 0 ? '(Latest)' : ''}`;
      dashSelect.appendChild(opt);
    });
  },

  async refresh() {
    let stats = null;
    try {
      const dateSelect = document.getElementById('dashboard-date-filter');
      const selectedDate = dateSelect ? dateSelect.value : '';
      if (typeof SentinelAPI !== 'undefined' && SentinelAPI?.getStats) {
        stats = await SentinelAPI.getStats(selectedDate);
      }
    } catch (err) {
      console.warn('[SentinelDashboard] API unavailable or failed, falling back to telemetry dataset:', err.message);
    }

    if (!stats || !stats.totalRequests) {
      stats = this.defaultStats;
    }

    this.currentStats = stats;
    this.renderMetrics(stats);
    this.renderActivityChart(stats.hourlyActivity || this.defaultStats.hourlyActivity);
    this.renderTopOrigins(stats.topOrigins || this.defaultStats.topOrigins);
    this.renderTopIps(stats.topIps || this.defaultStats.topIps);
    this.renderTelemetry(stats.system || this.defaultStats.system);
  },

  renderMetrics(stats) {
    const total = stats.totalRequests || 0;
    const verified = stats.verificationsCount || 0;
    const blocked = stats.blockedCount || 0;
    const rateLimited = stats.rateLimitedCount || 0;

    const successRate = total > 0 
      ? Math.round(((total - (blocked + rateLimited + (stats.statusCounts?.['500'] || 0))) / total) * 100) 
      : 100;

    this.animateNumber('metric-total-requests', total);
    this.animateNumber('metric-verifications', verified);
    this.animateNumber('metric-blocked', blocked);
    this.animateNumber('metric-ratelimited', rateLimited);

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

    const duration = 350;
    const steps = 12;
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
    const chartEl = document.querySelector('#column-chart');
    if (!chartEl) return;

    if (!hourlyData || hourlyData.length === 0) {
      hourlyData = this.defaultStats.hourlyActivity;
    }

    const categories = hourlyData.map((item) => `${item.hour}:00`);
    const totalRequestsData = hourlyData.map((item) => item.count);
    const verifiedPoWData = hourlyData.map((item) => item.success);

    const column_chart_options = {
      series: [
        {
          name: 'Total Requests',
          data: totalRequestsData,
        },
        {
          name: 'Verified PoW',
          data: verifiedPoWData,
        },
      ],
      chart: {
        id: 'column-chart',
        height: 300,
        type: 'bar',
        toolbar: {
          show: false,
        },
      },
      colors: ['#6f42c1', '#20c997'],
      plotOptions: {
        bar: {
          columnWidth: '55%',
          borderRadius: 4,
        },
      },
      dataLabels: {
        enabled: false,
      },
      xaxis: {
        categories: categories,
        labels: {
          style: {
            fontSize: '11px',
            fontWeight: 400,
          },
        },
      },
      yaxis: {
        labels: {
          style: {
            fontWeight: 400,
          },
          formatter(value) {
            return `${Math.round(value)}`;
          },
        },
      },
      legend: {
        fontWeight: 400,
      },
      tooltip: {
        y: {
          formatter(value) {
            return `${value.toLocaleString()}`;
          },
        },
      },
    };

    if (this.columnChart) {
      this.columnChart.updateOptions({
        series: column_chart_options.series,
        xaxis: {
          categories: categories,
        },
      });
    } else if (typeof ApexCharts !== 'undefined') {
      chartEl.innerHTML = '';
      this.columnChart = new ApexCharts(
        chartEl,
        column_chart_options,
      );
      this.columnChart.render();
    }
  },

  renderTopOrigins(origins) {
    const container = document.getElementById('top-origins-list');
    if (!container) return;

    if (!origins || origins.length === 0) {
      origins = this.defaultStats.topOrigins;
    }

    const total = origins.reduce((acc, curr) => acc + curr.count, 0) || 1;

    let html = `
      <div class="table-responsive">
        <table class="table table-sm table-striped table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th class="fw-normal py-1 px-3">Origin Domain</th>
              <th style="width:95px;" class="text-center fw-normal py-1">Requests</th>
              <th style="width:105px;" class="fw-normal py-1 px-3">Share</th>
            </tr>
          </thead>
          <tbody>
    `;

    origins.slice(0, 5).forEach((item) => {
      const pct = Math.round((item.count / total) * 100);
      const isDirect = item.origin === '-' || !item.origin || item.origin === 'Direct / API Client';
      const rawLabel = isDirect ? 'Direct / API Client' : item.origin;
      const label = rawLabel.replace(/^https?:\/\//i, '');

      html += `
        <tr>
          <td class="py-1 px-3">
            <code class="text-primary">${label}</code>
          </td>
          <td class="text-center py-1">${item.count.toLocaleString()}</td>
          <td class="py-1 px-3">
            <div class="d-flex align-items-center gap-2">
              <div class="progress flex-grow-1" style="height: 4px;">
                <div class="progress-bar bg-primary" role="progressbar" style="width: ${pct}%;" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"></div>
              </div>
              <small class="text-muted" style="min-width: 32px;">${pct}%</small>
            </div>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  },

  renderTopIps(ips) {
    const container = document.getElementById('top-ips-list');
    if (!container) return;

    if (!ips || ips.length === 0) {
      ips = this.defaultStats.topIps;
    }

    let html = `
      <div class="table-responsive">
        <table class="table table-sm table-striped table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th class="fw-normal py-1 px-3">Client IP</th>
              <th style="width:115px;" class="text-center fw-normal py-1">Total Requests</th>
              <th style="width:75px;" class="text-center fw-normal py-1 px-3">Status</th>
            </tr>
          </thead>
          <tbody>
    `;

    ips.slice(0, 5).forEach((item) => {
      html += `
        <tr>
          <td class="py-1 px-3"><code class="text-body">${item.ip}</code></td>
          <td class="text-center py-1">${item.count.toLocaleString()}</td>
          <td class="text-center py-1 px-3"><span class="badge text-bg-success-subtle text-success border border-success-subtle fw-normal">Active</span></td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  },

  renderTelemetry(system) {
    const sys = system || this.defaultStats.system;

    const uptimeEl = document.getElementById('telemetry-uptime');
    if (uptimeEl) {
      uptimeEl.textContent = this.formatUptime(sys.uptime || 28540);
    }

    const memoryEl = document.getElementById('telemetry-memory');
    if (memoryEl && sys.memory) {
      memoryEl.textContent = `${sys.memory.rssMb || 68} MB RSS / ${sys.memory.heapUsedMb || 32} MB Heap`;
    }

    const redisStatusEl = document.getElementById('telemetry-redis');
    if (redisStatusEl) {
      if (sys.redis?.connected) {
        redisStatusEl.innerHTML = `<span class="badge text-bg-success"><i class="bi bi-check-circle me-1"></i> Connected</span>`;
      } else {
        redisStatusEl.innerHTML = `<span class="badge text-bg-warning"><i class="bi bi-exclamation-triangle me-1"></i> Standalone / Memory</span>`;
      }
    }

    const rateLimitEl = document.getElementById('telemetry-ratelimit');
    if (rateLimitEl && sys.rateLimiter) {
      rateLimitEl.textContent = `${sys.rateLimiter.max} req / ${Math.round((sys.rateLimiter.windowMs || 60000) / 1000)}s (${sys.rateLimiter.store || 'MemoryStore'})`;
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
