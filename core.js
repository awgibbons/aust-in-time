// Timer logic with no browser dependencies: shared by the page, the service worker and the tests.
// All times are epoch milliseconds; durations are milliseconds; days are local YYYY-MM-DD strings.

export const PROJECT_COUNT = 8;

/** Button colors offered in Settings. '' in data.colors means DEFAULT_COLOR. */
export const PALETTE = [
  '#4FC3F7', '#4DB6AC', '#81C784', '#DCE775',
  '#FFD54F', '#FFB74D', '#FF8A65', '#E57373',
  '#F06292', '#BA68C8', '#9575CD', '#90A4AE',
];
export const DEFAULT_COLOR = '#87CFF9';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const zeros = () => Array(PROJECT_COUNT).fill(0);
const blanks = () => Array(PROJECT_COUNT).fill('');
const pad = (n) => String(n).padStart(2, '0');

/** The local calendar day a timestamp falls on. */
export function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight at the start of a day, [offset] days later. */
export function startOfDay(day, offset = 0) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d + offset).getTime();
}

/**
 * Everything the app keeps. At most one project runs at a time; its live segment
 * (since `since`) is not yet folded into `totals`. `history` maps a finished day to
 * its totals and the project names as they were that day.
 */
export function freshData(now) {
  return {
    v: 1,
    day: dayOf(now),
    totals: zeros(),
    running: null,
    since: 0,
    names: blanks(),
    colors: blanks(),
    history: {},
    notify: false,
  };
}

export function displayName(data, project) {
  return data.names[project].trim() || `Project ${project + 1}`;
}

export function elapsed(data, project, now) {
  return data.totals[project] + (data.running === project ? Math.max(0, now - data.since) : 0);
}

export function total(data, now) {
  return data.totals.reduce((sum, _, i) => sum + elapsed(data, i, now), 0);
}

/**
 * The data as seen at [now]. On a new day the finished day is archived (a running timer
 * counts up to midnight), every total starts from zero and a running timer restarts at midnight.
 * Returns the same object when the day has not changed.
 */
export function rollover(data, now) {
  const today = dayOf(now);
  if (today === data.day) return data;
  const end = Math.min(now, startOfDay(data.day, 1));
  const finished = data.totals.map((_, i) => elapsed(data, i, end));
  let history = data.history;
  if (finished.some((t) => t > 0)) {
    // A day can be finished twice when the clock or time zone moves backwards: add to it.
    const earlier = history[data.day];
    history = {
      ...history,
      [data.day]: {
        names: data.names.map((_, i) => displayName(data, i)),
        totals: finished.map((t, i) => t + (earlier ? earlier.totals[i] : 0)),
      },
    };
  }
  return {
    ...data,
    day: today,
    totals: zeros(),
    since: data.running === null ? 0 : Math.max(data.since, startOfDay(today)),
    history,
  };
}

export function stop(data, now) {
  const r = data.running;
  if (r === null) return data;
  const totals = data.totals.slice();
  totals[r] = elapsed(data, r, now);
  return { ...data, totals, running: null, since: 0 };
}

/** Tapping a project's button: stops it if it is the one running, otherwise switches to it. */
export function tap(data, project, now) {
  if (data.running === project) return stop(data, now);
  return { ...stop(data, now), running: project, since: now };
}

/** Sets a project's time for today; a running project keeps running from there. */
export function setElapsed(data, project, millis, now) {
  const totals = data.totals.slice();
  totals[project] = Math.max(0, millis);
  return { ...data, totals, since: data.running === project ? now : data.since };
}

/** Moves up to [millis] of today's time from one project to another; never takes more than [from] has. */
export function transfer(data, from, to, millis, now) {
  if (from === to) return data;
  const amount = Math.min(Math.max(0, millis), elapsed(data, from, now));
  const taken = setElapsed(data, from, elapsed(data, from, now) - amount, now);
  return setElapsed(taken, to, elapsed(taken, to, now) + amount, now);
}

/** Hours always shown: 0:05:09, 3:42:10. */
export function formatDuration(millis) {
  const s = Math.floor(millis / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Whole minutes from an hours field and a minutes field, or null if they don't make a valid time. Blank counts as 0. */
export function minutesOf(hours, minutes) {
  const h = hours.trim() === '' ? 0 : Number(hours);
  const m = minutes.trim() === '' ? 0 : Number(minutes);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return h >= 0 && h <= 24 && m >= 0 && m <= 59 ? h * 60 + m : null;
}

export function dayLabel(day) {
  return new Date(startOfDay(day)).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

/** Plain text for pasting elsewhere: the date, one line per project that had time, and the total. */
export function dayAsText(day, record, label = dayLabel(day)) {
  const lines = [label];
  record.totals.forEach((t, i) => {
    if (t > 0) lines.push(`${record.names[i].trim()}\t${formatDuration(t)}`);
  });
  lines.push(`Total\t${formatDuration(record.totals.reduce((a, b) => a + b, 0))}`);
  return lines.join('\n');
}

/** Stored or imported data made safe to use: anything missing or malformed falls back to empty. */
export function normalize(raw, now) {
  const base = freshData(now);
  if (!raw || typeof raw !== 'object') return base;
  const list = (a, ok) => Array.isArray(a) && a.length === PROJECT_COUNT && a.every(ok);
  const duration = (n) => Number.isFinite(n) && n >= 0;
  const text = (s) => typeof s === 'string';
  const color = (s) => s === '' || /^#[0-9a-f]{6}$/i.test(s);

  const history = {};
  for (const [day, record] of Object.entries(raw.history && typeof raw.history === 'object' ? raw.history : {})) {
    if (DAY_PATTERN.test(day) && record && list(record.totals, duration) && list(record.names, text)) {
      history[day] = { names: record.names.slice(), totals: record.totals.slice() };
    }
  }
  const running =
    Number.isInteger(raw.running) && raw.running >= 0 && raw.running < PROJECT_COUNT && Number.isFinite(raw.since)
      ? raw.running
      : null;
  return {
    v: 1,
    day: text(raw.day) && DAY_PATTERN.test(raw.day) ? raw.day : base.day,
    totals: list(raw.totals, duration) ? raw.totals.slice() : base.totals,
    running,
    since: running === null ? 0 : raw.since,
    names: list(raw.names, text) ? raw.names.slice() : base.names,
    colors: list(raw.colors, color) ? raw.colors.slice() : base.colors,
    history,
    notify: raw.notify === true,
  };
}

const BACKUP_MARK = 'aust-in-time';

export function exportBackup(data, now) {
  return JSON.stringify({ app: BACKUP_MARK, exported: new Date(now).toISOString(), data }, null, 2);
}

/** The data inside a backup file. Throws if the text is not one. */
export function parseBackup(fileText, now) {
  const parsed = JSON.parse(fileText);
  if (!parsed || parsed.app !== BACKUP_MARK || typeof parsed.data !== 'object') {
    throw new Error('Not an Aust-In-Time backup');
  }
  return normalize(parsed.data, now);
}
