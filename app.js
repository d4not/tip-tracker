const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const TipDatabase = require('./database');
const { logger, requestIdMiddleware, accessLogMiddleware } = require('./lib/logger');
const { middleware: i18nMiddleware } = require('./lib/i18n');
const { issueMiddleware: csrfIssue, enforceMiddleware: csrfEnforce } = require('./lib/csrf');
const { formatDate } = require('./lib/dates');
const { centsToDollars, middleware: currencyMiddleware } = require('./lib/money');

const pagesRouter = require('./routes/pages');
const apiRouter = require('./routes/api');
const adminRouter = require('./routes/admin');

const PORT = parseInt(process.env.PORT || '3000', 10);
const IS_PROD = process.env.NODE_ENV === 'production';

// --- Session secret: required in prod, random default in dev. ---
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (IS_PROD) {
    logger.error('SESSION_SECRET is required in production');
    process.exit(1);
  }
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  logger.warn('SESSION_SECRET not set — generated a random one for this run (dev only)');
}

// --- DB ---
const db = new TipDatabase();
db.init();

// --- App ---
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', parseInt(process.env.TRUST_PROXY, 10) || 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers. CSP is tight: no inline scripts (we moved everything to /js/),
// no external origins. `'self'` only.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // small per-page style overrides
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: IS_PROD ? undefined : false
}));

app.use(requestIdMiddleware);
app.use(accessLogMiddleware);
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '7d' : 0 }));

app.use(session({
  name: 'tt.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(i18nMiddleware);
app.use(currencyMiddleware);
app.use(csrfIssue);

// Locals exposed to every view.
app.use((req, res, next) => {
  res.locals.formatDate = formatDate;
  res.locals.centsToDollars = centsToDollars;
  res.locals.isAdmin = !!(req.session && req.session.authenticated);
  res.locals.currentPath = req.path;
  res.locals.appName = 'Tip Tracker';
  next();
});

// --- Rate limits ---
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Slow down.' }
});

// --- Routes ---
// CSRF enforcement wraps mutating endpoints only. Applied BEFORE route modules.
app.use(csrfEnforce);

app.use('/', pagesRouter(db, loginLimiter));
app.use('/api', apiRouter(db, writeLimiter));
app.use('/admin', adminRouter(db));

// --- 404 + error handlers ---
app.use((_req, res) => res.status(404).render('error', { status: 404 }));
app.use((err, req, res, _next) => {
  logger.error('unhandled', { req: req.id, err: err.message, stack: err.stack });
  const wantsJson = req.is('application/json') || (req.get('accept') || '').includes('application/json');
  if (wantsJson) return res.status(500).json({ error: 'Internal server error' });
  res.status(500).render('error', { status: 500 });
});

// --- Process-level safety ---
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { reason: reason instanceof Error ? reason.stack : String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { err: err.message, stack: err.stack });
});

// --- Boot + graceful shutdown ---
const server = app.listen(PORT, () => {
  logger.info('listening', { port: PORT, env: IS_PROD ? 'production' : 'development' });
  if (!IS_PROD) {
    process.stdout.write(`\n  Tip Tracker · http://localhost:${PORT}\n  Default dev admin password: coffee123\n\n`);
  }
});

function shutdown(signal) {
  logger.info('shutdown.start', { signal });
  server.close(() => {
    db.close();
    logger.info('shutdown.complete');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('shutdown.force');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, db, server };
