const express = require('express');
const { requireAuthApi } = require('../lib/auth');
const { isDateStr } = require('../lib/dates');
const {
  MAX_NAME_LEN,
  validName,
  validateTipBody
} = require('../lib/validation');
const undo = require('../lib/undo');

module.exports = function apiRouter(db, writeLimiter) {
  const router = express.Router();

  // ----- Employees -----
  router.get('/employees', (req, res) => {
    const includeInactive = req.query.include_inactive === '1' && req.session && req.session.authenticated;
    const list = includeInactive ? db.getAllEmployees() : db.getEmployees();
    // Public endpoint: always return a minimal shape.
    res.json(list.map((e) => (includeInactive
      ? { id: e.id, name: e.name, active: !!e.active }
      : { id: e.id, name: e.name })));
  });

  router.post('/employees', requireAuthApi, writeLimiter, (req, res) => {
    const name = validName(req.body.name);
    if (!name) return res.status(400).json({ error: `Employee name is required (max ${MAX_NAME_LEN} characters)` });
    try {
      const result = db.addEmployee(name);
      db.recordAudit('admin', result.reactivated ? 'employee.reactivate' : 'employee.create', String(result.id), { name });
      res.json({ success: true, id: result.id, reactivated: !!result.reactivated });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  router.put('/employees/:id', requireAuthApi, writeLimiter, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const name = validName(req.body.name);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid employee ID' });
    if (!name) return res.status(400).json({ error: `Employee name is required (max ${MAX_NAME_LEN} characters)` });
    db.updateEmployee(id, name);
    db.recordAudit('admin', 'employee.rename', String(id), { name });
    res.json({ success: true });
  });

  router.delete('/employees/:id', requireAuthApi, writeLimiter, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid employee ID' });
    const emp = db.getEmployee(id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    db.deleteEmployee(id);
    const undoToken = undo.put({ kind: 'employee', id });
    db.recordAudit('admin', 'employee.delete', String(id), { name: emp.name });
    res.json({ success: true, undoToken });
  });

  router.post('/employees/:id/restore', requireAuthApi, writeLimiter, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid employee ID' });
    db.restoreEmployee(id);
    db.recordAudit('admin', 'employee.restore', String(id), null);
    res.json({ success: true });
  });

  // ----- Schedule -----
  router.get('/schedule', requireAuthApi, (_req, res) => {
    res.json({ schedule: db.getSchedule() });
  });

  router.put('/employees/:id/schedule', requireAuthApi, writeLimiter, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { weekdays } = req.body;
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid employee ID' });
    if (!Array.isArray(weekdays)) return res.status(400).json({ error: 'weekdays must be an array (0=Sunday..6=Saturday)' });
    db.setWorkdays(id, weekdays);
    db.recordAudit('admin', 'schedule.set', String(id), { weekdays });
    res.json({ success: true });
  });

  router.get('/employees-by-day/:day', requireAuthApi, (req, res) => {
    const day = parseInt(req.params.day, 10);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return res.status(400).json({ error: 'day must be 0 (Sunday) to 6 (Saturday)' });
    }
    res.json({ employeeIds: db.getEmployeesWorkingOn(day) });
  });

  // ----- Tips -----
  router.post('/tips', requireAuthApi, writeLimiter, (req, res) => {
    const v = validateTipBody(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    try {
      const result = db.saveTipDay(v.date, v.employees, v.amountCents, v.notes, v.overrides);
      db.recordAudit('admin', result.wasUpdated ? 'tip.update' : 'tip.create', v.date, {
        amountCents: v.amountCents, employees: v.employees, overrides: v.overrides
      });
      res.json({ success: true, updated: result.wasUpdated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/tips/:date', requireAuthApi, (req, res) => {
    const { date } = req.params;
    if (!isDateStr(date)) return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    const tip = db.getTipDay(date);
    if (!tip) return res.status(404).json({ error: 'No tips found for this date' });
    res.json(tip);
  });

  router.put('/tips/:date', requireAuthApi, writeLimiter, (req, res) => {
    const { date } = req.params;
    if (!isDateStr(date)) return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    const v = validateTipBody({ ...req.body, date });
    if (v.error) return res.status(400).json({ error: v.error });
    if (!db.getTipDay(date)) return res.status(404).json({ error: 'No tips found for this date' });
    try {
      db.saveTipDay(v.date, v.employees, v.amountCents, v.notes, v.overrides);
      db.recordAudit('admin', 'tip.update', v.date, {
        amountCents: v.amountCents, employees: v.employees, overrides: v.overrides
      });
      res.json({ success: true, updated: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/tips/:date', requireAuthApi, writeLimiter, (req, res) => {
    const { date } = req.params;
    if (!isDateStr(date)) return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    const snapshot = db.deleteTipDay(date);
    if (!snapshot) return res.status(404).json({ error: 'No tips found for this date' });
    const undoToken = undo.put({ kind: 'tip', snapshot });
    db.recordAudit('admin', 'tip.delete', date, null);
    res.json({ success: true, undoToken });
  });

  router.post('/tips/:date/restore', requireAuthApi, writeLimiter, (req, res) => {
    const { token } = req.body;
    const payload = token ? undo.take(token) : null;
    if (!payload || payload.kind !== 'tip') return res.status(410).json({ error: 'Undo token expired or invalid' });
    const s = payload.snapshot;
    const overrides = {};
    for (const e of s.employees) if (e.is_override) overrides[e.employee_id] = e.individual_cents;
    db.saveTipDay(s.date, s.employees.map((e) => e.employee_id), s.total_cents, s.notes || '', overrides);
    db.recordAudit('admin', 'tip.restore', s.date, null);
    res.json({ success: true });
  });

  return router;
};
