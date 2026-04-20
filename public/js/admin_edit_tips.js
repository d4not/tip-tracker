(function () {
  'use strict';
  const page = document.querySelector('[data-page="admin-edit-tips"]');
  if (!page) return;

  const filter = document.getElementById('filter');
  const tbody = document.getElementById('tbody');
  const noMatches = document.getElementById('no-matches');

  if (filter && tbody) {
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      let shown = 0;
      tbody.querySelectorAll('tr').forEach((row) => {
        const match = !q || (row.dataset.search || '').includes(q);
        row.style.display = match ? '' : 'none';
        if (match) shown++;
      });
      if (noMatches) noMatches.style.display = shown === 0 ? 'block' : 'none';
    });
  }

  // Edit flow
  const selectedSet = new Set();
  const overrides = new Map();
  let editingDate = null;

  function escapeHtml(s) { return window.escapeHtml(s); }

  async function openEditor(date) {
    editingDate = date;
    selectedSet.clear();
    overrides.clear();
    try {
      const [tip, allEmployees] = await Promise.all([
        window.fetchJSON('/api/tips/' + date),
        window.fetchJSON('/api/employees?include_inactive=1')
      ]);
      (tip.employees || []).forEach((e) => {
        selectedSet.add(e.employee_id);
        if (e.is_override) overrides.set(e.employee_id, e.individual_cents);
      });

      const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
      document.getElementById('modalTitle').textContent = dateLabel;

      const activeFirst = allEmployees
        .filter((e) => e.active || selectedSet.has(e.id))
        .sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : (a.active ? -1 : 1)));

      const form = document.createElement('form');
      form.className = 'edit-form';
      form.addEventListener('submit', onSave);

      const amountCents = tip.total_cents;
      form.innerHTML = `
        <div class="form-group">
          <label>Total amount</label>
          <input type="number" id="edit-amount" step="0.01" min="0" value="${(amountCents / 100).toFixed(2)}" required>
          <small id="edit-preview" class="hint"></small>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="edit-notes" maxlength="500" rows="2">${escapeHtml(tip.notes || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Who worked</label>
          <div class="checkbox-grid" id="edit-grid">
            ${activeFirst.map((e) => {
              const checked = selectedSet.has(e.id);
              const overrideCents = overrides.get(e.id);
              return `
                <label class="checkbox-card${checked ? ' selected' : ''}" data-id="${e.id}" data-name="${escapeHtml(e.name)}">
                  <input type="checkbox" value="${e.id}" ${checked ? 'checked' : ''}>
                  <span class="checkbox-card-name">${escapeHtml(e.name)}${!e.active ? ' <span class="badge-inactive">inactive</span>' : ''}</span>
                  <button type="button" class="chip override-chip" data-action="override" ${overrideCents == null ? 'hidden' : ''}>${overrideCents == null ? '' : window.fmtCurrency(overrideCents)}</button>
                  <button type="button" class="chip-btn" data-action="override" aria-label="Override share">⚙</button>
                </label>`;
            }).join('')}
          </div>
          <div class="hint" style="margin-top:8px;">
            Selected: <span id="edit-selected-count">${selectedSet.size}</span>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-danger" data-action="delete-from-edit">Delete</button>
          <button type="button" class="btn btn-secondary" data-action="close-edit">Cancel</button>
          <button type="submit" class="btn btn-primary" id="edit-save-btn">Save</button>
        </div>
      `;

      const body = document.getElementById('editModalBody');
      body.innerHTML = '';
      body.appendChild(form);
      window.openModal('editModal');
      setTimeout(() => body.querySelector('#edit-amount').focus(), 30);

      const amountInput = body.querySelector('#edit-amount');
      const previewEl = body.querySelector('#edit-preview');
      const countEl = body.querySelector('#edit-selected-count');
      const grid = body.querySelector('#edit-grid');

      function updatePreview() {
        const amount = parseFloat(amountInput.value);
        if (!(amount > 0) || selectedSet.size === 0) { previewEl.textContent = ''; return; }
        const totalCents = Math.round(amount * 100);
        let overrideSum = 0;
        for (const [id, c] of overrides.entries()) if (selectedSet.has(id)) overrideSum += c;
        const remaining = totalCents - overrideSum;
        const nonOverride = [...selectedSet].filter((id) => !overrides.has(id)).length;
        if (nonOverride === 0) { previewEl.textContent = `All overrides — total ${window.fmtCurrency(overrideSum)}`; return; }
        const base = Math.floor(remaining / nonOverride);
        previewEl.textContent = `≈ ${window.fmtCurrency(base)} per person` + (remaining % nonOverride ? ' (±1¢)' : '');
      }

      function updateCard(id) {
        const card = grid.querySelector(`.checkbox-card[data-id="${id}"]`);
        if (!card) return;
        const cb = card.querySelector('input[type="checkbox"]');
        const on = selectedSet.has(id);
        cb.checked = on;
        card.classList.toggle('selected', on);
        const chip = card.querySelector('.override-chip');
        if (overrides.has(id)) {
          chip.hidden = false;
          chip.textContent = window.fmtCurrency(overrides.get(id));
        } else {
          chip.hidden = true;
          chip.textContent = '';
        }
      }

      grid.addEventListener('click', (e) => {
        const overrideBtn = e.target.closest('[data-action="override"]');
        if (!overrideBtn) return;
        e.preventDefault();
        e.stopPropagation();
        const card = overrideBtn.closest('.checkbox-card');
        const id = parseInt(card.dataset.id, 10);
        const current = overrides.has(id) ? (overrides.get(id) / 100).toFixed(2) : '';
        const input = prompt(`Override ${card.dataset.name}'s share (blank to remove):`, current);
        if (input === null) return;
        const val = input.trim();
        if (val === '') overrides.delete(id);
        else {
          const c = Math.round(parseFloat(val) * 100);
          if (!Number.isFinite(c) || c < 0) return window.notify.error('Invalid amount');
          overrides.set(id, c);
          selectedSet.add(id);
        }
        updateCard(id);
        countEl.textContent = selectedSet.size;
        updatePreview();
      });
      grid.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const id = parseInt(cb.value, 10);
          if (cb.checked) selectedSet.add(id);
          else { selectedSet.delete(id); overrides.delete(id); }
          updateCard(id);
          countEl.textContent = selectedSet.size;
          updatePreview();
        });
      });
      amountInput.addEventListener('input', updatePreview);
      updatePreview();
    } catch (err) { window.notify.error(err.message); }
  }

  async function onSave(event) {
    event.preventDefault();
    const amount = parseFloat(document.getElementById('edit-amount').value);
    const notes = document.getElementById('edit-notes').value;
    if (!(amount > 0)) return window.notify.error('Invalid amount');
    if (selectedSet.size === 0) return window.notify.error('Select at least one employee');

    const overridesBody = {};
    for (const [id, c] of overrides.entries()) if (selectedSet.has(id)) overridesBody[id] = c / 100;

    try {
      await window.withBusy(document.getElementById('edit-save-btn'), '…', async () => {
        await window.fetchJSON('/api/tips/' + editingDate, {
          method: 'PUT',
          body: { amount, notes, employees: [...selectedSet], overrides: overridesBody }
        });
        window.notify.success('Tips updated');
        window.closeModal('editModal');
        setTimeout(() => location.reload(), 400);
      });
    } catch (err) { window.notify.error(err.message); }
  }

  window.registerAction('edit-tip', (el) => openEditor(el.dataset.date));
  window.registerAction('close-edit', () => window.closeModal('editModal'));
  window.registerAction('delete-tip', (el) => {
    const date = el.dataset.date || editingDate;
    if (!date) return;
    document.getElementById('confirmMessage').textContent = `Delete tips for ${date}? You'll have a short window to undo.`;
    document.getElementById('confirm-delete-btn').dataset.date = date;
    window.closeModal('editModal');
    window.openModal('confirmModal');
  });
  window.registerAction('delete-from-edit', () => {
    const date = editingDate;
    if (!date) return;
    document.getElementById('confirmMessage').textContent = `Delete tips for ${date}? You'll have a short window to undo.`;
    document.getElementById('confirm-delete-btn').dataset.date = date;
    window.closeModal('editModal');
    window.openModal('confirmModal');
  });
  window.registerAction('close-confirm', () => window.closeModal('confirmModal'));
  window.registerAction('confirm-delete', async (btn) => {
    const date = btn.dataset.date;
    try {
      const res = await window.fetchJSON('/api/tips/' + date, { method: 'DELETE' });
      window.closeModal('confirmModal');
      window.notify.success(`Tips for ${date} deleted.`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await window.fetchJSON(`/api/tips/${date}/restore`, {
                method: 'POST',
                body: { token: res.undoToken }
              });
              window.notify.success('Restored');
              setTimeout(() => location.reload(), 400);
            } catch (err) { window.notify.error(err.message); }
          }
        }
      });
      // Remove row optimistically.
      const row = document.querySelector(`[data-search*="${date}"]`);
      if (row) row.remove();
    } catch (err) { window.notify.error(err.message); }
  });
})();
