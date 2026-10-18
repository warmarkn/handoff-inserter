// Shift tag logic. Tag = M/D + D|N, no leading zeros, e.g. "10/16D".
//   06:00-17:59 -> D, today
//   18:00-23:59 -> N, today
//   00:00-05:59 -> N, previous day

export function shiftFor(now) {
  const h = now.getHours();
  if (h >= 6 && h < 18) return { date: dayOf(now, 0), letter: 'D' };
  if (h >= 18) return { date: dayOf(now, 0), letter: 'N' };
  return { date: dayOf(now, -1), letter: 'N' };
}

// Local midnight of `d` shifted by `offset` days; Date handles month/year rollover.
function dayOf(d, offset) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
}

export function formatTag(date, letter) {
  return `${date.getMonth() + 1}/${date.getDate()}${letter}`;
}

export function makeTag(now = new Date()) {
  const s = shiftFor(now);
  return formatTag(s.date, s.letter);
}

// "2026-10-17" <-> local Date, for <input type="date">.
export function toISODate(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function fromISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "Handoff 10-17N 2214.docx": shift date + letter, then wall-clock time.
export function exportName(now = new Date()) {
  const s = shiftFor(now);
  const p = (n) => String(n).padStart(2, '0');
  return `Handoff ${s.date.getMonth() + 1}-${s.date.getDate()}${s.letter} ${p(now.getHours())}${p(now.getMinutes())}.docx`;
}
