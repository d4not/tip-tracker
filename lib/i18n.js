const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const SUPPORTED = ['en', 'es'];
const DEFAULT = 'en';

const bundles = {};
for (const lang of SUPPORTED) {
  try {
    bundles[lang] = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), 'utf8'));
  } catch {
    bundles[lang] = {};
  }
}

function pickLocale(req) {
  const fromCookie = req.cookies && req.cookies.lang;
  if (SUPPORTED.includes(fromCookie)) return fromCookie;

  const accept = (req.get && req.get('accept-language')) || '';
  for (const part of accept.split(',')) {
    const tag = part.split(';')[0].trim().slice(0, 2).toLowerCase();
    if (SUPPORTED.includes(tag)) return tag;
  }
  return DEFAULT;
}

function formatTemplate(tpl, vars) {
  if (!vars) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
}

function middleware(req, res, next) {
  const lang = pickLocale(req);
  const bundle = bundles[lang] || bundles[DEFAULT] || {};
  const fallback = bundles[DEFAULT] || {};
  res.locals.lang = lang;
  res.locals.supportedLocales = SUPPORTED;
  res.locals.t = (key, vars) => {
    const tpl = (bundle[key] != null ? bundle[key] : fallback[key]) || key;
    return formatTemplate(tpl, vars);
  };
  next();
}

module.exports = { SUPPORTED, DEFAULT, middleware, pickLocale };
