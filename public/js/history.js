(function () {
  'use strict';
  const page = document.querySelector('[data-page="history"]');
  if (!page) return;
  const isAdmin = page.dataset.admin === '1';

  window.registerAction('print', () => window.print());

  window.registerAction('view-detail', async (el) => {
    const date = el.dataset.date;
    if (!isAdmin) {
      window.notify.info('Sign in as admin to see per-employee details.');
      return;
    }
    try {
      const data = await window.fetchJSON('/api/tips/' + date);
      const perPerson = data.employees && data.employees.length
        ? data.total_cents / data.employees.length
        : data.total_cents;

      const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
      document.getElementById('modalTitle').textContent = dateLabel;

      const lines = [
        `<div class="stats-grid modal-stats">`,
        `<div class="stat-card"><div class="value">${window.fmtCurrency(data.total_cents)}</div><div class="label">Total</div></div>`,
        `<div class="stat-card"><div class="value">${data.employees?.length || 0}</div><div class="label">People</div></div>`,
        `<div class="stat-card"><div class="value">${window.fmtCurrency(perPerson)}</div><div class="label">Per person</div></div>`,
        `</div>`
      ];
      if (data.notes) lines.push(`<p class="modal-notes"><strong>Notes:</strong> ${window.escapeHtml(data.notes)}</p>`);

      if (data.employees && data.employees.length) {
        lines.push(`<h3 class="modal-subhead">Employees</h3>`);
        const seen = new Set();
        for (const e of data.employees) {
          if (seen.has(e.employee_id)) continue;
          seen.add(e.employee_id);
          const override = e.is_override ? ' <span class="badge-inactive">override</span>' : '';
          lines.push(`
            <div class="employee-row">
              <strong>${window.escapeHtml(e.employee_name)}${override}</strong>
              <span class="amount">${window.fmtCurrency(e.individual_cents ?? perPerson)}</span>
            </div>`);
        }
        lines.push(`<div class="modal-actions"><a href="/admin?date=${encodeURIComponent(date)}" class="btn btn-primary">Edit this day</a></div>`);
      }

      document.getElementById('modalBody').innerHTML = lines.join('\n');
      window.openModal('detailModal');
    } catch (err) { window.notify.error(err.message); }
  });

  window.registerAction('close-detail', () => window.closeModal('detailModal'));
})();
