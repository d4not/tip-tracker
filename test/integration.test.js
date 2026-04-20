// Integration tests hit the real Express app via supertest. Each test file
// loads its own isolated DB (see helpers.setupTestEnv) so they don't step on
// each other.
const { setupTestEnv, Jar } = require('./helpers');
setupTestEnv();

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, db, server } = require('../app');

test.after(() => {
  server.close();
  db.close();
});

async function authedSession(agent) {
  const jar = new Jar();
  const login = await agent.get('/login');
  jar.absorb(login);
  const csrf = jar.get('csrf_token');
  const res = await agent
    .post('/login')
    .set('Cookie', jar.header())
    .type('form')
    .send({ _csrf: csrf, password: 'test-password', redirectTo: '/admin' });
  jar.absorb(res);
  assert.equal(res.status, 302, 'login should redirect');
  return { jar, csrf: jar.get('csrf_token') };
}

test('pages: home redirects not used; landing renders', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /See how tips are split/);
});

test('pages: /employees without date redirects to current Monday', async () => {
  const res = await request(app).get('/employees');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^\/employees\/\d{4}-\d{2}-\d{2}$/);
});

test('pages: non-Monday date snaps to Monday (preserves ?employee=)', async () => {
  // 2026-04-22 is a Wednesday; Monday = 2026-04-20
  const res = await request(app).get('/employees/2026-04-22?employee=1');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/employees/2026-04-20?employee=1');
});

test('pages: admin without auth redirects to /login', async () => {
  const res = await request(app).get('/admin');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^\/login/);
});

test('pages: /healthz reports DB latency', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(typeof res.body.db_ms, 'number');
});

test('auth: wrong password fails; correct password succeeds', async () => {
  const jar = new Jar();
  jar.absorb(await request(app).get('/login'));
  const csrf = jar.get('csrf_token');

  const bad = await request(app)
    .post('/login')
    .set('Cookie', jar.header())
    .type('form')
    .send({ _csrf: csrf, password: 'nope', redirectTo: '/admin' });
  assert.equal(bad.status, 401);

  const good = await request(app)
    .post('/login')
    .set('Cookie', jar.header())
    .type('form')
    .send({ _csrf: csrf, password: 'test-password', redirectTo: '/admin' });
  assert.equal(good.status, 302);
  assert.equal(good.headers.location, '/admin');
});

test('auth: open-redirect is neutralised (external URL → /admin fallback)', async () => {
  const jar = new Jar();
  jar.absorb(await request(app).get('/login'));
  const csrf = jar.get('csrf_token');
  const res = await request(app)
    .post('/login')
    .set('Cookie', jar.header())
    .type('form')
    .send({ _csrf: csrf, password: 'test-password', redirectTo: 'https://evil.com' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/admin');
});

test('csrf: mutating POST without token returns 403', async () => {
  const { jar } = await authedSession(request(app));
  const res = await request(app)
    .post('/api/tips')
    .set('Cookie', jar.header())
    .set('Accept', 'application/json')
    .send({ date: '2026-04-20', employees: [1], amount: 10 });
  assert.equal(res.status, 403);
});

test('tips: create → fetch → delete with cents-accurate split', async () => {
  const { jar, csrf } = await authedSession(request(app));
  const headers = { Cookie: jar.header(), 'X-CSRF-Token': csrf };

  const create = await request(app)
    .post('/api/tips')
    .set(headers)
    .send({ date: '2026-04-20', employees: [1, 2, 3], amount: 100, notes: 'integ' });
  assert.equal(create.status, 200);
  assert.equal(create.body.updated, false);

  const get = await request(app).get('/api/tips/2026-04-20').set(headers);
  assert.equal(get.status, 200);
  assert.equal(get.body.total_cents, 10000);
  const sum = get.body.employees.reduce((s, e) => s + e.individual_cents, 0);
  assert.equal(sum, 10000, 'per-employee cents must sum exactly to total');

  const del = await request(app).delete('/api/tips/2026-04-20').set(headers);
  assert.equal(del.status, 200);
  assert.ok(del.body.undoToken, 'delete should return undo token');
});

test('tips: override honoured; remainder distributes evenly', async () => {
  const { jar, csrf } = await authedSession(request(app));
  const headers = { Cookie: jar.header(), 'X-CSRF-Token': csrf };

  await request(app)
    .post('/api/tips').set(headers)
    .send({ date: '2026-04-21', employees: [1, 2, 3], amount: 100, overrides: { 1: 50 } });

  const tip = (await request(app).get('/api/tips/2026-04-21').set(headers)).body;
  const byId = Object.fromEntries(tip.employees.map((e) => [e.employee_id, e]));
  assert.equal(byId[1].individual_cents, 5000);
  assert.equal(byId[1].is_override, 1);
  assert.equal(byId[2].individual_cents, 2500);
  assert.equal(byId[3].individual_cents, 2500);

  await request(app).delete('/api/tips/2026-04-21').set(headers);
});

test('employees: inactive employee still appears in edit-tips list when in record', async () => {
  const { jar, csrf } = await authedSession(request(app));
  const headers = { Cookie: jar.header(), 'X-CSRF-Token': csrf };

  const emp = await request(app).post('/api/employees').set(headers).send({ name: 'Temp Worker' });
  const empId = emp.body.id;

  await request(app).post('/api/tips').set(headers)
    .send({ date: '2026-04-22', employees: [empId], amount: 10 });

  await request(app).delete('/api/employees/' + empId).set(headers);

  const list = await request(app)
    .get('/api/employees?include_inactive=1')
    .set({ Cookie: jar.header() });
  assert.equal(list.status, 200);
  const found = list.body.find((e) => e.id === empId);
  assert.ok(found, 'inactive employee must appear in include_inactive list');
  assert.equal(found.active, false);

  await request(app).delete('/api/tips/2026-04-22').set(headers);
});

test('history.csv exports rows with header', async () => {
  const { jar, csrf } = await authedSession(request(app));
  const headers = { Cookie: jar.header(), 'X-CSRF-Token': csrf };
  await request(app).post('/api/tips').set(headers)
    .send({ date: '2026-04-23', employees: [1, 2], amount: 50, notes: 'csv test' });

  const csv = await request(app).get('/history.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.text, /^date,total,total_employees,per_person,notes/);
  assert.match(csv.text, /2026-04-23,50\.00,2,25\.00,csv test/);

  await request(app).delete('/api/tips/2026-04-23').set(headers);
});

test('reset-database requires confirm: RESET', async () => {
  const { jar, csrf } = await authedSession(request(app));
  const headers = { Cookie: jar.header(), 'X-CSRF-Token': csrf };
  const bad = await request(app).post('/admin/reset-database').set(headers).send({});
  assert.equal(bad.status, 400);
});

test('i18n: Spanish locale via cookie flips visible strings', async () => {
  const res = await request(app).get('/employees/2026-04-20').set('Cookie', 'lang=es');
  assert.equal(res.status, 200);
  assert.match(res.text, /Esta semana|Propinas del Equipo|Histórico/);
});
