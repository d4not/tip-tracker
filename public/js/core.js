// Shared client runtime: toasts, fetch wrapper with CSRF, currency formatting,
// modal + keyboard helpers, focus trap, delegated click actions.

(function () {
  'use strict';

  // ---------- CSRF ----------
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) return meta.getAttribute('content');
    const m = document.cookie.match(/(?:^|; )csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  // ---------- Toasts ----------
  const toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  toastContainer.setAttribute('role', 'status');
  toastContainer.setAttribute('aria-live', 'polite');
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(toastContainer));

  function toast(message, kind = 'info', opts = {}) {
    const timeout = opts.timeout ?? (kind === 'error' ? 8000 : 5000);
    const action = opts.action;
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    el.appendChild(text);
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        try { action.onClick(); } catch {}
        dismiss();
      });
      el.appendChild(btn);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '&times;';
    close.addEventListener('click', dismiss);
    el.appendChild(close);

    toastContainer.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    let t = timeout ? setTimeout(dismiss, timeout) : null;

    function dismiss() {
      if (t) clearTimeout(t);
      t = null;
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    }
    return { dismiss };
  }

  window.notify = {
    info: (m, o) => toast(m, 'info', o),
    success: (m, o) => toast(m, 'success', o),
    error: (m, o) => toast(m, 'error', o),
    warn: (m, o) => toast(m, 'warn', o)
  };

  // ---------- fetch wrapper ----------
  async function fetchJSON(url, options = {}) {
    const opts = { ...options };
    const method = (opts.method || 'GET').toUpperCase();
    opts.headers = { Accept: 'application/json', ...(opts.headers || {}) };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      opts.headers['X-CSRF-Token'] = getCsrfToken();
    }
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
      opts.body = JSON.stringify(opts.body);
      opts.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, opts);
    const ct = res.headers.get('Content-Type') || '';
    const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : null;
    if (!res.ok) {
      const err = new Error((body && body.error) || res.statusText || 'Request failed');
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }
  window.fetchJSON = fetchJSON;

  // ---------- currency / numbers ----------
  const meta = document.querySelector('meta[name="locale"]');
  const locale = (meta && meta.content) || undefined;
  const curMeta = document.querySelector('meta[name="currency"]');
  const currency = (curMeta && curMeta.content) || 'USD';

  const currencyFmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
  window.fmtCurrency = (cents) => currencyFmt.format((Number(cents) || 0) / 100);
  window.fmtCurrencyDollars = (n) => currencyFmt.format(Number.isFinite(Number(n)) ? Number(n) : 0);

  function hydrateCurrency(root = document) {
    root.querySelectorAll('[data-cents]').forEach((el) => {
      if (el.dataset.hydrated) return;
      el.textContent = window.fmtCurrency(el.dataset.cents);
      el.dataset.hydrated = '1';
    });
  }
  window.hydrateCurrency = hydrateCurrency;
  document.addEventListener('DOMContentLoaded', () => hydrateCurrency());

  // ---------- busy buttons ----------
  window.withBusy = async function (btn, busyLabel, fn) {
    if (!btn) return fn();
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (busyLabel) btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${busyLabel}`;
    try { return await fn(); }
    finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = original;
    }
  };

  // ---------- modal helpers + focus trap ----------
  let lastFocused = null;

  function trapFocus(modal, e) {
    if (e.key !== 'Tab') return;
    const focusables = modal.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input:not([type="hidden"]):not([disabled]), select, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  window.openModal = function (id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    lastFocused = document.activeElement;
    modal.classList.add('open');
    const focusable = modal.querySelector('[autofocus], input, button, select, textarea');
    if (focusable) setTimeout(() => focusable.focus(), 30);
    const keyHandler = (e) => {
      if (e.key === 'Escape') window.closeModal(id);
      else trapFocus(modal, e);
    };
    modal._keyHandler = keyHandler;
    document.addEventListener('keydown', keyHandler);
  };
  window.closeModal = function (id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('open');
    if (modal._keyHandler) document.removeEventListener('keydown', modal._keyHandler);
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  };

  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('modal')) {
      window.closeModal(e.target.id);
    }
  });

  // ---------- delegated actions ----------
  // Elements with data-action="name" trigger registered handlers on click.
  const handlers = Object.create(null);
  window.registerAction = (name, fn) => { handlers[name] = fn; };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const name = el.dataset.action;
    if (!handlers[name]) return;
    handlers[name](el, e);
  });

  // ---------- html escape ----------
  window.escapeHtml = (str) =>
    String(str == null ? '' : str).replace(/[&<>"']/g, (s) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[s]));

  // ---------- Auto-submit forms (e.g. language + currency switchers) ----------
  document.addEventListener('change', (e) => {
    const form = e.target.closest('form[data-autosubmit]');
    if (form && form.contains(e.target)) form.submit();
  });

  // ---------- dirty/unsaved guard ----------
  let dirty = false;
  window.markDirty = () => { dirty = true; };
  window.markClean = () => { dirty = false; };
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
})();
