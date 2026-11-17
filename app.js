// The page: draws the data, turns taps into changes, saves after every change.
import {
  DEFAULT_COLOR, PALETTE, PROJECT_COUNT, dayAsText, dayLabel, displayName, elapsed, exportBackup,
  formatDuration, freshData, minutesOf, normalize, parseBackup, rollover, setElapsed, tap, total, transfer,
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
  else renderTimes(now);
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
}

function renderTimes(now) {
  $('total').textContent = formatDuration(total(data, now));
  projects.forEach((project) => {
    buttons[project].time.textContent = formatDuration(elapsed(data, project, now));
  });
}

function renderHistory() {
  const days = Object.keys(data.history).sort().reverse();
  const list = $('days');
  list.replaceChildren();
  if (days.length === 0) list.append(el('p', 'note', 'Each day is saved here at midnight.'));
  for (const day of days) {
    const record = data.history[day];
    const card = el('div', 'day');
    const head = el('div', 'head');
    const title = el('div', 'grow');
    title.append(el('div', 'date', dayLabel(day)), el('div', 'sum', formatDuration(record.totals.reduce((a, b) => a + b, 0))));
    const copy = el('button', 'text', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', () => copyText(dayAsText(day, record)));
    head.append(title, copy);
    card.append(head);
    projects.forEach((project) => {
      if (record.totals[project] === 0) return;
      const line = el('div', 'line');
      const dot = el('span', 'dot');
      paint(dot, colorOf(project));
      line.append(dot, el('span', 'grow', record.names[project].trim()), el('span', 'time', formatDuration(record.totals[project])));
      card.append(line);
    });
    list.append(card);
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

function openTimeDialog(project) {
  editing = project;
  target = null;
  const minutes = Math.floor(elapsed(data, project, Date.now()) / 60_000);
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
  act((d, now) => setElapsed(d, editing, edited * 60_000, now));
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
    const started = new Date(data.since).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    await registration.showNotification(displayName(data, running), {
      body: `Running since ${started}`,
      tag: 'running',
      icon: 'icons/icon-192.png',
      timestamp: data.since,
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

// Views are #settings and #history so the phone's Back button returns to the timers.
function showView() {
  const view = ['settings', 'history'].find((name) => location.hash === `#${name}`) ?? 'main';
  for (const name of ['main', 'settings', 'history']) $(name).hidden = name !== view;
  if (view === 'history') renderHistory();
  scrollTo(0, 0);
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
  navigator.serviceWorker.register('sw.js', { type: 'module' }).catch(() => {});
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
