// All date math lives here. Week boundary = Monday (local tz). YYYY-MM-DD strings
// are local dates, not UTC. Using hour=12 avoids DST edge cases.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function isDateStr(s) {
  return typeof s === 'string' && DATE_RE.test(s);
}

function toLocalDateStr(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocal(dateStr) {
  if (!isDateStr(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const out = new Date(y, m - 1, d, 12, 0, 0);
  return isNaN(out.getTime()) ? null : out;
}

function snapToMonday(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function weekStartFromStr(dateStr) {
  const d = parseLocal(dateStr);
  return d ? snapToMonday(d) : null;
}

function currentWeekStart() {
  return snapToMonday(new Date());
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function weekRange(startDate) {
  const start = snapToMonday(startDate);
  const end = addDays(start, 6);
  return { start: toLocalDateStr(start), end: toLocalDateStr(end) };
}

function formatDate(dateStr, option) {
  const d = parseLocal(dateStr);
  if (!d) return dateStr || '';
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  switch (option) {
    case 'weekday': return WEEKDAYS_LONG[d.getDay()];
    case 'weekdayShort': return WEEKDAYS_SHORT[d.getDay()];
    case 'long': return `${MONTHS[month]} ${day}, ${year}`;
    case 'short': return `${month + 1}/${day}/${year}`;
    case 'iso': return toLocalDateStr(d);
    default: return dateStr;
  }
}

module.exports = {
  DATE_RE,
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
  MONTHS,
  isDateStr,
  toLocalDateStr,
  parseLocal,
  snapToMonday,
  weekStartFromStr,
  currentWeekStart,
  addDays,
  weekRange,
  formatDate
};
