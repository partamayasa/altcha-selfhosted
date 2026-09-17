/**
 * ALTCHA Sentinel - Logs & Audit Stream Module
 */

const SentinelLogs = {
  currentLogs: [],
  page: 1,
  limit: 50,
  totalPages: 1,

  async init() {
    await this.populateDateFilter();
    await this.refresh();
  },

  async populateDateFilter() {
    try {
      const dates = await SentinelAPI.getLogDates();
      const select = document.getElementById('logs-date-filter');
      const dashSelect = document.getElementById('dashboard-date-filter');
      
      if (!dates || dates.length === 0) return;

      const populate = (sel) => {
        if (!sel) return;
        sel.innerHTML = '';
        dates.forEach((d, idx) => {
          const opt = document.createElement('option');
          opt.value = d;
          opt.textContent = `${d} ${idx === 0 ? '(Latest)' : ''}`;
          sel.appendChild(opt);
        });
      };

      populate(select);
      populate(dashSelect);
    } catch (err) {
      console.warn('Failed to load log dates:', err);
    }
  },

  async refresh() {
    const tableBody = document.getElementById('logs-table-body');
    if (tableBody) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">Loading audit logs</td></tr>`;
    }

    try {
      const date = document.getElementById('logs-date-filter')?.value || '';
      const status = document.getElementById('logs-status-filter')?.value || '';
      const search = document.getElementById('logs-search-input')?.value || '';

      const res = await SentinelAPI.getLogs({
        date,
        status,
        search,
        page: this.page,
        limit: this.limit
      });

      this.currentLogs = res.logs || [];
      this.totalPages = res.totalPages || 1;
      this.renderTable(this.currentLogs);
      this.renderPagination(res.total, res.page, res.limit);
    } catch (err) {
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--status-danger);">Failed to load logs: ${err.message}</td></tr>`;
      }
    }
  },

  renderTable(logs) {
    const tableBody = document.getElementById('logs-table-body');
    if (!tableBody) return;

    if (logs.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">No logs match the current search criteria.</td></tr>`;
      return;
    }

    let html = '';
    logs.forEach((item, idx) => {
      let badgeClass = 'badge-success';
      if (item.status === 204) badgeClass = 'badge-info';
      else if (item.status === 403) badgeClass = 'badge-warning';
      else if (item.status === 429) badgeClass = 'badge-danger';
      else if (item.status >= 500) badgeClass = 'badge-danger';

      const resultBadge = item.isSuccess
        ? `<span class="badge badge-success">OK</span>`
        : `<span class="badge badge-danger">FAIL</span>`;

      const timeStr = item.timestamp ? item.timestamp.split('T')[1]?.replace('Z', '') : '-';

      html += `
        <tr onclick="SentinelLogs.openDetail(${idx})" style="cursor:pointer;">
          <td style="font-family:var(--font-family-mono);font-size:0.8rem;color:#6c757d;">${timeStr}</td>
          <td><code style="font-size:0.85rem;">${item.ip}</code></td>
          <td>
            <span class="badge badge-secondary">${item.method}</span>
            <span style="font-family:var(--font-family-mono);font-size:0.85rem;margin-left:4px;">${item.url}</span>
          </td>
          <td><span class="badge ${badgeClass}">${item.status}</span></td>
          <td style="font-family:var(--font-family-mono);font-size:0.8rem;">${item.duration}</td>
          <td style="font-family:var(--font-family-mono);font-size:0.85rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${item.origin || '-'}
          </td>
          <td>${resultBadge}</td>
        </tr>
      `;
    });

    tableBody.innerHTML = html;
  },

  renderPagination(total, page, limit) {
    const infoEl = document.getElementById('logs-pagination-info');
    const prevBtn = document.getElementById('logs-prev-btn');
    const nextBtn = document.getElementById('logs-next-btn');

    if (infoEl) {
      const start = total > 0 ? (page - 1) * limit + 1 : 0;
      const end = Math.min(page * limit, total);
      infoEl.textContent = `Showing ${start} to ${end} of ${total} entries`;
    }

    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= this.totalPages;
  },

  nextPage() {
    if (this.page < this.totalPages) {
      this.page++;
      this.refresh();
    }
  },

  prevPage() {
    if (this.page > 1) {
      this.page--;
      this.refresh();
    }
  },

  openDetail(idx) {
    const item = this.currentLogs[idx];
    if (!item) return;

    const modal = document.getElementById('log-detail-modal');
    const content = document.getElementById('log-detail-content');
    if (!modal || !content) return;

    let badgeClass = 'badge-success';
    if (item.status === 204) badgeClass = 'badge-info';
    else if (item.status === 403) badgeClass = 'badge-warning';
    else if (item.status === 429) badgeClass = 'badge-danger';
    else if (item.status >= 500) badgeClass = 'badge-danger';

    content.innerHTML = `
      <table class="table table-bordered table-striped">
        <tbody>
          <tr>
            <th style="width:35%;">Timestamp (UTC)</th>
            <td><code>${item.timestamp}</code></td>
          </tr>
          <tr>
            <th>Client IP Address</th>
            <td><strong>${item.ip}</strong></td>
          </tr>
          <tr>
            <th>Request Target</th>
            <td><span class="badge badge-secondary">${item.method}</span> <code>${item.url}</code></td>
          </tr>
          <tr>
            <th>HTTP Status</th>
            <td><span class="badge ${badgeClass}">${item.status}</span></td>
          </tr>
          <tr>
            <th>Execution Latency</th>
            <td>${item.duration} (${item.durationMs}ms)</td>
          </tr>
          <tr>
            <th>Request Origin</th>
            <td><code>${item.origin || '-'}</code></td>
          </tr>
          <tr>
            <th>Execution Result</th>
            <td>
              <div class="code-box" style="margin:0;">
                <pre>${item.result}</pre>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    `;

    modal.classList.add('open');
  },

  closeDetail() {
    const modal = document.getElementById('log-detail-modal');
    if (modal) modal.classList.remove('open');
  },

  exportCSV() {
    if (!this.currentLogs || this.currentLogs.length === 0) {
      SentinelApp.showToast('No log data available to export', 'info');
      return;
    }

    const headers = ['Timestamp', 'IP', 'Method', 'URL', 'Status', 'Duration', 'Origin', 'Result'];
    const rows = this.currentLogs.map(l => [
      `"${l.timestamp}"`,
      `"${l.ip}"`,
      `"${l.method}"`,
      `"${l.url}"`,
      l.status,
      `"${l.duration}"`,
      `"${(l.origin || '').replace(/"/g, '""')}"`,
      `"${(l.result || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `altcha-manager-logs-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    SentinelApp.showToast('Log CSV file successfully exported!', 'success');
  }
};

window.SentinelLogs = SentinelLogs;
