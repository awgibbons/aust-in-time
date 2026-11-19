import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROJECT_COUNT, dayAsText, dayOf, describe, displayName, elapsed, exportBackup, formatDuration, freshData,
  minutesOf, normalize, offTimeline, parseBackup, rollover, segmentsAt, setElapsed, startOfDay, stop, tap,
  timelineAsText, timelineAxis, timelineRows, todayRecord, total, transfer,
} from '../core.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (h, m = 0, day = 5) => new Date(2026, 10, day, h, m).getTime();
/** Per-project lists with the given first entries and the rest blank. */
const names = (...first) => [...first, ...Array(PROJECT_COUNT - first.length).fill('')];
const totals = (...first) => [...first, ...Array(PROJECT_COUNT - first.length).fill(0)];
const sum = (list) => list.reduce((a, b) => a + b, 0);

test('tapping starts a project and tapping it again stops it', () => {
  let d = tap(freshData(at(9)), 2, at(9));
  assert.equal(d.running, 2);
  assert.equal(elapsed(d, 2, at(9, 30)), 30 * MIN);
  d = tap(d, 2, at(9, 30));
  assert.equal(d.running, null);
  assert.equal(elapsed(d, 2, at(12)), 30 * MIN);
});

test('starting one project stops the other', () => {
  let d = tap(freshData(at(9)), 0, at(9));
  d = tap(d, 1, at(10));
  assert.equal(d.running, 1);
  assert.equal(elapsed(d, 0, at(11)), HOUR);
  assert.equal(elapsed(d, 1, at(11)), HOUR);
  assert.equal(total(d, at(11)), 2 * HOUR);
});

test('stop with nothing running changes nothing', () => {
  const d = freshData(at(9));
  assert.equal(stop(d, at(10)), d);
});

test('editing a running project keeps it running from the new time', () => {
  let d = tap(freshData(at(9)), 3, at(9));
  d = setElapsed(d, 3, 2 * HOUR, at(10));
  assert.equal(d.running, 3);
  assert.equal(elapsed(d, 3, at(10)), 2 * HOUR);
  assert.equal(elapsed(d, 3, at(10, 15)), 2 * HOUR + 15 * MIN);
});

test('editing a stopped project leaves the running one alone', () => {
  let d = tap(freshData(at(9)), 0, at(9));
  d = setElapsed(d, 5, 45 * MIN, at(10));
  assert.equal(elapsed(d, 5, at(11)), 45 * MIN);
  assert.equal(elapsed(d, 0, at(11)), 2 * HOUR);
});

test('transfer moves time and keeps the total', () => {
  let d = tap(freshData(at(9)), 0, at(9));
  d = transfer(d, 0, 4, 20 * MIN, at(10));
  assert.equal(elapsed(d, 0, at(10)), 40 * MIN);
  assert.equal(elapsed(d, 4, at(10)), 20 * MIN);
  assert.equal(total(d, at(10)), HOUR);
  assert.equal(d.running, 0);
});

test('transfer never takes more than the project has', () => {
  let d = setElapsed(freshData(at(9)), 1, 10 * MIN, at(9));
  d = transfer(d, 1, 2, HOUR, at(9));
  assert.equal(elapsed(d, 1, at(9)), 0);
  assert.equal(elapsed(d, 2, at(9)), 10 * MIN);
  assert.equal(transfer(d, 2, 2, MIN, at(9)), d);
});

test('a new day archives yesterday and starts from zero', () => {
  let d = { ...freshData(at(9)), names: names('Email') };
  d = tap(tap(d, 0, at(9)), 0, at(10));
  const next = rollover(d, at(8, 0, 6));
  assert.equal(next.day, dayOf(at(8, 0, 6)));
  assert.deepEqual(next.totals, Array(PROJECT_COUNT).fill(0));
  assert.equal(next.history[d.day].totals[0], HOUR);
  assert.equal(next.history[d.day].names[0], 'Email');
  assert.equal(next.history[d.day].names[1], 'Project 2');
});

test('a timer running over midnight is split at midnight', () => {
  const d = tap(freshData(at(22)), 6, at(22));
  const next = rollover(d, at(1, 30, 6));
  assert.equal(next.history[d.day].totals[6], 2 * HOUR);
  assert.equal(next.running, 6);
  assert.equal(next.since, startOfDay(next.day));
  assert.equal(elapsed(next, 6, at(1, 30, 6)), 90 * MIN);
});

test('the same day is returned untouched and an empty day is not archived', () => {
  const d = freshData(at(9));
  assert.equal(rollover(d, at(23, 59)), d);
  assert.deepEqual(rollover(d, at(9, 0, 6)).history, {});
});

test('a day finished twice adds up', () => {
  let d = setElapsed(freshData(at(9)), 0, HOUR, at(9));
  d = rollover(d, at(9, 0, 6));
  d = setElapsed({ ...d, day: dayOf(at(9)) }, 0, 30 * MIN, at(9));
  d = rollover(d, at(9, 0, 6));
  assert.equal(d.history[dayOf(at(9))].totals[0], 90 * MIN);
});

test('durations always show hours', () => {
  assert.equal(formatDuration(0), '0:00:00');
  assert.equal(formatDuration(5 * MIN + 9_999), '0:05:09');
  assert.equal(formatDuration(27 * HOUR + 42 * MIN + 10_000), '27:42:10');
});

test('hour and minute fields', () => {
  assert.equal(minutesOf('1', '30'), 90);
  assert.equal(minutesOf('', ''), 0);
  assert.equal(minutesOf('24', '59'), 24 * 60 + 59);
  assert.equal(minutesOf('25', '0'), null);
  assert.equal(minutesOf('1', '60'), null);
  assert.equal(minutesOf('x', '1'), null);
});

test('a day as text lists only projects with time', () => {
  const record = { names: ['Email', 'Calls', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], totals: [HOUR, 0, 0, 0, 0, 0, 0, 90 * MIN, 0, 0] };
  assert.equal(dayAsText('2026-11-05', record, 'Thu'), 'Thu\nEmail\t1:00:00\nh\t1:30:00\nTotal\t2:30:00');
});

test('display names fall back to the button number', () => {
  const d = { ...freshData(at(9)), names: names('  ', 'Calls') };
  assert.equal(displayName(d, 0), 'Project 1');
  assert.equal(displayName(d, 1), 'Calls');
});

test('a backup survives a round trip and junk is rejected', () => {
  let d = tap(freshData(at(9)), 2, at(9));
  d = { ...d, colors: names('#4FC3F7'), notify: true };
  d = transfer(tap(d, 2, at(11)), 2, 0, 10 * MIN, at(11));
  d = rollover(d, at(9, 0, 6));
  assert.deepEqual(parseBackup(exportBackup(d, at(10, 0, 6)), at(10, 0, 6)), d);
  assert.throws(() => parseBackup('{"hello": 1}', at(9)));
  assert.throws(() => parseBackup('not json', at(9)));
});

test('malformed stored data falls back to empty', () => {
  const now = at(9);
  assert.deepEqual(normalize(undefined, now), freshData(now));
  const d = normalize({
    day: 'yesterday', totals: [1, 'x'], names: Array(PROJECT_COUNT + 1).fill(''), running: 12, colors: Array(8).fill('red'),
    segments: [{ project: 99, start: 1, end: 2 }, { project: 0, start: 5, end: 2 }, null], adjustments: 'none',
    history: { x: {}, '2026-11-01': { names: [], totals: [-1] } },
  }, now);
  assert.deepEqual(d, freshData(now));
});

test('data from the eight-project version is kept and filled out to ten', () => {
  const old = {
    v: 1, day: dayOf(at(9)), totals: [HOUR, 0, 0, 0, 0, 0, 0, 5 * MIN], running: 7, since: at(9),
    names: ['Email', '', '', '', '', '', '', 'Other'], colors: ['#4FC3F7', '', '', '', '', '', '', '#E57373'],
    history: { '2026-11-04': { names: ['Email', 'b', 'c', 'd', 'e', 'f', 'g', 'Other'], totals: [0, 0, 0, 0, 0, 0, 0, HOUR] } },
    notify: true,
  };
  const d = normalize(old, at(10));
  assert.deepEqual(d.totals, [HOUR, 0, 0, 0, 0, 0, 0, 5 * MIN, 0, 0]);
  assert.deepEqual(d.names, ['Email', '', '', '', '', '', '', 'Other', '', '']);
  assert.equal(d.colors[7], '#E57373');
  assert.equal(d.colors.length, PROJECT_COUNT);
  assert.equal(d.notify, true);
  assert.equal(d.running, 7);
  assert.equal(d.started, at(9)); // the running timer's start is the best one known
  assert.deepEqual(d.segments, []);
  const day = d.history['2026-11-04'];
  assert.equal(day.totals.length, PROJECT_COUNT);
  assert.equal(day.totals[7], HOUR);
  assert.equal(day.names[7], 'Other');
  assert.deepEqual(day.segments, []);
  assert.deepEqual(day.adjustments, []);
  // It carries on working: the timer stops, the day ends, the old day is still there.
  const next = rollover(stop(d, at(10)), at(9, 0, 6));
  assert.equal(next.history[d.day].totals[7], HOUR + 5 * MIN);
  assert.equal(next.history['2026-11-04'].totals[7], HOUR);
  assert.equal(displayName(next, 9), 'Project 10');
});

test('each stretch a timer runs is kept', () => {
  let d = tap(freshData(at(9)), 0, at(9));
  d = tap(d, 1, at(10));
  assert.deepEqual(d.segments, [{ project: 0, start: at(9), end: at(10) }]);
  assert.deepEqual(segmentsAt(d, at(10, 30)), [
    { project: 0, start: at(9), end: at(10) },
    { project: 1, start: at(10), end: at(10, 30) },
  ]);
  d = tap(d, 1, at(11));
  assert.equal(d.segments.length, 2);
  assert.equal(segmentsAt(d, at(12)), d.segments);
  assert.equal(d.started, 0);
});

test('an edit is noted without moving when the stretch started', () => {
  let d = tap(freshData(at(9)), 0, at(9));
  d = setElapsed(d, 0, 90 * MIN, at(10));
  assert.equal(d.started, at(9));
  assert.deepEqual(d.adjustments, [{ at: at(10), project: 0, delta: 30 * MIN, from: null }]);
  assert.equal(setElapsed(d, 0, elapsed(d, 0, at(10, 5)), at(10, 5)), d);
  d = setElapsed(d, 3, 0, at(10));
  assert.equal(d.adjustments.length, 1);
  d = stop(d, at(11));
  assert.deepEqual(d.segments, [{ project: 0, start: at(9), end: at(11) }]);
  assert.equal(elapsed(d, 0, at(11)), 150 * MIN);
  d = setElapsed(d, 0, 2 * HOUR, at(12));
  assert.equal(d.adjustments[1].delta, -30 * MIN);
});

test('a move is noted once, and moving nothing is not', () => {
  let d = tap(tap(freshData(at(9)), 0, at(9)), 0, at(10));
  assert.equal(transfer(d, 1, 2, MIN, at(10)), d);
  d = transfer(d, 0, 4, 20 * MIN, at(10, 30));
  assert.deepEqual(d.adjustments, [{ at: at(10, 30), project: 4, delta: 20 * MIN, from: 0 }]);
});

test('totals always equal the stretches plus the changes made by hand', () => {
  let d = tap(freshData(at(8)), 0, at(8));
  d = setElapsed(d, 0, 45 * MIN, at(8, 30));
  d = tap(d, 1, at(9));
  d = transfer(d, 0, 1, 10 * MIN, at(9, 15));
  d = transfer(d, 1, 2, 5 * MIN, at(9, 30));
  d = setElapsed(d, 1, 10 * MIN, at(9, 45));
  d = tap(d, 2, at(10));
  const record = todayRecord(d, at(10, 20));
  for (let p = 0; p < PROJECT_COUNT; p++) {
    const ran = sum(record.segments.filter((s) => s.project === p).map((s) => s.end - s.start));
    const given = sum(record.adjustments.filter((a) => a.project === p).map((a) => a.delta));
    const taken = sum(record.adjustments.filter((a) => a.from === p).map((a) => a.delta));
    assert.equal(record.totals[p], ran + given - taken, `project ${p}`);
  }
  assert.equal(offTimeline(record), 0);
});

test('a finished day keeps its timeline and the new day starts a fresh one', () => {
  let d = tap(tap(freshData(at(9)), 0, at(9)), 0, at(10));
  d = transfer(d, 0, 1, 15 * MIN, at(10));
  d = tap(d, 6, at(22));
  const next = rollover(d, at(1, 30, 6));
  const midnight = startOfDay(next.day);
  assert.deepEqual(next.history[d.day].segments, [
    { project: 0, start: at(9), end: at(10) },
    { project: 6, start: at(22), end: midnight },
  ]);
  assert.deepEqual(next.history[d.day].adjustments, d.adjustments);
  assert.deepEqual(next.segments, []);
  assert.deepEqual(next.adjustments, []);
  assert.equal(next.started, midnight);
  assert.deepEqual(segmentsAt(next, at(1, 30, 6)), [{ project: 6, start: midnight, end: at(1, 30, 6) }]);
});

test('a day finished twice keeps both timelines', () => {
  let d = tap(tap(freshData(at(9)), 0, at(9)), 0, at(10));
  d = rollover(d, at(9, 0, 6));
  d = tap(tap({ ...d, day: dayOf(at(9)) }, 1, at(11)), 1, at(12));
  d = rollover(d, at(9, 0, 6));
  const day = d.history[dayOf(at(9))];
  assert.deepEqual(day.segments.map((s) => s.project), [0, 1]);
  assert.equal(day.totals[0] + day.totals[1], 2 * HOUR);
});

test('timeline rows show gaps of a minute or more', () => {
  const rows = timelineRows([
    { project: 2, start: at(13), end: at(14) },
    { project: 0, start: at(9), end: at(10) },
    { project: 1, start: at(10) + 30_000, end: at(12) },
  ]);
  assert.deepEqual(rows.map((r) => r.project), [0, 1, null, 2]);
  assert.deepEqual(rows[2], { project: null, start: at(12), end: at(13) });
  assert.deepEqual(timelineRows([]), []);
});

test('the timeline axis covers whole hours with at most six steps', () => {
  const hours = (axis) => axis.ticks.map((t) => (t - at(0)) / HOUR);
  assert.equal(timelineAxis([]), null);
  assert.deepEqual(hours(timelineAxis([{ project: 0, start: at(8, 47), end: at(10, 15) }])), [8, 9, 10, 11]);
  assert.deepEqual(hours(timelineAxis([{ project: 0, start: at(9), end: at(9) + 5_000 }])), [9, 10]);
  assert.deepEqual(hours(timelineAxis([{ project: 0, start: at(9), end: at(10) }])), [9, 10]);
  const workday = timelineAxis([{ project: 0, start: at(8, 47), end: at(12) }, { project: 1, start: at(13), end: at(17, 12) }]);
  assert.deepEqual(hours(workday), [8, 10, 12, 14, 16, 18]);
  assert.equal(workday.start, at(8));
  assert.equal(workday.end, at(18));
  const allDay = timelineAxis([{ project: 0, start: at(0, 10), end: at(0, 0, 6) }]);
  assert.deepEqual(hours(allDay), [0, 4, 8, 12, 16, 20, 24]);
});

test('time from before the timeline shows as off it', () => {
  const record = { names: names('a', 'b'), totals: totals(2 * HOUR, HOUR), segments: [{ project: 0, start: at(9), end: at(10) }],
    adjustments: [{ at: at(10), project: 1, delta: 30 * MIN, from: null }, { at: at(11), project: 1, delta: 10 * MIN, from: 0 }] };
  assert.equal(offTimeline(record), 90 * MIN);
});

test('changes and the timeline as text', () => {
  const record = {
    names: names('Email', 'Calls'), totals: totals(50 * MIN, 25 * MIN),
    segments: [{ project: 1, start: at(10), end: at(10, 15) }, { project: 0, start: at(9), end: at(10) }],
    adjustments: [{ at: at(10, 20), project: 1, delta: 10 * MIN, from: 0 }],
  };
  assert.equal(describe(record.adjustments[0], record.names), 'Moved 0:10:00 from Email to Calls');
  assert.equal(describe({ at: 0, project: 0, delta: 5 * MIN, from: null }, record.names), 'Added 0:05:00 to Email');
  assert.equal(describe({ at: 0, project: 0, delta: -5 * MIN, from: null }, record.names), 'Took 0:05:00 off Email');
  const clock = (ms) => `${new Date(ms).getHours()}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`;
  assert.equal(timelineAsText('2026-11-05', record, 'Thu', clock), [
    'Thu',
    '9:00\t10:00\tEmail\t1:00:00',
    '10:00\t10:15\tCalls\t0:15:00',
    '10:20\tMoved 0:10:00 from Email to Calls',
  ].join('\n'));
});
