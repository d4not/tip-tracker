(function () {
  'use strict';
  const page = document.querySelector('[data-page="admin"]');
  if (!page) return;

  const editDate = page.dataset.editDate || '';
  const dateInput = document.getElementById('tip-date');
  const amountInput = document.getElementById('total-amount');
  const notesInput = document.getElementById('day-notes');
  const grid = document.getElementById('employees-grid');
  const selectedCountEl = document.getElementById('selected-count');
  const previewEl = document.getElementById('per-person-preview');
  const statusEl = document.getElementById('status-msg');
  const saveBtn = document.getElementById('btn-save');
  const loadBtn = document.getElementById('btn-load');
  const scheduleBtn = document.getElementById('btn-schedule');

  // State: selected employees (Set of ids) and overrides (Map of id → cents).
  const selected = new Set();
  const overrides = new Map();

  function render() {
    if (!grid) return;
    grid.querySelectorAll('.checkbox-card').forEach((card) => {
      const id = parseInt(card.dataset.id, 10);
      const cb = card.querySelector('input[type="checkbox"]');
      const on = selected.has(id);
      cb.checked = on;
      card.classList.toggle('selected', on);
      const overrideChip = card.querySelector('.override-chip');
      if (overrides.has(id)) {
        overrideChip.hidden = false;
        overrideChip.textContent = window.fmtCurrency(overrides.get(id));
      } else {
        overrideChip.hidden = true;
        overrideChip.textContent = '';
      }
    });
    if (selectedCountEl) selectedCountEl.textContent = selected.size;
    updatePreview();
  }

  function updatePreview() {
    if (!previewEl || !amountInput) return;
    const amount = parseFloat(amountInput.value);
    if (!(amount > 0) || selected.size === 0) { previewEl.textContent = ''; return; }
    const totalCents = Math.round(amount * 100);
    let overrideSum = 0;
    for (const [id, c] of overrides.entries()) if (selected.has(id)) overrideSum += c;
    const remaining = totalCents - overrideSum;
    const nonOverride = [...selected].filter((id) => !overrides.has(id)).length;
    if (nonOverride === 0) {
      previewEl.textContent = `All overrides — total ${window.fmtCurrency(overrideSum)}.`;
      return;
    }
    const base = Math.floor(remaining / nonOverride);
    previewEl.textContent = `≈ ${window.fmtCurrency(base)} per person` + (remaining % nonOverride ? ' (±1¢)' : '');
  }

  function setStatus(text, type) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.dataset.type = type || '';
  }

  function selectAll(on) {
    selected.clear();
    if (on && grid) grid.querySelectorAll('.checkbox-card').forEach((c) => selected.add(parseInt(c.dataset.id, 10)));
    // If nothing is selected, drop overrides for missing ids.
    for (const id of [...overrides.keys()]) if (!selected.has(id)) overrides.delete(id);
    render();
    window.markDirty();
  }

  function toggleSelection(id) {
    if (selected.has(id)) { selected.delete(id); overrides.delete(id); }
    else selected.add(id);
    render();
    window.markDirty();
  }

  function promptOverride(id, name) {
    const current = overrides.has(id) ? (overrides.get(id) / 100).toFixed(2) : '';
    const input = prompt(`Override ${name}'s share (leave blank to remove):`, current);
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed === '') { overrides.delete(id); render(); window.markDirty(); return; }
    const cents = Math.round(parseFloat(trimmed) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      window.notify.error('Invalid amount');
      return;
    }
    overrides.set(id, cents);
    selected.add(id);
    render();
    window.markDirty();
  }

  if (grid) {
    // Override button: run the prompt and suppress the label's native toggle.
    grid.addEventListener('click', (e) => {
      const overrideBtn = e.target.closest('[data-action="override"]');
      if (!overrideBtn) return;
      e.preventDefault();
      e.stopPropagation();
      const card = overrideBtn.closest('.checkbox-card');
      promptOverride(parseInt(card.dataset.id, 10), card.dataset.name || '');
    });
    // Single source of truth: the checkbox's change event. Clicking the label
    // (anywhere in the card) already fires this via native behaviour.
    grid.querySelectorAll('.checkbox-card input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.value, 10);
        if (cb.checked) selected.add(id);
        else { selected.delete(id); overrides.delete(id); }
        render();
        window.markDirty();
      });
    });
  }

  if (amountInput) amountInput.addEventListener('input', () => { updatePreview(); window.markDirty(); });
  if (notesInput) notesInput.addEventListener('input', () => window.markDirty());

  window.registerAction('select-all', () => selectAll(true));
  window.registerAction('clear-selection', () => selectAll(false));
  window.registerAction('create-samples', async (btn) => {
    try {
      await window.withBusy(btn, '…', async () => {
        const data = await window.fetchJSON('/admin/create-sample-employees', { method: 'POST' });
        window.notify.success(data.message);
        setTimeout(() => location.reload(), 700);
      });
    } catch (err) { window.notify.error(err.message); }
  });

  async function applyRegularSchedule() {
    if (!dateInput || !dateInput.value) { setStatus('Pick a date first.', 'error'); return; }
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const weekday = new Date(y, m - 1, d).getDay();
    try {
      await window.withBusy(scheduleBtn, '…', async () => {
        const data = await window.fetchJSON('/api/employees-by-day/' + weekday);
        selected.clear();
        overrides.clear();
        (data.employeeIds || []).forEach((id) => selected.add(id));
        render();
        const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        setStatus(`Pre-selected ${selected.size} employee(s) for ${labels[weekday]}.`, 'success');
      });
    } catch {
      setStatus('Set up the weekly schedule first.', 'error');
    }
  }
  window.registerAction('apply-schedule', applyRegularSchedule);

  async function lookupDate() {
    if (!dateInput || !dateInput.value) return window.notify.error('Pick a date');
    const date = dateInput.value;
    if (amountInput) amountInput.value = '';
    if (notesInput) notesInput.value = '';
    selected.clear();
    overrides.clear();
    render();
    setStatus('Searching…', 'info');

    try {
      await window.withBusy(loadBtn, '…', async () => {
        try {
          const tip = await window.fetchJSON('/api/tips/' + date);
          if (amountInput) amountInput.value = (tip.total_cents / 100).toFixed(2);
          if (notesInput) notesInput.value = tip.notes || '';
          (tip.employees || []).forEach((e) => {
            selected.add(e.employee_id);
            if (e.is_override) overrides.set(e.employee_id, e.individual_cents);
          });
          render();
          setStatus(`Loaded ${selected.size} employee(s).`, 'success');
          window.markClean();
        } catch (err) {
          if (err.status === 404) {
            setStatus('No tips yet. Applying regular schedule…', 'info');
            return applyRegularSchedule();
          }
          throw err;
        }
      });
    } catch (err) { setStatus('Error: ' + err.message, 'error'); }
  }
  window.registerAction('load-date', lookupDate);

  async function submitTips() {
    if (!dateInput.value) return window.notify.error('Choose a date');
    const amount = parseFloat(amountInput.value);
    if (!(amount > 0)) return window.notify.error('Enter a valid amount');
    if (selected.size === 0) return window.notify.error('Select at least one employee');

    const body = {
      date: dateInput.value,
      amount,
      employees: [...selected],
      notes: notesInput.value || '',
      overrides: {}
    };
    for (const [id, cents] of overrides.entries()) {
      if (selected.has(id)) body.overrides[id] = cents / 100;
    }

    try {
      await window.withBusy(saveBtn, '…', async () => {
        const data = await window.fetchJSON('/api/tips', { method: 'POST', body });
        const perPerson = window.fmtCurrencyDollars(amount / selected.size);
        window.notify.success(data.updated ? `Updated · ${perPerson} per person` : `Saved · ${perPerson} per person`);
        amountInput.value = '';
        notesInput.value = '';
        selected.clear();
        overrides.clear();
        render();
        window.markClean();
      });
    } catch (err) { window.notify.error(err.message); }
  }
  window.registerAction('save-tips', submitTips);

  // Ctrl/Cmd+S saves
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      submitTips();
    }
  });

  // Auto-load when admin arrives via ?date=...
  if (editDate) {
    dateInput.value = editDate;
    lookupDate();
  }

  render();
})();
