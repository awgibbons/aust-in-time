import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROJECT_COUNT, dayAsText, dayOf, displayName, elapsed, exportBackup, formatDuration, freshData,
  minutesOf, normalize, parseBackup, rollover, setElapsed, startOfDay, stop, tap, total, transfer,
} from '../core.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (h, m = 0, day = 5) => new Date(2026, 10, day, h, m).getTime();

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
  let d = { ...freshData(at(9)), names: ['Email', '', '', '', '', '', '', ''] };
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
  const record = { names: ['Email', 'Calls', 'c', 'd', 'e', 'f', 'g', 'h'], totals: [HOUR, 0, 0, 0, 0, 0, 0, 90 * MIN] };
  assert.equal(dayAsText('2026-11-05', record, 'Thu'), 'Thu\nEmail\t1:00:00\nh\t1:30:00\nTotal\t2:30:00');
});

test('display names fall back to the button number', () => {
  const d = { ...freshData(at(9)), names: ['  ', 'Calls', '', '', '', '', '', ''] };
  assert.equal(displayName(d, 0), 'Project 1');
  assert.equal(displayName(d, 1), 'Calls');
});

test('a backup survives a round trip and junk is rejected', () => {
  let d = tap(freshData(at(9)), 2, at(9));
  d = { ...d, colors: ['#4FC3F7', '', '', '', '', '', '', ''], notify: true };
  d = rollover(d, at(9, 0, 6));
  assert.deepEqual(parseBackup(exportBackup(d, at(10, 0, 6)), at(10, 0, 6)), d);
  assert.throws(() => parseBackup('{"hello": 1}', at(9)));
  assert.throws(() => parseBackup('not json', at(9)));
});

test('malformed stored data falls back to empty', () => {
  const now = at(9);
  assert.deepEqual(normalize(undefined, now), freshData(now));
  const d = normalize({ day: 'yesterday', totals: [1, 2], running: 12, colors: Array(8).fill('red'), history: { x: {} } }, now);
  assert.deepEqual(d, freshData(now));
});
