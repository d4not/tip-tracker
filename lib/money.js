// Money helpers. Internally stored as integer cents. Display is delegated to
// Intl.NumberFormat on the client. The `CURRENCY` / `LOCALE` env vars are the
// defaults; per-request overrides live in cookies (see middleware below).

const DEFAULT_CURRENCY = process.env.CURRENCY || 'USD';
const DEFAULT_LOCALE = process.env.LOCALE || 'en-US';

// ISO 4217 whitelist. Anything else falls back to the default currency.
const SUPPORTED_CURRENCIES = [
  'USD', 'MXN', 'EUR', 'GBP', 'CAD', 'ARS', 'BRL', 'CLP', 'COP', 'PEN',
  'UYU', 'JPY', 'AUD', 'CHF', 'CNY', 'INR', 'VES', 'DOP', 'GTQ', 'HNL',
  'CRC', 'PYG', 'BOB'
];

// Back-compat exports for older imports.
const CURRENCY = DEFAULT_CURRENCY;
const LOCALE = DEFAULT_LOCALE;

function pickCurrency(req) {
  const fromCookie = req.cookies && req.cookies.currency;
  if (fromCookie && SUPPORTED_CURRENCIES.includes(fromCookie)) return fromCookie;
  return DEFAULT_CURRENCY;
}

// Express middleware: resolve the active currency per request from cookie → env.
function middleware(req, res, next) {
  res.locals.currency = pickCurrency(req);
  res.locals.locale = DEFAULT_LOCALE;
  res.locals.supportedCurrencies = SUPPORTED_CURRENCIES;
  next();
}

function dollarsToCents(value) {
  if (typeof value === 'number') return Math.round(value * 100);
  const n = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function centsToDollars(cents) {
  return (Number(cents) || 0) / 100;
}

function formatCents(cents) {
  const fmt = new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CURRENCY
  });
  return fmt.format(centsToDollars(cents));
}

// Deterministic equal-ish split: distributes remainder cents round-robin by
// sorted id. Given 100 cents and 3 ids [2,5,7], returns:
//   { 2: 34, 5: 33, 7: 33 }
// (first id in sorted order picks up the extra cent).
function splitCentsEvenly(totalCents, ids) {
  const clean = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  clean.sort((a, b) => a - b);
  if (clean.length === 0) return {};
  const base = Math.floor(totalCents / clean.length);
  let remainder = totalCents - base * clean.length;
  const out = {};
  for (const id of clean) {
    out[id] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }
  return out;
}

module.exports = {
  CURRENCY,
  LOCALE,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  SUPPORTED_CURRENCIES,
  pickCurrency,
  middleware,
  dollarsToCents,
  centsToDollars,
  formatCents,
  splitCentsEvenly
};
