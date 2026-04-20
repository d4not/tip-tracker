const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { logger } = require('./logger');

// Admin auth model: one shared admin password. Store a bcrypt hash in
// ADMIN_PASSWORD_HASH (preferred). Fall back to ADMIN_PASSWORD for local dev
// — we'll hash it in memory at startup. In production we require the hash.

function resolveAdminHash() {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (hash && hash.startsWith('$2')) return hash;

  const raw = process.env.ADMIN_PASSWORD;
  if (raw) {
    const synth = bcrypt.hashSync(raw, 10);
    if (process.env.NODE_ENV === 'production') {
      logger.warn('ADMIN_PASSWORD used directly in production. Use ADMIN_PASSWORD_HASH instead.');
    }
    return synth;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_PASSWORD_HASH is required in production');
  }
  // Dev default so the app runs out of the box.
  logger.warn('No ADMIN_PASSWORD[_HASH] set — defaulting to "coffee123" for local dev');
  return bcrypt.hashSync('coffee123', 10);
}

const ADMIN_HASH = resolveAdminHash();

function verifyPassword(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  try {
    return bcrypt.compareSync(candidate, ADMIN_HASH);
  } catch {
    return false;
  }
}

// Constant-time string compare used for the CSRF token path too.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  const to = encodeURIComponent(req.originalUrl || '/admin');
  res.redirect('/login?redirect=' + to);
}

function requireAuthApi(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized. Please sign in.' });
}

module.exports = { verifyPassword, safeEqual, requireAuth, requireAuthApi };
