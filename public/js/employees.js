(function () {
  'use strict';
  const meta = document.querySelector('[data-page="employees"]');
  if (!meta) return;

  const weekStr = meta.dataset.week;
  const employeeFilter = meta.dataset.employee || '';

  function navigateTo(dateStr) {
    let url = '/employees/' + dateStr;
    if (employeeFilter) url += '?employee=' + employeeFilter;
    window.location.href = url;
  }

  function changeWeek(direction) {
    const [y, m, d] = weekStr.split('-').map(Number);
    const date = new Date(y, m - 1, d + direction * 7, 12, 0, 0);
    const s = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    navigateTo(s);
  }

  window.registerAction('week-prev', () => changeWeek(-1));
  window.registerAction('week-next', () => changeWeek(1));
  window.registerAction('week-today', () => {
    const d = new Date();
    navigateTo(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  });

  const weekPicker = document.getElementById('weekPicker');
  if (weekPicker) {
    weekPicker.addEventListener('change', () => {
      if (weekPicker.value) navigateTo(weekPicker.value);
    });
  }

  const empSelect = document.getElementById('employeeSelect');
  if (empSelect) {
    empSelect.addEventListener('change', () => {
      const id = empSelect.value;
      window.location.href = id ? `/employees/${weekStr}?employee=${id}` : `/employees/${weekStr}`;
    });
  }

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowLeft') changeWeek(-1);
    else if (e.key === 'ArrowRight') changeWeek(1);
  });
})();
