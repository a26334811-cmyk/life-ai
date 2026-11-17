/* Runs the inline app script from index.html inside a Node vm with a tiny fake browser.
   Used by the behaviour tests so they exercise the real app code, not just text in the file. */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const logicSource = fs.readFileSync(path.join(root, 'logic.js'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]));

/* opts.answer   value returned by uiPrompt
   opts.confirm  value returned by uiConfirm (default true)
   opts.choice   value returned by uiChoice (default 'all'); a function receives (message, choices)
   opts.now      fake clock start (ms)
   opts.hidden   document.hidden
   opts.notification  {permission, requestResult} to fake the Notification API
   opts.fetch    fake fetch(url, options) used by the app
   opts.search   makes `location` exist with this query string (e.g. '?url=...' from the phone's Share sheet) */
function createApp(saved, opts = {}) {
  const elements = new Map();
  const storage = new Map(saved ? [['lifeAIPrototypeV5', saved]] : []);
  const clock = { now: opts.now || Date.parse('2026-05-10T03:00:00Z') };
  const timers = [];
  const toasts = [];
  const dialogs = [];

  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(clock.now); }
    static now() { return clock.now; }
  }
  const el = id => {
    if (!ids.has(id)) return null;
    if (!elements.has(id)) {
      elements.set(id, { value: '', dataset: {}, innerHTML: '', textContent: '', style: {}, checked: false,
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } });
    }
    return elements.get(id);
  };
  const notifications = [];
  const context = {
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], hidden: Boolean(opts.hidden), title: '' },
    localStorage: {
      get length() { return storage.size; },
      key: i => [...storage.keys()][i] ?? null,
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { if (opts.failSave) throw new Error('quota'); storage.set(k, v); },
      removeItem: k => storage.delete(k)
    },
    setTimeout: () => 0, clearTimeout() {},
    setInterval: fn => { timers.push(fn); return timers.length; },
    clearInterval: id => { if (id) timers[id - 1] = null; },
    requestAnimationFrame() {},
    Intl, Date: FakeDate, URL, URLSearchParams, AbortController, AbortSignal, console, navigator: {},
    confirm: () => true, prompt: () => opts.answer
  };
  const historyCalls = [];
  if (opts.fetch) context.fetch = (...args) => opts.fetch(...args);
  if (opts.search !== undefined) {
    context.location = { search: opts.search, pathname: '/index.html', protocol: 'https:', hostname: 'app.example' };
    context.history = { replaceState: (a, b, url) => { historyCalls.push(url); context.location.search = ''; } };
  }
  if (opts.notification) {
    const n = opts.notification;
    context.Notification = function (title, options) { notifications.push({ title, options }); };
    context.Notification.permission = n.permission;
    context.Notification.requestPermission = async () => { context.Notification.permission = n.requestResult; return n.requestResult; };
  }
  vm.createContext(context);
  vm.runInContext(logicSource, context);
  vm.runInContext(script, context);
  // Replace the in-app dialogs with scripted answers.
  context.__dialog = (kind, message, extra) => {
    dialogs.push({ kind, message });
    if (kind === 'confirm') return opts.confirm === undefined ? true : (typeof opts.confirm === 'function' ? opts.confirm(message) : opts.confirm);
    if (kind === 'choice') return typeof opts.choice === 'function' ? opts.choice(message, extra) : (opts.choice === undefined ? 'all' : opts.choice);
    if (kind === 'prompt') return opts.answer === undefined ? null : opts.answer;
    return undefined;
  };
  vm.runInContext(`
    uiConfirm=async(message)=>__dialog('confirm',message);
    uiChoice=async(message,choices)=>__dialog('choice',message,choices);
    uiPrompt=async(message)=>__dialog('prompt',message);
    uiAlert=async(message)=>__dialog('alert',message);
    toast=(message)=>__toast(message);
  `, Object.assign(context, { __toast: m => toasts.push(m) }));
  return {
    run: code => vm.runInContext(code, context),
    el, storage, clock, timers, toasts, dialogs, notifications, historyCalls, context,
    tick() { timers.filter(Boolean).forEach(fn => fn()); },
    saved() { return JSON.parse(storage.get('lifeAIPrototypeV5')); }
  };
}

module.exports = { createApp, html, script, ids, logicSource };
