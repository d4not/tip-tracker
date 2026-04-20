// Money helpers. Internally stored as integer cents. Display is delegated to
// Intl.NumberFormat on the client (see public/js/format.js). Server-side
// formatting uses the CURRENCY / LOCALE env vars.

const CURRENCY = process.env.CURRENCY || 'USD';
const LOCALE = process.env.LOCALE || 'en-US';

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
  dollarsToCents,
  centsToDollars,
  formatCents,
  splitCentsEvenly
};
