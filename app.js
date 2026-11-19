// The page: draws the data, turns taps into changes, saves after every change.
import {
  DEFAULT_COLOR, PALETTE, PROJECT_COUNT, clockTime, dayAsText, dayLabel, describe, displayName, elapsed,
  exportBackup, formatDuration, freshData, minutesOf, normalize, offTimeline, parseBackup, rollover, setElapsed,
  tap, timelineAsText, timelineAxis, timelineRows, todayRecord, total, transfer,
} from './core.js';
import { load, onExternalChange, save } from './store.js';

const $ = (id) => document.getElementById(id);
const projects = [...Array(PROJECT_COUNT).keys()];

let data = freshData(Date.now());
/** Saves and reloads run one after another, in the order they were asked for. */
let queue = Promise.resolve();

// ---------- data ----------

function commit(next) {
  if (next === data) return;
  data = next;
  render();
  queue = queue.then(() => save(data)).then(
    () => { $('save-warning').hidden = true; },
    () => { $('save-warning').hidden = false; },
  );
  refreshNotification();
}

/** Applies a change as of now, archiving a finished day first if the date has changed. */
function act(change) {
  const now = Date.now();
  commit(change(rollover(data, now), now));
}

/** Picks up what another tab or the notification's Stop button saved. */
function reload() {
  queue = queue.then(load).then((stored) => {
    if (stored) data = normalize(stored, Date.now());
    render();
    tick();
  }).catch(() => {});
}

function tick() {
  const now = Date.now();
  const rolled = rollover(data, now);
  if (rolled !== data) commit(rolled); // midnight passed with the app open
  else {
    renderTimes(now);
    refreshLive?.(now);
  }
}

// ---------- drawing ----------

const colorOf = (project) => data.colors[project] || DEFAULT_COLOR;

/** Sets the color variables the stylesheet uses: the color, its tints, and readable text on top of it. */
function paint(el, hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const linear = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  el.style.setProperty('--c', hex);
  el.style.setProperty('--c-bg', `rgba(${r}, ${g}, ${b}, 0.16)`);
  el.style.setProperty('--c-line', `rgba(${r}, ${g}, ${b}, 0.5)`);
  el.style.setProperty('--on', luminance > 0.4 ? '#111111' : '#ffffff');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const buttons = projects.map((project) => {
  const button = el('button', 'project');
  button.type = 'button';
  const name = el('span', 'name');
  const time = el('span', 'time');
  button.append(name, time);
  pressable(button, () => {
    navigator.vibrate?.(15);
    keepStorage();
    act((d, now) => tap(d, project, now));
  }, () => {
    navigator.vibrate?.(30);
    openTimeDialog(project);
  });
  $('grid').append(button);
  return { button, name, time };
});

const settingsRows = projects.map((project) => {
  const row = el('div', 'project-row');
  const swatch = el('button', 'swatch');
  swatch.type = 'button';
  swatch.setAttribute('aria-label', `Color for button ${project + 1}`);
  swatch.addEventListener('click', () => openColorDialog(project));
  const label = el('label', null, `Button ${project + 1}`);
  const input = el('input');
  input.placeholder = `Project ${project + 1}`;
  input.autocapitalize = 'sentences';
  input.autocomplete = 'off';
  input.enterKeyHint = project < PROJECT_COUNT - 1 ? 'next' : 'done';
  input.addEventListener('input', () => {
    const names = data.names.slice();
    names[project] = input.value;
    commit({ ...data, names });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const next = settingsRows[project + 1];
    if (next) next.input.focus(); else input.blur();
  });
  label.append(input);
  row.append(swatch, label);
  $('projects').append(row);
  return { swatch, input };
});

function render() {
  projects.forEach((project) => {
    const { button, name } = buttons[project];
    paint(button, colorOf(project));
    name.textContent = displayName(data, project);
    button.classList.toggle('running', data.running === project);
    button.setAttribute('aria-pressed', String(data.running === project));

    const { swatch, input } = settingsRows[project];
    paint(swatch, colorOf(project));
    if (document.activeElement !== input) input.value = data.names[project];
  });
  $('notify').checked = data.notify;
  renderTimes(Date.now());
  if (!$('history').hidden) renderHistory();
  if (!$('day').hidden) renderDay();
}

function renderTimes(now) {
  $('total').textContent = formatDuration(total(data, now));
  projects.forEach((project) => {
    buttons[project].time.textContent = formatDuration(elapsed(data, project, now));
  });
}

// ---------- history and the day view ----------

/** Keeps the day in progress counting on screen; set by the open view while a timer runs. */
let refreshLive = null;
/** The day the day view shows, from the address. */
let shownDay = null;

const sum = (list) => list.reduce((a, b) => a + b, 0);
const hourLabel = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric' });

/** A strip across the day's working hours with a block in the project's color for each stretch. */
function drawStrip(strip, segments) {
  const axis = timelineAxis(segments);
  strip.hidden = axis === null;
  strip.replaceChildren();
  if (!axis) return;
  const span = axis.end - axis.start;
  const across = (ms) => `${(ms / span) * 100}%`;
  const track = el('div', 'track');
  for (const s of segments) {
    const block = el('span', 'block');
    block.style.left = across(s.start - axis.start);
    block.style.width = across(s.end - s.start);
    block.style.background = colorOf(s.project);
    track.append(block);
  }
  const ticks = el('div', 'ticks');
  axis.ticks.forEach((tick, i) => {
    const label = el('span', i === 0 ? 'first' : i === axis.ticks.length - 1 ? 'last' : null, hourLabel(tick));
    label.style.left = across(tick - axis.start);
    ticks.append(label);
  });
  strip.append(track, ticks);
}

/**
 * A day's card: its total, a line per project that has time, and its timeline strip if it has one.
 * [running] is the project to list even at zero. With [onOpen], tapping the card calls it.
 * `refresh` puts a newer record's numbers into the same card.
 */
function dayCard(day, record, { title = dayLabel(day), running = null, onOpen = null } = {}) {
  let shown = record;
  const card = el('div', 'day');
  const head = el('div', 'head');
  const heading = el('div', 'grow');
  const dayTotal = el('div', 'sum');
  heading.append(el('div', 'date', title), dayTotal);
  const copy = el('button', 'text', 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', (e) => {
    e.stopPropagation();
    copyText(dayAsText(day, shown));
  });
  head.append(heading, copy);
  card.append(head);
  const times = new Map();
  projects.forEach((project) => {
    if (record.totals[project] === 0 && project !== running) return;
    const line = el('div', 'line');
    const dot = el('span', 'dot');
    paint(dot, colorOf(project));
    const time = el('span', 'time');
    times.set(project, time);
    line.append(dot, el('span', 'grow', record.names[project].trim()), time);
    card.append(line);
  });
  const strip = el('div', 'strip');
  card.append(strip);
  if (onOpen) {
    card.classList.add('opens');
    card.tabIndex = 0;
    card.addEventListener('click', onOpen);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) onOpen(); });
  }
  const refresh = (newer) => {
    shown = newer;
    dayTotal.textContent = formatDuration(sum(newer.totals));
    times.forEach((time, project) => { time.textContent = formatDuration(newer.totals[project]); });
    drawStrip(strip, newer.segments);
  };
  refresh(record);
  return { card, refresh };
}

function renderHistory() {
  const list = $('days');
  list.replaceChildren();
  refreshLive = null;
  const now = Date.now();
  const open = (day) => () => {
    historyScroll = scrollY;
    location.hash = `day/${day}`;
  };
  if (data.running !== null || total(data, now) > 0) {
    const today = dayCard(data.day, todayRecord(data, now), { title: 'Today so far', running: data.running, onOpen: open(data.day) });
    list.append(today.card);
    if (data.running !== null) refreshLive = (at) => today.refresh(todayRecord(data, at));
  }
  const days = Object.keys(data.history).sort().reverse();
  list.append(el('p', 'note', days.length === 0
    ? 'Each day is saved here at midnight. Tap a day to see when each timer ran.'
    : 'Tap a day to see when each timer ran.'));
  for (const day of days) list.append(dayCard(day, data.history[day], { onOpen: open(day) }).card);
}

/** One day, finished or still going: its totals, then when each timer ran and what was changed by hand. */
function renderDay() {
  const body = $('day-body');
  body.replaceChildren();
  refreshLive = null;
  const now = Date.now();
  const isToday = shownDay === data.day;
  const record = isToday ? todayRecord(data, now) : Object.hasOwn(data.history, shownDay) ? data.history[shownDay] : null;
  if (!record) {
    body.append(el('p', 'note', 'Nothing is saved for this day.'));
    return;
  }
  const running = isToday ? data.running : null;
  const card = dayCard(shownDay, record, isToday ? { title: 'Today so far', running } : {});
  body.append(card.card);

  const rows = timelineRows(record.segments);
  let lastTime = null;
  if (rows.length > 0) {
    const head = el('div', 'section-head');
    const copy = el('button', 'text', 'Copy');
    copy.type = 'button';
    // Read again when pressed, so a day still going is copied as it stands.
    copy.addEventListener('click', () => {
      copyText(timelineAsText(shownDay, shownDay === data.day ? todayRecord(data, Date.now()) : record));
    });
    head.append(el('h2', 'grow', 'Timeline'), copy);
    body.append(head);
    rows.forEach((row, i) => {
      const line = el('div', 'stretch');
      lastTime = el('span', 'time', formatDuration(row.end - row.start));
      if (row.project === null) {
        line.classList.add('gap');
        line.append(el('span', 'dot none'), el('span', 'grow', 'Nothing running'), lastTime);
      } else {
        const dot = el('span', 'dot');
        paint(dot, colorOf(row.project));
        const untilNow = running !== null && i === rows.length - 1;
        const what = el('div', 'grow');
        what.append(
          el('div', null, record.names[row.project].trim()),
          el('div', 'when', `${clockTime(row.start)} – ${untilNow ? 'now' : clockTime(row.end)}`),
        );
        line.append(dot, what, lastTime);
      }
      body.append(line);
    });
  }

  if (record.adjustments.length > 0) {
    const head = el('div', 'section-head');
    head.append(el('h2', 'grow', 'Changed by hand'));
    body.append(head);
    for (const a of record.adjustments) {
      const line = el('div', 'change');
      line.append(el('span', 'at', clockTime(a.at)), el('span', 'grow', describe(a, record.names)));
      body.append(line);
    }
  }

  const missing = offTimeline(record);
  if (missing >= 1000) {
    body.append(el('p', 'note', rows.length === 0 && record.adjustments.length === 0
      ? 'No start and stop times were kept for this day: it was tracked before the app had a timeline.'
      : `${formatDuration(missing)} of this day's total is not on the timeline: it was timed before the app kept start and stop times.`));
  }

  if (running !== null) {
    refreshLive = (at) => {
      const newer = todayRecord(data, at);
      const last = timelineRows(newer.segments).pop();
      if (newer.segments.length !== record.segments.length) return renderDay();
      card.refresh(newer);
      if (last) lastTime.textContent = formatDuration(last.end - last.start);
    };
  }
}

// ---------- taps and long presses ----------

/** A tap calls [onTap]; holding for half a second (or a right click) calls [onLong] instead. */
function pressable(target, onTap, onLong) {
  let timer = null;
  let held = false;
  let x = 0;
  let y = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  target.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    held = false;
    x = e.clientX;
    y = e.clientY;
    cancel();
    timer = setTimeout(() => { timer = null; held = true; onLong(); }, 500);
  });
  target.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) target.addEventListener(type, cancel);
  target.addEventListener('click', () => {
    if (held) held = false; // the release after a long press
    else onTap();
  });
  target.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (held) return;
    cancel();
    held = e.pointerType === 'touch';
    onLong();
  });
}

// ---------- the long-press dialog: edit time, move time ----------

const timeDialog = $('time-dialog');
const editH = $('edit-h');
const editM = $('edit-m');
const moveH = $('move-h');
const moveM = $('move-m');
let editing = 0;
let target = null;
/** The whole minutes the dialog opened with: saving them unchanged changes nothing. */
let shownMinutes = 0;

function openTimeDialog(project) {
  editing = project;
  target = null;
  const minutes = Math.floor(elapsed(data, project, Date.now()) / 60_000);
  shownMinutes = minutes;
  $('time-title').textContent = displayName(data, project);
  editH.value = String(Math.floor(minutes / 60));
  editM.value = String(minutes % 60);
  moveH.value = '0';
  moveM.value = '';
  const chips = $('move-chips');
  chips.replaceChildren();
  projects.filter((other) => other !== project).forEach((other) => {
    const chip = el('button', 'chip');
    chip.type = 'button';
    const dot = el('span', 'dot');
    paint(dot, colorOf(other));
    chip.append(dot, el('span', null, displayName(data, other)));
    chip.addEventListener('click', () => {
      target = other;
      [...chips.children].forEach((c) => c.classList.toggle('selected', c === chip));
      checkTimeDialog();
    });
    chips.append(chip);
  });
  checkTimeDialog();
  timeDialog.showModal();
}

function checkTimeDialog() {
  const have = elapsed(data, editing, Date.now());
  const edited = minutesOf(editH.value, editM.value);
  const moved = minutesOf(moveH.value, moveM.value);
  const tooMuch = moved !== null && moved * 60_000 > have;
  editM.classList.toggle('invalid', Number(editM.value) > 59);
  moveM.classList.toggle('invalid', tooMuch || Number(moveM.value) > 59);
  moveH.classList.toggle('invalid', tooMuch);
  $('time-save').disabled = edited === null;
  $('move-error').hidden = !tooMuch;
  $('move-error').textContent = `Only ${formatDuration(have)} to move`;
  $('move-go').disabled = target === null || moved === null || moved <= 0 || tooMuch;
  $('move-go').textContent = target === null ? 'Pick a project' : `Move to ${displayName(data, target)}`;
}

function saveEditedTime() {
  const edited = minutesOf(editH.value, editM.value);
  if (edited === null) return;
  if (edited !== shownMinutes) act((d, now) => setElapsed(d, editing, edited * 60_000, now));
  timeDialog.close();
}

for (const input of [editH, editM, moveH, moveM]) {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 2);
    checkTimeDialog();
  });
}
for (const input of [editH, editM]) {
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEditedTime(); });
}
$('time-save').addEventListener('click', saveEditedTime);
$('time-cancel').addEventListener('click', () => timeDialog.close());
$('move-go').addEventListener('click', () => {
  const moved = minutesOf(moveH.value, moveM.value);
  const from = editing;
  const to = target;
  act((d, now) => transfer(d, from, to, moved * 60_000, now));
  timeDialog.close();
});

// ---------- settings ----------

const colorDialog = $('color-dialog');

function openColorDialog(project) {
  $('color-title').textContent = displayName(data, project);
  const swatches = $('swatches');
  swatches.replaceChildren();
  for (const choice of ['', ...PALETTE]) {
    const swatch = el('button', 'swatch');
    swatch.type = 'button';
    swatch.setAttribute('aria-label', choice || 'Default color');
    paint(swatch, choice || DEFAULT_COLOR);
    swatch.classList.toggle('selected', data.colors[project] === choice);
    swatch.addEventListener('click', () => {
      const colors = data.colors.slice();
      colors[project] = choice;
      commit({ ...data, colors });
      colorDialog.close();
    });
    swatches.append(swatch);
  }
  colorDialog.showModal();
}
$('color-cancel').addEventListener('click', () => colorDialog.close());

// A tap on the dimmed area around a dialog closes it.
for (const dialog of [timeDialog, colorDialog]) {
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}

$('export').addEventListener('click', async () => {
  const name = `aust-in-time-backup-${data.day}.json`;
  const file = new File([exportBackup(data, Date.now())], name, { type: 'application/json' });
  // Phones: the share sheet (Save to Files, email, ...). Elsewhere: a download.
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const link = el('a');
  link.href = URL.createObjectURL(file);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
});

$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let backup;
  try {
    backup = parseBackup(await file.text(), Date.now());
  } catch {
    toast("That file isn't an Aust-In-Time backup");
    return;
  }
  const days = Object.keys(backup.history).length;
  if (!confirm(`Replace everything on this device with this backup (${days} saved ${days === 1 ? 'day' : 'days'})?`)) return;
  commit(rollover(backup, Date.now()));
  toast('Backup imported');
});

// ---------- the running-timer notification (browsers with notification buttons: Chrome on Android, desktop) ----------

const canNotify = 'serviceWorker' in navigator && 'Notification' in window && Notification.maxActions > 0;
$('notify-section').hidden = !canNotify;

$('notify').addEventListener('change', async (e) => {
  if (e.target.checked && (await Notification.requestPermission()) !== 'granted') {
    e.target.checked = false;
    toast('Notifications are blocked for this site in the browser settings');
    return;
  }
  commit({ ...data, notify: e.target.checked });
});

async function refreshNotification() {
  if (!canNotify || Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const running = data.notify ? data.running : null;
    if (running === null) {
      (await registration.getNotifications({ tag: 'running' })).forEach((n) => n.close());
      return;
    }
    await registration.showNotification(displayName(data, running), {
      body: `Running since ${clockTime(data.started)}`,
      tag: 'running',
      icon: 'icons/icon-192.png',
      timestamp: data.started,
      silent: true,
      requireInteraction: true,
      actions: [{ action: 'stop', title: 'Stop' }],
    });
  } catch {
    // No service worker (unsupported or still installing): the timer works without the notification.
  }
}

// ---------- small things ----------

let toastTimer = null;
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = el('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast('Copied');
}

/** Asks the browser not to clear this site's data when the device runs low on space. */
let askedToKeep = false;
function keepStorage() {
  if (askedToKeep) return;
  askedToKeep = true;
  navigator.storage?.persist?.().catch(() => {});
}

// Views are #settings, #history and #day/2026-11-05, so the phone's Back button goes back one step.
let view = 'main';
/** How far down History was when a day was opened, to come back to the same place. */
let historyScroll = 0;
function showView() {
  const hash = location.hash.slice(1);
  const from = view;
  shownDay = hash.startsWith('day/') ? hash.slice(4) : null;
  view = shownDay !== null ? 'day' : ['settings', 'history'].includes(hash) ? hash : 'main';
  for (const name of ['main', 'settings', 'history', 'day']) $(name).hidden = name !== view;
  refreshLive = null;
  if (view === 'history') renderHistory();
  if (view === 'day') renderDay();
  scrollTo(0, view === 'history' && from === 'day' ? historyScroll : 0);
}
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
addEventListener('hashchange', showView);
$('open-settings').addEventListener('click', () => { location.hash = 'settings'; });
$('open-history').addEventListener('click', () => { location.hash = 'history'; });
for (const done of document.querySelectorAll('[data-done]')) done.addEventListener('click', () => history.back());

// A nudge to install, shown in a browser tab only. Installing first matters on iPhone,
// where the home-screen app keeps its own data, separate from Safari's.
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const dismissed = (() => { try { return localStorage.getItem('install-hint') === 'dismissed'; } catch { return false; } })();
if (!installed && !dismissed) {
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent);
  $('install-text').textContent = apple
    ? 'Install first: tap Share, then Add to Home Screen.'
    : "Install: open the browser's menu, then Add to Home screen.";
  $('install-hint').hidden = false;
  $('install-dismiss').addEventListener('click', () => {
    $('install-hint').hidden = true;
    try { localStorage.setItem('install-hint', 'dismissed'); } catch { /* shown again next time */ }
  });
}

// ---------- start ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' }).catch(() => {});
}

onExternalChange(reload);
document.addEventListener('visibilitychange', () => { if (!document.hidden) reload(); });

try {
  const stored = await load();
  if (stored) data = normalize(stored, Date.now());
} catch {
  $('save-warning').hidden = false;
}
render();
showView();
(function loop() {
  tick();
  setTimeout(loop, 1000 - (Date.now() % 1000));
})();
