const { isDateStr } = require('./dates');

const MAX_NAME_LEN = 80;
const MAX_NOTES_LEN = 500;
const MAX_TIP_AMOUNT_CENTS = 100_000_00; // $100,000

function validName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > MAX_NAME_LEN) return null;
  // Allow letters (any script), digits, spaces, hyphens, apostrophes, periods.
  if (!/^[\p{L}\p{M}\p{N} '.\-]+$/u.test(trimmed)) return null;
  return trimmed;
}

function validNotes(notes) {
  const s = (notes || '').toString();
  if (s.length > MAX_NOTES_LEN) return { error: `Notes too long (max ${MAX_NOTES_LEN} characters)` };
  return { value: s };
}

// Safe local redirect: path-only, no protocol, no // prefix.
function safeRedirectPath(path, fallback = '/') {
  if (typeof path !== 'string') return fallback;
  if (!path.startsWith('/')) return fallback;
  if (path.startsWith('//')) return fallback;
  if (path.startsWith('/\\')) return fallback;
  if (path.length > 512) return fallback;
  return path;
}

function validateTipBody(body, { requireDate = true } = {}) {
  const { date, employees, amount, notes, overrides } = body || {};
  if (requireDate && !isDateStr(date)) {
    return { error: 'Date is required (YYYY-MM-DD)' };
  }
  if (!Array.isArray(employees) || employees.length === 0) {
    return { error: 'At least one employee is required' };
  }
  const ids = [...new Set(employees.map((id) => parseInt(id, 10)).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return { error: 'At least one valid employee is required' };

  const amountNum = parseFloat(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return { error: 'Amount must be a positive number' };
  }
  const amountCents = Math.round(amountNum * 100);
  if (amountCents > MAX_TIP_AMOUNT_CENTS) {
    return { error: `Amount is unusually large (max ${MAX_TIP_AMOUNT_CENTS / 100})` };
  }

  const n = validNotes(notes);
  if (n.error) return { error: n.error };

  // Optional overrides: { employeeId: cents }
  const cleanOverrides = {};
  if (overrides && typeof overrides === 'object') {
    for (const [k, v] of Object.entries(overrides)) {
      const id = parseInt(k, 10);
      const cents = Math.round(parseFloat(v) * 100);
      if (!Number.isInteger(id) || id <= 0) continue;
      if (!ids.includes(id)) continue;
      if (!Number.isFinite(cents) || cents < 0) continue;
      cleanOverrides[id] = cents;
    }
  }

  return { date, employees: ids, amountCents, notes: n.value, overrides: cleanOverrides };
}

module.exports = {
  MAX_NAME_LEN,
  MAX_NOTES_LEN,
  MAX_TIP_AMOUNT_CENTS,
  validName,
  validNotes,
  safeRedirectPath,
  validateTipBody
};
