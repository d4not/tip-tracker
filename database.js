const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const { weekRange } = require('./lib/dates');
const { splitCentsEvenly } = require('./lib/money');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'tips.db');

class TipDatabase {
  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tip_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        total_cents INTEGER NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tip_day_employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tip_day_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        individual_cents INTEGER NOT NULL,
        is_override INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (tip_day_id) REFERENCES tip_days(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id)
      );

      CREATE TABLE IF NOT EXISTS employee_workdays (
        employee_id INTEGER NOT NULL,
        weekday INTEGER NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
        PRIMARY KEY (employee_id, weekday),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL DEFAULT (datetime('now')),
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        payload TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tip_days_date ON tip_days(date);
      CREATE INDEX IF NOT EXISTS idx_tde_day ON tip_day_employees(tip_day_id);
      CREATE INDEX IF NOT EXISTS idx_tde_employee ON tip_day_employees(employee_id);
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
    `);

    this._runMigrations();

    const { count } = this.db.prepare('SELECT COUNT(*) as count FROM employees').get();
    if (count === 0) this.createSampleEmployees();
  }

  // Forward-only migrations. Idempotent.
  _runMigrations() {
    const cols = (t) => this.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

    const tdCols = cols('tip_days');
    if (!tdCols.includes('total_cents') && tdCols.includes('total_amount')) {
      this.db.exec(`ALTER TABLE tip_days ADD COLUMN total_cents INTEGER NOT NULL DEFAULT 0`);
      this.db.exec(`UPDATE tip_days SET total_cents = ROUND(total_amount * 100)`);
    }
    const tdeCols = cols('tip_day_employees');
    if (!tdeCols.includes('individual_cents') && tdeCols.includes('individual_amount')) {
      this.db.exec(`ALTER TABLE tip_day_employees ADD COLUMN individual_cents INTEGER NOT NULL DEFAULT 0`);
      this.db.exec(`UPDATE tip_day_employees SET individual_cents = ROUND(individual_amount * 100)`);
    }
    if (!cols('tip_day_employees').includes('is_override')) {
      this.db.exec(`ALTER TABLE tip_day_employees ADD COLUMN is_override INTEGER NOT NULL DEFAULT 0`);
    }
    if (!cols('tip_days').includes('updated_at')) {
      this.db.exec(`ALTER TABLE tip_days ADD COLUMN updated_at TEXT`);
    }
  }

  createSampleEmployees() {
    const samples = [
      'Ava Johnson', 'Liam Smith', 'Olivia Brown', 'Noah Davis',
      'Emma Wilson', 'Ethan Martinez', 'Sophia Anderson', 'Mason Garcia'
    ];
    const has = this.db.prepare('SELECT 1 FROM employees WHERE LOWER(name) = LOWER(?)');
    const insert = this.db.prepare('INSERT INTO employees (name) VALUES (?)');
    let added = 0;
    for (const name of samples) {
      if (!has.get(name)) { insert.run(name); added++; }
    }
    return added;
  }

  reset() {
    this.db.exec(`
      DROP TABLE IF EXISTS employee_workdays;
      DROP TABLE IF EXISTS tip_day_employees;
      DROP TABLE IF EXISTS tip_days;
      DROP TABLE IF EXISTS employees;
      DROP TABLE IF EXISTS audit_log;
    `);
    this.init();
  }

  close() {
    try { this.db.close(); } catch { /* already closed */ }
  }

  ping() {
    const start = process.hrtime.bigint();
    this.db.prepare('SELECT 1').get();
    return Number(process.hrtime.bigint() - start) / 1e6;
  }

  backupTo(filePath) {
    this.db.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
  }

  // --- Audit ---
  recordAudit(actor, action, target, payload) {
    this.db.prepare('INSERT INTO audit_log (actor, action, target, payload) VALUES (?, ?, ?, ?)')
      .run(actor || 'system', action, target || null, payload == null ? null : JSON.stringify(payload));
  }

  getAuditLog({ limit = 200, offset = 0, action } = {}) {
    if (action) {
      return this.db.prepare(
        `SELECT * FROM audit_log WHERE action = ? ORDER BY ts DESC LIMIT ? OFFSET ?`
      ).all(action, limit, offset);
    }
    return this.db.prepare(
      `SELECT * FROM audit_log ORDER BY ts DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);
  }

  // --- Employees ---
  getEmployees() {
    return this.db.prepare('SELECT id, name, active FROM employees WHERE active = 1 ORDER BY name').all();
  }

  getAllEmployees() {
    return this.db.prepare('SELECT id, name, active FROM employees ORDER BY name').all();
  }

  getEmployee(id) {
    return this.db.prepare('SELECT id, name, active FROM employees WHERE id = ?').get(id);
  }

  addEmployee(name) {
    const existing = this.db.prepare(
      'SELECT id, active FROM employees WHERE LOWER(name) = LOWER(?) ORDER BY active DESC, id DESC'
    ).get(name);
    if (existing) {
      if (!existing.active) {
        this.db.prepare('UPDATE employees SET active = 1, name = ? WHERE id = ?').run(name, existing.id);
        return { id: existing.id, reactivated: true };
      }
      throw new Error('An employee with that name already exists');
    }
    const info = this.db.prepare('INSERT INTO employees (name) VALUES (?)').run(name);
    return { id: info.lastInsertRowid, reactivated: false };
  }

  updateEmployee(id, name) {
    return this.db.prepare('UPDATE employees SET name = ? WHERE id = ?').run(name, id);
  }

  deleteEmployee(id) {
    const tx = this.db.transaction((empId) => {
      this.db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(empId);
      this.db.prepare('DELETE FROM employee_workdays WHERE employee_id = ?').run(empId);
    });
    tx(id);
  }

  restoreEmployee(id) {
    return this.db.prepare('UPDATE employees SET active = 1 WHERE id = ?').run(id);
  }

  // --- Schedule ---
  getWorkdays(employeeId) {
    return this.db
      .prepare('SELECT weekday FROM employee_workdays WHERE employee_id = ? ORDER BY weekday')
      .all(employeeId)
      .map((r) => r.weekday);
  }

  setWorkdays(employeeId, weekdays) {
    const del = this.db.prepare('DELETE FROM employee_workdays WHERE employee_id = ?');
    const ins = this.db.prepare('INSERT INTO employee_workdays (employee_id, weekday) VALUES (?, ?)');
    this.db.transaction(() => {
      del.run(employeeId);
      const clean = (Array.isArray(weekdays) ? weekdays : [])
        .map((d) => parseInt(d, 10))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      clean.forEach((d) => ins.run(employeeId, d));
    })();
  }

  getEmployeesWorkingOn(weekday) {
    const d = parseInt(weekday, 10);
    if (!Number.isInteger(d) || d < 0 || d > 6) return [];
    return this.db
      .prepare('SELECT employee_id FROM employee_workdays WHERE weekday = ?')
      .all(d)
      .map((r) => r.employee_id);
  }

  getSchedule() {
    return this.getEmployees().map((e) => ({
      id: e.id,
      name: e.name,
      weekdays: this.getWorkdays(e.id)
    }));
  }

  // --- Tips ---
  saveTipDay(date, employeeIds, totalCents, notes, overrides = {}) {
    const ids = [...new Set((Array.isArray(employeeIds) ? employeeIds : [])
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) throw new Error('At least one valid employee is required');

    const tx = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT id FROM tip_days WHERE date = ?').get(date);
      let tipDayId;
      let wasUpdated = false;

      if (existing) {
        this.db.prepare(
          `UPDATE tip_days SET total_cents = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(totalCents, notes, existing.id);
        this.db.prepare('DELETE FROM tip_day_employees WHERE tip_day_id = ?').run(existing.id);
        tipDayId = existing.id;
        wasUpdated = true;
      } else {
        tipDayId = this.db.prepare(
          `INSERT INTO tip_days (date, total_cents, notes) VALUES (?, ?, ?)`
        ).run(date, totalCents, notes).lastInsertRowid;
      }

      const overrideTotal = Object.values(overrides).reduce((s, v) => s + (Number(v) || 0), 0);
      const remainderIds = ids.filter((id) => !(id in overrides));
      const remainderCents = totalCents - overrideTotal;

      let split = {};
      if (remainderIds.length > 0 && remainderCents > 0) {
        split = splitCentsEvenly(remainderCents, remainderIds);
      }

      const ins = this.db.prepare(
        `INSERT INTO tip_day_employees (tip_day_id, employee_id, individual_cents, is_override)
         VALUES (?, ?, ?, ?)`
      );

      for (const id of ids) {
        if (id in overrides) {
          ins.run(tipDayId, id, overrides[id], 1);
        } else {
          ins.run(tipDayId, id, split[id] || 0, 0);
        }
      }
      return { tipDayId, wasUpdated };
    });
    return tx();
  }

  deleteTipDay(date) {
    const tx = this.db.transaction((d) => {
      const row = this.db.prepare('SELECT id FROM tip_days WHERE date = ?').get(d);
      if (!row) return null;
      // Capture the payload first so undo can restore it.
      const snapshot = this.getTipDay(d);
      this.db.prepare('DELETE FROM tip_day_employees WHERE tip_day_id = ?').run(row.id);
      this.db.prepare('DELETE FROM tip_days WHERE id = ?').run(row.id);
      return snapshot;
    });
    return tx(date);
  }

  getTipDay(date) {
    const day = this.db.prepare(
      'SELECT id, date, total_cents, notes FROM tip_days WHERE date = ?'
    ).get(date);
    if (!day) return null;

    const employees = this.db.prepare(`
      SELECT tde.employee_id, e.name AS employee_name, tde.individual_cents, tde.is_override, e.active
      FROM tip_day_employees tde
      JOIN employees e ON tde.employee_id = e.id
      WHERE tde.tip_day_id = ?
      ORDER BY e.name
    `).all(day.id);

    return { ...day, employees, total_employees: employees.length };
  }

  getTipsForWeek(startDate) {
    const { start, end } = weekRange(startDate);
    return this.db.prepare(`
      SELECT
        td.date,
        td.total_cents,
        td.notes,
        GROUP_CONCAT(e.name) AS employee_names,
        GROUP_CONCAT(e.id) AS employee_ids,
        COUNT(tde.employee_id) AS total_employees,
        CASE WHEN COUNT(tde.employee_id) > 0
          THEN CAST(td.total_cents AS REAL) / COUNT(tde.employee_id)
          ELSE 0
        END AS cents_per_employee
      FROM tip_days td
      LEFT JOIN tip_day_employees tde ON td.id = tde.tip_day_id
      LEFT JOIN employees e ON tde.employee_id = e.id
      WHERE td.date BETWEEN ? AND ?
      GROUP BY td.id, td.date
      ORDER BY td.date
    `).all(start, end);
  }

  getTipsForEmployeeWeek(employeeId, startDate) {
    const { start, end } = weekRange(startDate);
    return this.db.prepare(`
      SELECT
        td.date,
        td.total_cents,
        td.notes,
        (SELECT individual_cents FROM tip_day_employees WHERE tip_day_id = td.id AND employee_id = ?) AS individual_cents,
        (SELECT COUNT(*) FROM tip_day_employees WHERE tip_day_id = td.id) AS total_employees
      FROM tip_days td
      WHERE td.date BETWEEN ? AND ?
      ORDER BY td.date
    `).all(employeeId, start, end);
  }

  getEmployeeTotalsForWeek(startDate) {
    const { start, end } = weekRange(startDate);
    return this.db.prepare(`
      SELECT
        e.id,
        e.name,
        e.active,
        COALESCE(SUM(CASE WHEN td.date BETWEEN ? AND ? THEN tde.individual_cents ELSE 0 END), 0) AS week_total_cents
      FROM employees e
      LEFT JOIN tip_day_employees tde ON tde.employee_id = e.id
      LEFT JOIN tip_days td ON tde.tip_day_id = td.id
      WHERE e.active = 1
         OR EXISTS (
           SELECT 1 FROM tip_day_employees tde2
           JOIN tip_days td2 ON tde2.tip_day_id = td2.id
           WHERE tde2.employee_id = e.id AND td2.date BETWEEN ? AND ?
         )
      GROUP BY e.id, e.name, e.active
      ORDER BY week_total_cents DESC, e.name
    `).all(start, end, start, end);
  }

  getHistory({ from, to } = {}) {
    const clauses = [];
    const params = [];
    if (from) { clauses.push('td.date >= ?'); params.push(from); }
    if (to) { clauses.push('td.date <= ?'); params.push(to); }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

    return this.db.prepare(`
      SELECT
        td.id,
        td.date,
        td.total_cents,
        td.notes,
        COUNT(tde.employee_id) AS total_employees,
        CASE WHEN COUNT(tde.employee_id) > 0 THEN CAST(td.total_cents AS REAL) / COUNT(tde.employee_id) ELSE 0 END AS cents_per_employee
      FROM tip_days td
      LEFT JOIN tip_day_employees tde ON td.id = tde.tip_day_id
      ${where}
      GROUP BY td.id, td.date
      ORDER BY td.date DESC
    `).all(...params);
  }

  getSetupStats() {
    const employees = this.db.prepare('SELECT COUNT(*) as c FROM employees WHERE active = 1').get().c;
    const withSchedule = this.db.prepare('SELECT COUNT(DISTINCT employee_id) as c FROM employee_workdays').get().c;
    const tipDays = this.db.prepare('SELECT COUNT(*) as c FROM tip_days').get().c;
    return { employees, withSchedule, tipDays };
  }
}

module.exports = TipDatabase;
