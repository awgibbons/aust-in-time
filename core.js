// Timer logic with no browser dependencies: shared by the page, the service worker and the tests.
// All times are epoch milliseconds; durations are milliseconds; days are local YYYY-MM-DD strings.

export const PROJECT_COUNT = 10;

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
 * Everything the app keeps. At most one project runs at a time; its live stretch
 * (since `since`) is not yet folded into `totals`.
 *
 * The timeline of the day is kept beside the totals:
 * - `segments`: { project, start, end } for each stretch a timer really ran.
 * - `started`: when the running stretch began on the clock. Unlike `since`, editing the
 *   running project's time does not move it.
 * - `adjustments`: { at, project, delta, from } for each change made by hand. A typed-in time
 *   has `from` null and a `delta` that can be negative; a move is recorded once, with
 *   `project` the one that received the time and `from` the one that gave it.
 * So for every project: total = its segments + deltas it received - deltas moved out of it.
 *
 * `history` maps a finished day to its totals, segments, adjustments, and the project
 * names as they were that day.
 */
export function freshData(now) {
  return {
    v: 2,
    day: dayOf(now),
    totals: zeros(),
    running: null,
    since: 0,
    started: 0,
    segments: [],
    adjustments: [],
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

/** Today's stretches as of [now]: the finished ones, plus the one still running. */
export function segmentsAt(data, now) {
  if (data.running === null || now <= data.started) return data.segments;
  return [...data.segments, { project: data.running, start: data.started, end: now }];
}

/** The day in progress as it stands at [now], in the same shape as a finished day in `history`. */
export function todayRecord(data, now) {
  return {
    names: data.names.map((_, i) => displayName(data, i)),
    totals: data.totals.map((_, i) => elapsed(data, i, now)),
    segments: segmentsAt(data, now),
    adjustments: data.adjustments,
  };
}

/**
 * The data as seen at [now]. On a new day the finished day is archived (a running timer
 * counts up to midnight), every total starts from zero and a running timer restarts at midnight.
 * Returns the same object when the day has not changed.
 */
export function rollover(data, now) {
  const today = dayOf(now);
  if (today === data.day) return data;
  const finished = todayRecord(data, Math.min(now, startOfDay(data.day, 1)));
  let history = data.history;
  if (finished.totals.some((t) => t > 0)) {
    // A day can be finished twice when the clock or time zone moves backwards: add to it.
    const earlier = history[data.day];
    if (earlier) {
      finished.totals = finished.totals.map((t, i) => t + earlier.totals[i]);
      finished.segments = [...earlier.segments, ...finished.segments];
      finished.adjustments = [...earlier.adjustments, ...finished.adjustments];
    }
    history = { ...history, [data.day]: finished };
  }
  const midnight = startOfDay(today);
  return {
    ...data,
    day: today,
    totals: zeros(),
    since: data.running === null ? 0 : Math.max(data.since, midnight),
    started: data.running === null ? 0 : Math.max(data.started, midnight),
    segments: [],
    adjustments: [],
    history,
  };
}

export function stop(data, now) {
  const r = data.running;
  if (r === null) return data;
  const totals = data.totals.slice();
  totals[r] = elapsed(data, r, now);
  return { ...data, totals, segments: segmentsAt(data, now), running: null, since: 0, started: 0 };
}

/** Tapping a project's button: stops it if it is the one running, otherwise switches to it. */
export function tap(data, project, now) {
  if (data.running === project) return stop(data, now);
  return { ...stop(data, now), running: project, since: now, started: now };
}

/** A project's time replaced, with no note of it on the timeline. */
function withElapsed(data, project, millis, now) {
  const totals = data.totals.slice();
  totals[project] = millis;
  return { ...data, totals, since: data.running === project ? now : data.since };
}

/** Sets a project's time for today; a running project keeps running from there. */
export function setElapsed(data, project, millis, now) {
  const wanted = Math.max(0, millis);
  const delta = wanted - elapsed(data, project, now);
  if (delta === 0) return data;
  return {
    ...withElapsed(data, project, wanted, now),
    adjustments: [...data.adjustments, { at: now, project, delta, from: null }],
  };
}

/** Moves up to [millis] of today's time from one project to another; never takes more than [from] has. */
export function transfer(data, from, to, millis, now) {
  if (from === to) return data;
  const amount = Math.min(Math.max(0, millis), elapsed(data, from, now));
  if (amount === 0) return data;
  const taken = withElapsed(data, from, elapsed(data, from, now) - amount, now);
  return {
    ...withElapsed(taken, to, elapsed(taken, to, now) + amount, now),
    adjustments: [...data.adjustments, { at: now, project: to, delta: amount, from }],
  };
}

/** A day's lines in order: each stretch, with a gap (project null) wherever at least [minGap] passed between two. */
export function timelineRows(segments, minGap = 60_000) {
  const rows = [];
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    const previous = rows[rows.length - 1];
    if (previous && s.start - previous.end >= minGap) rows.push({ project: null, start: previous.end, end: s.start });
    rows.push({ project: s.project, start: s.start, end: s.end });
  }
  return rows;
}

/**
 * The span a timeline is drawn over: whole hours around the day's stretches, with a few evenly
 * spaced `ticks`. Null when there is nothing to draw. Assumes every stretch falls on the same local day.
 */
export function timelineAxis(segments) {
  if (segments.length === 0) return null;
  const first = new Date(Math.min(...segments.map((s) => s.start)));
  const last = new Date(Math.max(...segments.map((s) => s.end)));
  const sameDay = last.getDate() === first.getDate();
  const partHour = last.getMinutes() > 0 || last.getSeconds() > 0 || last.getMilliseconds() > 0;
  const firstHour = first.getHours();
  const lastHour = sameDay ? Math.max(firstHour + 1, last.getHours() + (partHour ? 1 : 0)) : 24;
  // Every step divides 24, so rounding out to it never leaves the day.
  for (const step of [1, 2, 3, 4, 6, 12, 24]) {
    const from = Math.floor(firstHour / step) * step;
    const to = Math.ceil(lastHour / step) * step;
    if ((to - from) / step > 6) continue;
    const ticks = [];
    for (let hour = from; hour <= to; hour += step) {
      ticks.push(new Date(first.getFullYear(), first.getMonth(), first.getDate(), hour).getTime());
    }
    return { start: ticks[0], end: ticks[ticks.length - 1], ticks };
  }
  return null;
}

/**
 * How much of a day's total the timeline cannot explain: time recorded before the app kept
 * start and stop times. Zero for a day tracked entirely since then.
 */
export function offTimeline(record) {
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  return sum(record.totals)
    - sum(record.segments.map((s) => s.end - s.start))
    - sum(record.adjustments.filter((a) => a.from === null).map((a) => a.delta));
}

/** A change made by hand, in words. */
export function describe(adjustment, names) {
  const name = names[adjustment.project].trim();
  const amount = formatDuration(Math.abs(adjustment.delta));
  if (adjustment.from !== null) return `Moved ${amount} from ${names[adjustment.from].trim()} to ${name}`;
  return adjustment.delta > 0 ? `Added ${amount} to ${name}` : `Took ${amount} off ${name}`;
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

/** Time of day as the device writes it: 8:47 AM, or 08:47 where that is the custom. */
export function clockTime(ms) {
  // Browsers put a narrow no-break space before AM/PM, which spreadsheets don't read as a time.
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\u202f/g, ' ');
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

/** Plain text for pasting elsewhere: the date, then one line per stretch (start, end, project, time) and per change. */
export function timelineAsText(day, record, label = dayLabel(day), clock = clockTime) {
  const lines = [label];
  for (const s of [...record.segments].sort((a, b) => a.start - b.start)) {
    lines.push(`${clock(s.start)}\t${clock(s.end)}\t${record.names[s.project].trim()}\t${formatDuration(s.end - s.start)}`);
  }
  for (const a of record.adjustments) lines.push(`${clock(a.at)}\t${describe(a, record.names)}`);
  return lines.join('\n');
}

/**
 * Stored or imported data made safe to use: anything missing or malformed falls back to empty.
 * Data from earlier versions is brought up to date: those had eight projects and no timeline.
 */
export function normalize(raw, now) {
  const base = freshData(now);
  if (!raw || typeof raw !== 'object') return base;
  /** A copy of a per-project list, filled out to today's number of projects; null if it isn't one. */
  const list = (a, ok, blank) =>
    Array.isArray(a) && a.length <= PROJECT_COUNT && a.every(ok)
      ? [...a, ...Array(PROJECT_COUNT - a.length).fill(blank)]
      : null;
  const duration = (n) => Number.isFinite(n) && n >= 0;
  const text = (s) => typeof s === 'string';
  const color = (s) => s === '' || /^#[0-9a-f]{6}$/i.test(s);
  const project = (n) => Number.isInteger(n) && n >= 0 && n < PROJECT_COUNT;
  const segments = (a) =>
    (Array.isArray(a) ? a : [])
      .filter((s) => s && project(s.project) && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start)
      .map((s) => ({ project: s.project, start: s.start, end: s.end }));
  const adjustments = (a) =>
    (Array.isArray(a) ? a : [])
      .filter((x) => x && Number.isFinite(x.at) && project(x.project) && Number.isFinite(x.delta) && (x.from == null || project(x.from)))
      .map((x) => ({ at: x.at, project: x.project, delta: x.delta, from: x.from ?? null }));

  const history = {};
  for (const [day, record] of Object.entries(raw.history && typeof raw.history === 'object' ? raw.history : {})) {
    if (!DAY_PATTERN.test(day) || !record) continue;
    const totals = list(record.totals, duration, 0);
    const names = list(record.names, text, '');
    if (!totals || !names) continue;
    history[day] = { names, totals, segments: segments(record.segments), adjustments: adjustments(record.adjustments) };
  }
  const running = project(raw.running) && Number.isFinite(raw.since) ? raw.running : null;
  // A timer already running when the timeline arrived: the best known start is `since`.
  const started = Number.isFinite(raw.started) && raw.started > 0 ? raw.started : raw.since;
  return {
    v: 2,
    day: text(raw.day) && DAY_PATTERN.test(raw.day) ? raw.day : base.day,
    totals: list(raw.totals, duration, 0) ?? base.totals,
    running,
    since: running === null ? 0 : raw.since,
    started: running === null ? 0 : started,
    segments: segments(raw.segments),
    adjustments: adjustments(raw.adjustments),
    names: list(raw.names, text, '') ?? base.names,
    colors: list(raw.colors, color, '') ?? base.colors,
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
