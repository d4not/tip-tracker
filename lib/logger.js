const crypto = require('crypto');

function mkRequestId() {
  return crypto.randomBytes(6).toString('hex');
}

function structured(level, msg, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields
  };
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(payload) + '\n');
}

const logger = {
  info: (msg, fields) => structured('info', msg, fields),
  warn: (msg, fields) => structured('warn', msg, fields),
  error: (msg, fields) => structured('error', msg, fields),
  debug: (msg, fields) => {
    if (process.env.DEBUG) structured('debug', msg, fields);
  }
};

function requestIdMiddleware(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[a-zA-Z0-9\-]{4,64}$/.test(incoming) ? incoming : mkRequestId();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

function accessLogMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('http', {
      req: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(durMs * 100) / 100,
      ip: req.ip
    });
  });
  next();
}

module.exports = { logger, requestIdMiddleware, accessLogMiddleware, mkRequestId };
