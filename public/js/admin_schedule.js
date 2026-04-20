(function () {
  'use strict';
  const page = document.querySelector('[data-page="admin-schedule"]');
  if (!page) return;

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const { schedule = [] } = await window.fetchJSON('/api/schedule');
      schedule.forEach((emp) => (emp.weekdays || []).forEach((d) => {
        const cb = document.getElementById(`h-${emp.id}-${d}`);
        if (cb) cb.checked = true;
      }));
    } catch {}
  });

  document.querySelectorAll('.col-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const day = btn.dataset.day;
      const cbs = document.querySelectorAll(`.schedule-cb[data-day="${day}"]`);
      const anyUnchecked = [...cbs].some((cb) => !cb.checked);
      cbs.forEach((cb) => { cb.checked = anyUnchecked; });
      window.markDirty();
    });
  });

  document.querySelectorAll('.schedule-cb').forEach((cb) => {
    cb.addEventListener('change', () => window.markDirty());
  });

  window.registerAction('save-schedule', async (btn) => {
    const byEmployee = {};
    document.querySelectorAll('.schedule-cb').forEach((cb) => {
      const id = parseInt(cb.dataset.employee, 10);
      byEmployee[id] ??= [];
    });
    document.querySelectorAll('.schedule-cb:checked').forEach((cb) => {
      const id = parseInt(cb.dataset.employee, 10);
      byEmployee[id].push(parseInt(cb.dataset.day, 10));
    });
    try {
      await window.withBusy(btn, '…', async () => {
        await Promise.all(Object.keys(byEmployee).map((id) =>
          window.fetchJSON(`/api/employees/${id}/schedule`, {
            method: 'PUT',
            body: { weekdays: byEmployee[id] }
          })
        ));
        window.notify.success('Schedule saved');
        window.markClean();
      });
    } catch (err) { window.notify.error(err.message); }
  });
})();
