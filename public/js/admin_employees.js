(function () {
  'use strict';
  const page = document.querySelector('[data-page="admin-employees"]');
  if (!page) return;

  const nameInput = document.getElementById('new-employee');
  const addBtn = document.getElementById('btn-add');
  const list = document.getElementById('employee-list');
  const filter = document.getElementById('filter');
  const noMatches = document.getElementById('no-matches');

  async function addEmployee() {
    const name = (nameInput.value || '').trim();
    if (!name) return window.notify.error('Please enter a name');
    try {
      await window.withBusy(addBtn, '…', async () => {
        const data = await window.fetchJSON('/api/employees', { method: 'POST', body: { name } });
        window.notify.success(data.reactivated ? `${name} reactivated` : `${name} added`);
        setTimeout(() => location.reload(), 500);
      });
    } catch (err) { window.notify.error(err.message); }
  }

  if (nameInput) nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addEmployee(); });
  window.registerAction('add-employee', addEmployee);

  window.registerAction('edit-employee', async (el) => {
    const id = el.dataset.id;
    const current = document.getElementById('emp-name-' + id).textContent.trim();
    const next = prompt('New name:', current);
    if (!next || !next.trim() || next.trim() === current) return;
    try {
      await window.fetchJSON('/api/employees/' + id, { method: 'PUT', body: { name: next.trim() } });
      document.getElementById('emp-name-' + id).textContent = next.trim();
      window.notify.success('Updated');
    } catch (err) { window.notify.error(err.message); }
  });

  window.registerAction('delete-employee', async (el) => {
    const id = el.dataset.id;
    const name = el.dataset.name || 'this employee';
    if (!confirm(`Remove ${name}? Past records keep them; they stop appearing in new ones.`)) return;
    try {
      const data = await window.fetchJSON('/api/employees/' + id, { method: 'DELETE' });
      const row = document.getElementById('emp-row-' + id);
      if (row) row.remove();
      window.notify.success(`${name} removed.`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await window.fetchJSON('/api/employees/' + id + '/restore', { method: 'POST' });
              window.notify.success(`${name} restored`);
              setTimeout(() => location.reload(), 400);
            } catch (err) { window.notify.error(err.message); }
          }
        }
      });
    } catch (err) { window.notify.error(err.message); }
  });

  window.registerAction('create-samples', async (btn) => {
    try {
      await window.withBusy(btn, '…', async () => {
        const data = await window.fetchJSON('/admin/create-sample-employees', { method: 'POST' });
        window.notify.success(data.message);
        setTimeout(() => location.reload(), 700);
      });
    } catch (err) { window.notify.error(err.message); }
  });

  if (filter && list) {
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      let shown = 0;
      list.querySelectorAll('.employee-row').forEach((row) => {
        const match = !q || (row.dataset.name || '').includes(q);
        row.style.display = match ? '' : 'none';
        if (match) shown++;
      });
      if (noMatches) noMatches.style.display = shown === 0 ? 'block' : 'none';
    });
  }
})();
