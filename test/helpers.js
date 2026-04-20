const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate each test run in a temp DB so they don't clobber dev state.
function setupTestEnv() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tip-tracker-test-'));
  process.env.DB_PATH = path.join(tmp, 'tips.db');
  process.env.ADMIN_PASSWORD = 'test-password';
  process.env.SESSION_SECRET = 'test-secret-' + Math.random();
  process.env.NODE_ENV = 'development';
  process.env.PORT = '0';
  return tmp;
}

// Cookie jar helpers: parse Set-Cookie headers, format Cookie header.
class Jar {
  constructor() { this.cookies = {}; }
  absorb(res) {
    const raw = res.headers['set-cookie'];
    if (!raw) return this;
    for (const s of raw) {
      const [pair] = s.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      this.cookies[name] = value;
    }
    return this;
  }
  header() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  get(name) { return this.cookies[name]; }
}

module.exports = { setupTestEnv, Jar };
