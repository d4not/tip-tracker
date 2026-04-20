const test = require('node:test');
const assert = require('node:assert/strict');

const { snapToMonday, weekRange, toLocalDateStr, isDateStr, formatDate } = require('../lib/dates');
const { splitCentsEvenly, dollarsToCents, centsToDollars } = require('../lib/money');
const { validName, safeRedirectPath, validateTipBody } = require('../lib/validation');

test('dates: isDateStr', () => {
  assert.equal(isDateStr('2026-04-20'), true);
  assert.equal(isDateStr('2026-4-20'), false);
  assert.equal(isDateStr('not-a-date'), false);
  assert.equal(isDateStr(null), false);
});

test('dates: snapToMonday treats Wednesday as Monday of the same week', () => {
  const wed = new Date(2026, 3, 22, 12, 0, 0);
  const mon = snapToMonday(wed);
  assert.equal(toLocalDateStr(mon), '2026-04-20');
});

test('dates: weekRange covers Monday..Sunday', () => {
  const { start, end } = weekRange(new Date(2026, 3, 20, 12, 0, 0));
  assert.equal(start, '2026-04-20');
  assert.equal(end, '2026-04-26');
});

test('dates: formatDate weekday/long/short', () => {
  assert.equal(formatDate('2026-04-20', 'weekday'), 'Monday');
  assert.equal(formatDate('2026-04-20', 'long'), 'April 20, 2026');
  assert.equal(formatDate('2026-04-20', 'short'), '4/20/2026');
});

test('money: dollarsToCents rounds correctly', () => {
  assert.equal(dollarsToCents(100), 10000);
  assert.equal(dollarsToCents('33.33'), 3333);
  assert.equal(dollarsToCents('0.10'), 10);
  assert.equal(dollarsToCents('0.01'), 1);
  assert.equal(dollarsToCents('1.995'), 200); // rounds to nearest cent
});

test('money: centsToDollars', () => {
  assert.equal(centsToDollars(10000), 100);
  assert.equal(centsToDollars(3334), 33.34);
});

test('money: splitCentsEvenly — $100 across 3 IDs sums exactly', () => {
  const out = splitCentsEvenly(10000, [2, 5, 7]);
  assert.equal(out[2] + out[5] + out[7], 10000);
  // Sorted-id order receives the extra penny.
  assert.equal(out[2], 3334);
  assert.equal(out[5], 3333);
  assert.equal(out[7], 3333);
});

test('money: splitCentsEvenly — single id gets all', () => {
  const out = splitCentsEvenly(10000, [9]);
  assert.deepEqual(out, { 9: 10000 });
});

test('money: splitCentsEvenly — $0.01 across 3 gives first id the cent', () => {
  const out = splitCentsEvenly(1, [1, 2, 3]);
  assert.equal(out[1] + out[2] + out[3], 1);
  assert.equal(out[1], 1);
});

test('validation: validName', () => {
  assert.equal(validName('  Ava  Johnson '), 'Ava Johnson');
  assert.equal(validName("Olivia O'Brien"), "Olivia O'Brien");
  assert.equal(validName('José García'), 'José García');
  assert.equal(validName(''), null);
  assert.equal(validName('<script>'), null);
  assert.equal(validName('x'.repeat(81)), null);
});

test('validation: safeRedirectPath rejects external and protocol-relative', () => {
  assert.equal(safeRedirectPath('/admin'), '/admin');
  assert.equal(safeRedirectPath('/employees/2026-04-20'), '/employees/2026-04-20');
  assert.equal(safeRedirectPath('//evil.com'), '/');
  assert.equal(safeRedirectPath('https://evil.com'), '/');
  assert.equal(safeRedirectPath('/\\evil.com'), '/');
  assert.equal(safeRedirectPath(undefined), '/');
});

test('validation: validateTipBody happy path', () => {
  const v = validateTipBody({
    date: '2026-04-20',
    employees: ['1', 2, '3'],
    amount: 100,
    notes: 'hello'
  });
  assert.equal(v.error, undefined);
  assert.equal(v.amountCents, 10000);
  assert.deepEqual(v.employees, [1, 2, 3]);
});

test('validation: validateTipBody rejects bad values', () => {
  assert.ok(validateTipBody({ date: 'not-a-date', employees: [1], amount: 10 }).error);
  assert.ok(validateTipBody({ date: '2026-04-20', employees: [], amount: 10 }).error);
  assert.ok(validateTipBody({ date: '2026-04-20', employees: [1], amount: -5 }).error);
  assert.ok(validateTipBody({ date: '2026-04-20', employees: [1], amount: 999999999 }).error);
  assert.ok(validateTipBody({ date: '2026-04-20', employees: [1], amount: 10, notes: 'x'.repeat(501) }).error);
});
