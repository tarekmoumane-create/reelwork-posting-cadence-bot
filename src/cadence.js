// Turns "3x a week" / "every 2 days" / "daily" into an interval in hours,
// and computes where a creator stands against that interval.

const HOUR = 3600 * 1000;
const UNIT_HOURS = { hour: 1, hr: 1, h: 1, day: 24, d: 24, week: 168, wk: 168, w: 168, month: 720, mo: 720 };
const WORD_NUMS = { a: 1, an: 1, one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };

function num(token) {
  if (token == null) return null;
  if (token in WORD_NUMS) return WORD_NUMS[token];
  const n = Number(token);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @returns {{hours:number, label:string} | null}
 */
export function parseCadence(input) {
  if (!input) return null;
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/×/g, 'x');

  if (/^(daily|every ?day|once a day|1 ?x? ?(a|per|\/) ?day|1 ?(post )?(a|per) ?day)$/.test(s)) return { hours: 24, label: 'daily' };
  if (/^(every other day|every 2nd day|alternate days)$/.test(s)) return { hours: 48, label: 'every other day' };
  if (/^(weekly|every ?week|once a week|1 ?x? ?(a|per|\/) ?week)$/.test(s)) return { hours: 168, label: 'weekly' };

  // "every 2 days", "every 36 hours", "every 1.5 weeks", "every day"
  let m = s.match(/^every (\S+)? ?(hour|hr|h|day|d|week|wk|w|month|mo)s?$/);
  if (m) {
    const n = m[1] ? num(m[1]) : 1;
    if (!n) return null;
    const hours = n * UNIT_HOURS[m[2]];
    return { hours, label: describeInterval(hours) };
  }

  // "3x a week", "3 times per week", "twice a day", "3/week", "5 posts a week"
  m = s.match(/^(\d+(?:\.\d+)?|[a-z]+) ?(?:x|times?|posts?)? ?(?:a|per|\/|every) ?(hour|hr|h|day|d|week|wk|w|month|mo)s?$/);
  if (m) {
    const n = num(m[1]);
    if (!n) return null;
    const hours = UNIT_HOURS[m[2]] / n;
    return { hours, label: describeRate(n, m[2]) };
  }

  return null;
}

function describeInterval(hours) {
  if (hours === 24) return 'daily';
  if (hours === 168) return 'weekly';
  if (hours % 168 === 0) return `every ${hours / 168} weeks`;
  if (hours % 24 === 0) return `every ${hours / 24} days`;
  return `every ${trim(hours)} hours`;
}

function describeRate(n, unit) {
  const name = { hour: 'hour', hr: 'hour', h: 'hour', day: 'day', d: 'day', week: 'week', wk: 'week', w: 'week', month: 'month', mo: 'month' }[unit];
  if (n === 1) return name === 'day' ? 'daily' : name === 'week' ? 'weekly' : `once a ${name}`;
  return `${trim(n)}× per ${name}`;
}

function trim(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

export const CADENCE_EXAMPLES = '`daily`, `every 2 days`, `3x a week`, `twice a week`, `weekly`, `every 36 hours`';

/**
 * Status of a tracker right now.
 * state: 'none' | 'on_track' | 'due_soon' | 'overdue'
 */
export function computeStatus(tracker, now = Date.now()) {
  const intervalMs = tracker.cadence.hours * HOUR;
  const posts = tracker.posts;
  const last = posts.length ? posts[posts.length - 1] : null;

  const weekAgo = now - 7 * 24 * HOUR;
  const postsThisWeek = posts.filter((p) => p.at > weekAgo).length;
  const expectedPerWeek = 168 / tracker.cadence.hours;

  if (!last) {
    return { state: 'none', last: null, dueAt: null, ratio: 0, postsThisWeek, expectedPerWeek, overdueMs: 0 };
  }

  const elapsed = now - last.at;
  const ratio = elapsed / intervalMs;
  const dueAt = last.at + intervalMs;
  const state = ratio >= 1 ? 'overdue' : ratio >= 0.75 ? 'due_soon' : 'on_track';

  return { state, last, dueAt, ratio, postsThisWeek, expectedPerWeek, overdueMs: Math.max(0, now - dueAt) };
}

export function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24 ? ` ${hours % 24}h` : ''}`;
}
