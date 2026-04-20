const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../lib/auth');
const { toLocalDateStr, isDateStr } = require('../lib/dates');
const { logger } = require('../lib/logger');

module.exports = function adminRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res, next) => {
    try {
      const employees = db.getEmployees();
      const editDate = isDateStr(req.query.date) ? req.query.date : null;
      const stats = db.getSetupStats();
      res.render('admin', {
        employees,
        editDate,
        todayStr: toLocalDateStr(new Date()),
        setup: stats,
        error: null
      });
    } catch (err) { next(err); }
  });

  router.get('/schedule', (_req, res, next) => {
    try { res.render('admin_schedule', { employees: db.getEmployees(), error: null }); }
    catch (err) { next(err); }
  });

  router.get('/employees', (_req, res, next) => {
    try { res.render('admin_employees', { employees: db.getEmployees(), error: null }); }
    catch (err) { next(err); }
  });

  router.get('/edit-tips', (_req, res, next) => {
    try { res.render('admin_edit_tips', { history: db.getHistory(), error: null }); }
    catch (err) { next(err); }
  });

  router.get('/audit', (_req, res, next) => {
    try {
      const rows = db.getAuditLog({ limit: 200 });
      res.render('admin_audit', { rows });
    } catch (err) { next(err); }
  });

  // Database snapshot — streamed from a safe VACUUM INTO copy.
  router.get('/backup.sqlite', (_req, res, next) => {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const snap = path.join(require('os').tmpdir(), `tip-tracker-backup-${ts}.sqlite`);
      db.backupTo(snap);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="tip-tracker-${ts}.sqlite"`);
      const stream = fs.createReadStream(snap);
      stream.on('close', () => fs.unlink(snap, () => {}));
      stream.on('error', (e) => { logger.error('backup stream', { err: e.message }); });
      stream.pipe(res);
      db.recordAudit('admin', 'backup.download', null, null);
    } catch (err) { next(err); }
  });

  router.post('/reset-database', (req, res) => {
    if (req.body.confirm !== 'RESET') {
      return res.status(400).json({ error: 'Add { "confirm": "RESET" } to confirm this destructive action.' });
    }
    db.recordAudit('admin', 'database.reset', null, null);
    db.reset();
    res.json({ success: true, message: 'Database reset. Fresh sample employees created.' });
  });

  router.post('/create-sample-employees', (_req, res) => {
    const added = db.createSampleEmployees();
    const employees = db.getEmployees();
    res.json({
      success: true,
      message: added > 0
        ? `Added ${added} sample employee${added === 1 ? '' : 's'}. Total: ${employees.length}`
        : `All sample employees are already present. Total: ${employees.length}`,
      employees
    });
  });

  return router;
};
