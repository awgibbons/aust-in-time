# Aust-In-Time

Time tracking, delivered Aust-In-Time. Ten big buttons, one per project: tap one when you start
working on it, tap another when you switch, and see where today went.

**Open it: https://awgibbons.github.io/aust-in-time/**

It is a web page that installs like an app on iPhone and Android. There is no account and no
server: your project names, colors, times and history are stored only on your own device.

## Install

Install it **before** you set up your project names. On iPhone especially, the installed app
keeps its own data, separate from the browser tab.

### iPhone or iPad

1. Open https://awgibbons.github.io/aust-in-time/ in **Safari**.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**. If there is an "Open as Web App"
   switch, leave it on.
4. Open **Aust-In-Time** from your home screen from now on.

### Android

1. Open https://awgibbons.github.io/aust-in-time/ in **Chrome**.
2. Tap the **⋮** menu, then **Add to Home screen**, then **Install**.
3. Open **Aust-In-Time** from your home screen or app drawer.

Optional on Android: in **Settings**, turn on the notification. While a timer runs you get a
silent notification with a **Stop** button, so you can stop it without opening the app.

### Computer

It also works in any desktop browser. Right-click a button for what a long press does on a phone.

## Using it

- **Tap a button** to start that project. Tap another to switch; only one runs at a time.
  Tap the running one to stop.
- **Today** at the top is the total across all ten. Everything resets at midnight.
- **Long-press a button** to fix its time for today, or to move some of its time to another
  project (for when you forgot to switch).
- **Settings** sets each button's name and color.
- **History** keeps every finished day, with today so far at the top. **Copy** puts a day's
  totals on the clipboard as text, ready to paste into a timesheet or a spreadsheet.
- **Tap a day** in History to see its timeline: when each timer started and stopped, the gaps
  in between, and any time you changed by hand. The colored bar on each day shows the same at a
  glance. Days tracked before the timeline was added only have totals.

A timer keeps counting while the app is closed or the phone is locked; it only remembers when
it was started.

## Your data

- Everything stays in the app's storage on your device. Nothing is sent anywhere, and nobody
  else can see it, including whoever hosts the page.
- That also means there is no sync between devices and no way to recover it for you. Removing
  the app from your home screen, or clearing the browser's site data, deletes it.
- **Settings → Export backup** saves everything to a file. **Import backup** restores it, on
  the same device or a new one. Export now and then if the history matters to you.

## Good to know

- It works offline once it has been opened one time.
- Updates arrive on their own, within an open or two after a new version is published. The
  app may reload itself once when that happens. Your names, times and history are kept.
- iPhone has no running-timer notification or lock-screen timer; web apps can't do that there.
- A day is saved to History the first time the app is opened after midnight (or at midnight if
  it is open). A timer left running overnight is counted up to midnight for the old day and
  carries on into the new one. If it is left running for several days without the app being
  opened, the days in between are not recorded.

## Run your own copy

You don't need to: the link above works for everyone, and each person's data is separate. Do
this only if you want to change the app or not depend on that copy.

1. Fork this repository on GitHub.
2. In your fork: **Settings → Pages → Build and deployment → Deploy from a branch**, pick
   `main` and `/ (root)`, and save.
3. A minute later it is live at `https://<your-username>.github.io/aust-in-time/`.

Any static file host works the same way; there is no build step. Note that data is tied to the
address: a copy at a new address starts empty, so export a backup from the old one first and
import it into the new one.

## Development

Plain HTML, CSS and JavaScript modules, no dependencies.

```
npm start    # serves the folder at http://localhost:8000 (python3 -m http.server)
npm test     # unit tests for the timer logic (Node 18+)
```

| File | What it is |
|---|---|
| `core.js` | The timer logic: starting, stopping, editing, moving time, the timeline, midnight rollover, backups. No browser code, so it is what the tests cover. |
| `store.js` | Saving and loading (IndexedDB). |
| `app.js` | The page: drawing, taps, dialogs, settings, history and the day view. |
| `sw.js` | Service worker: offline support and the notification's Stop button. |
| `index.html`, `style.css`, `manifest.webmanifest`, `icons/` | Markup, styling, and what makes it installable. |

When you publish a change, raise the version in `sw.js` (`CACHE` and the `?v=` on its imports).
Installed copies then switch to the new files in one step and reload. Data saved by an older
version has to keep loading: `normalize` in `core.js` is where old shapes are brought up to date.
