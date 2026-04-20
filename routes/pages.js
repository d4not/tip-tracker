const express = require('express');
const { toLocalDateStr, currentWeekStart, weekStartFromStr, isDateStr } = require('../lib/dates');
const { safeRedirectPath } = require('../lib/validation');
const { verifyPassword } = require('../lib/auth');

module.exports = function pagesRouter(db, loginLimiter) {
  const router = express.Router();

  router.get('/', (_req, res) => res.render('home'));

  router.get('/login', (req, res) => {
    const redirectTo = safeRedirectPath(req.query.redirect, '/admin');
    res.render('login', { redirectTo, error: null });
  });

  router.post('/login', loginLimiter, (req, res) => {
    const redirectTo = safeRedirectPath(req.body.redirectTo, '/admin');
    if (verifyPassword(req.body.password)) {
      req.session.regenerate((err) => {
        if (err) return res.status(500).render('error', { status: 500 });
        req.session.authenticated = true;
        db.recordAudit('admin', 'login.success', null, { ip: req.ip });
        res.redirect(redirectTo);
      });
      return;
    }
    db.recordAudit('anon', 'login.fail', null, { ip: req.ip });
    res.status(401).render('login', { error: res.locals.t('login.error.wrong'), redirectTo });
  });

  router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  // Week-scoped employee view. Redirects to Monday of the given date, preserves query.
  router.get(['/employees', '/employees/:week'], (req, res, next) => {
    try {
      const weekParam = req.params.week;
      if (!weekParam || !isDateStr(weekParam)) {
        const weekStr = toLocalDateStr(currentWeekStart());
        const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        return res.redirect(302, '/employees/' + weekStr + q);
      }
      const weekStart = weekStartFromStr(weekParam);
      if (!weekStart) return res.redirect(302, '/employees/' + toLocalDateStr(currentWeekStart()));
      const weekStr = toLocalDateStr(weekStart);
      if (weekStr !== weekParam) {
        const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        return res.redirect(302, '/employees/' + weekStr + q);
      }

      const employees = db.getEmployees();
      const empId = req.query.employee ? parseInt(req.query.employee, 10) : null;
      if (req.query.employee != null && (!Number.isInteger(empId) || empId < 1)) {
        return res.redirect(302, '/employees/' + weekStr);
      }

      const tips = empId
        ? db.getTipsForEmployeeWeek(empId, weekStart)
        : db.getTipsForWeek(weekStart);

      const employeeTotals = db.getEmployeeTotalsForWeek(weekStart);
      const totalDistributedCents = employeeTotals.reduce((s, e) => s + (Number(e.week_total_cents) || 0), 0);
      const weekTotalCents = empId
        ? tips.reduce((s, t) => s + (Number(t.individual_cents) || 0), 0)
        : totalDistributedCents;

      res.render('employees', {
        employees,
        tips,
        week: weekStart,
        weekStr,
        selectedEmployeeId: empId,
        weekTotalCents,
        totalDistributedCents,
        employeeTotals
      });
    } catch (err) { next(err); }
  });

  router.get('/history', (req, res, next) => {
    try {
      const from = isDateStr(req.query.from) ? req.query.from : null;
      const to = isDateStr(req.query.to) ? req.query.to : null;
      const history = db.getHistory({ from, to });
      res.render('history', { history, from, to, error: null });
    } catch (err) { next(err); }
  });

  router.get('/history.csv', (req, res, next) => {
    try {
      const from = isDateStr(req.query.from) ? req.query.from : null;
      const to = isDateStr(req.query.to) ? req.query.to : null;
      const rows = db.getHistory({ from, to });
      const escape = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = ['date,total,total_employees,per_person,notes'];
      rows.forEach((r) => {
        lines.push([
          r.date,
          (r.total_cents / 100).toFixed(2),
          r.total_employees,
          (r.cents_per_employee / 100).toFixed(2),
          escape(r.notes || '')
        ].join(','));
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="tips-history${from ? '-' + from : ''}${to ? '-' + to : ''}.csv"`
      );
      res.send(lines.join('\n') + '\n');
    } catch (err) { next(err); }
  });

  // Language switch: POST with lang=en|es, sets a cookie and redirects back.
  router.post('/lang', (req, res) => {
    const lang = ['en', 'es'].includes(req.body.lang) ? req.body.lang : 'en';
    res.cookie('lang', lang, { maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    const back = safeRedirectPath(req.body.redirect, '/');
    res.redirect(back);
  });

  // Currency switch: POST with currency=USD|MXN|…, sets a cookie and redirects back.
  const { SUPPORTED_CURRENCIES } = require('../lib/money');
  router.post('/currency', (req, res) => {
    const cur = SUPPORTED_CURRENCIES.includes(req.body.currency) ? req.body.currency : 'USD';
    res.cookie('currency', cur, { maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    const back = safeRedirectPath(req.body.redirect, '/');
    res.redirect(back);
  });

  router.get('/healthz', (_req, res) => {
    try {
      const dbMs = db.ping();
      res.json({ ok: true, db_ms: Math.round(dbMs * 100) / 100, ts: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  return router;
};
