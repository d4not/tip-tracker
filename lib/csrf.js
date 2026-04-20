const crypto = require('crypto');

// Double-submit cookie CSRF. A random token is set in a cookie; write requests
// must present the same value via `X-CSRF-Token` header or `_csrf` body field.
// SameSite=lax on the cookie keeps it usable for same-origin forms.

const COOKIE_NAME = 'csrf_token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function mint() {
  return crypto.randomBytes(24).toString('base64url');
}

function issueMiddleware(req, res, next) {
  let token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token || !/^[A-Za-z0-9_-]{24,}$/.test(token)) {
    token = mint();
    res.cookie(COOKIE_NAME, token, {
      httpOnly: false, // must be readable by JS so fetch() can echo it
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000
    });
  }
  req.csrfToken = token;
  res.locals.csrfToken = token;
  next();
}

function enforceMiddleware(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookieToken = req.cookies && req.cookies[COOKIE_NAME];
  const presented = req.get('X-CSRF-Token') || (req.body && req.body._csrf);
  if (!cookieToken || !presented || cookieToken !== presented) {
    const wantsJson = req.is('application/json') || (req.get('accept') || '').includes('application/json');
    if (wantsJson) return res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return res.status(403).send('Invalid or missing CSRF token');
  }
  next();
}

module.exports = { COOKIE_NAME, issueMiddleware, enforceMiddleware, mint };
