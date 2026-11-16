/* LIFE AI pure logic. No DOM access here so Node tests can exercise it directly.
   Loaded in the browser with <script src="logic.js"> (exposes window.LifeLogic)
   and in Node with require('./logic.js'). */
(function (root) {
  'use strict';

  const FOCUS_MINUTES = [5, 10, 15, 25, 30, 45, 50, 60];
  const FOCUS_HISTORY_LIMIT = 500;
  const DANGEROUS_KEYS = ['__proto__', 'prototype', 'constructor'];

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }

  function koreaDate(ms) {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(ms));
  }

  function dateOffset(date, days) {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // month is 1-12
  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function isRepeating(item) {
    return Boolean(item) && ['daily', 'weekly', 'monthly'].includes(item.repeat);
  }

  /* Does a planner item fall on `date`?
     - skipDates: occurrences removed with "this one only".
     - monthly items that start on the 29th-31st land on the last day of shorter months. */
  function occurs(item, date) {
    if (!item || typeof item !== 'object' || !validDate(item.date) || !validDate(date) || date < item.date) return false;
    if (item.until && date > item.until) return false;
    if (Array.isArray(item.skipDates) && item.skipDates.includes(date)) return false;
    if (item.repeat === 'daily') return true;
    if (item.repeat === 'weekly') {
      return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(item.date + 'T00:00:00Z')) / 86400000) % 7 === 0;
    }
    if (item.repeat === 'monthly') {
      const [year, month, day] = date.split('-').map(Number);
      return day === Math.min(Number(item.date.slice(8, 10)), daysInMonth(year, month));
    }
    return item.date === date;
  }

  // Repeating items keep a done flag per date so ticking one day does not tick every day.
  function isDone(item, date) {
    if (!item) return false;
    if (isRepeating(item)) return Array.isArray(item.doneDates) && item.doneDates.includes(date);
    return Boolean(item.done);
  }

  function toggleDone(item, date) {
    if (!item) return false;
    if (isRepeating(item)) {
      const set = new Set(Array.isArray(item.doneDates) ? item.doneDates : []);
      if (set.has(date)) set.delete(date); else set.add(date);
      item.doneDates = [...set].sort();
      return item.doneDates.includes(date);
    }
    item.done = !item.done;
    return item.done;
  }

  function habitStreak(checks, today) {
    const set = new Set(Array.isArray(checks) ? checks : []);
    let date = today;
    if (!set.has(date)) date = dateOffset(date, -1);
    let streak = 0;
    while (set.has(date) && streak < 3650) { streak++; date = dateOffset(date, -1); }
    return streak;
  }

  /* ---------- saved data checks ---------- */

  const isPlain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const isText = (value, max) => typeof value === 'string' && value.length <= (max || 2000);

  const STRING_KEYS = ['nickname', 'mainGoal', 'selectedCompany', 'selectedJob', 'employmentStatus', 'career', 'education', 'ownedCert', 'policyIncome', 'recoveryMode', 'lastBackupAt', 'backupSnoozeUntil'];
  const BOOLEAN_KEYS = ['jobPreparationStarted', 'policyIncomeAdded', 'jobSubmitted', 'favorite'];
  const ARRAY_KEYS = ['activity', 'completedTasks', 'habits', 'plannerEntries', 'focusHistory', 'jobPostings', 'watchCompanies', 'favoriteCerts'];
  const OBJECT_KEYS = ['parsedGoal', 'focusSettings', 'focusRun'];

  const itemChecks = {
    activity: item => isText(item, 300),
    habits: item => isPlain(item) && isText(item.name, 200) && Array.isArray(item.checks) && item.checks.every(validDate),
    plannerEntries: item => isPlain(item) && isText(item.title, 300) && validDate(item.date),
    focusHistory: item => isPlain(item) && validDate(item.date) && Number.isFinite(Number(item.minutes)) && Number(item.minutes) >= 0,
    jobPostings: item => isPlain(item),
    watchCompanies: item => isPlain(item) || typeof item === 'string',
    favoriteCerts: item => isPlain(item) || typeof item === 'string'
  };

  const STATE_SCHEMA_VERSION = 2;

  /* Upgrades data saved by an older version. Always returns a new object (or the input when it is not an object).
     v1 -> v2: repeating planner items track "done" per date (doneDates) instead of one flag for every day. */
  function migrateState(raw) {
    if (!isPlain(raw)) return raw;
    const out = Object.assign({}, raw);
    const version = Number(raw.schemaVersion) || 1;
    if (version < 2 && Array.isArray(out.plannerEntries)) {
      out.plannerEntries = out.plannerEntries.map(entry =>
        isPlain(entry) && isRepeating(entry) ? Object.assign({}, entry, { done: false, doneDates: [] }) : entry);
    }
    out.schemaVersion = STATE_SCHEMA_VERSION;
    return out;
  }

  /* Cleans an object read from localStorage or a backup file.
     Wrong-typed known fields and broken list items are dropped instead of crashing the app.
     Returns {state, dropped:[names]} or null when the input is not an object at all. */
  function sanitizeState(raw) {
    if (!isPlain(raw)) return null;
    const out = {};
    const dropped = [];
    for (const key of Object.keys(raw)) {
      if (DANGEROUS_KEYS.includes(key)) { dropped.push(key); continue; }
      const value = raw[key];
      if (STRING_KEYS.includes(key)) {
        if (isText(value, 5000)) out[key] = value; else dropped.push(key);
      } else if (key === 'goalType') {
        if (value === null || isText(value, 50)) out[key] = value; else dropped.push(key);
      } else if (BOOLEAN_KEYS.includes(key)) {
        if (typeof value === 'boolean') out[key] = value; else dropped.push(key);
      } else if (OBJECT_KEYS.includes(key)) {
        if (isPlain(value)) out[key] = value; else dropped.push(key);
      } else if (key === 'certSchedule') {
        if (value === null || isPlain(value)) out[key] = value; else dropped.push(key);
      } else if (key === 'completedTasks') {
        if (Array.isArray(value) && value.length <= 20 && value.every(v => typeof v === 'boolean')) out[key] = value; else dropped.push(key);
      } else if (ARRAY_KEYS.includes(key)) {
        if (!Array.isArray(value)) { dropped.push(key); continue; }
        const check = itemChecks[key];
        const kept = check ? value.filter(check) : value;
        if (kept.length !== value.length) dropped.push(key);
        out[key] = kept;
      } else {
        out[key] = value; // unknown keys from newer versions are preserved
      }
    }
    return { state: out, dropped };
  }

  /* Strict check used when restoring a backup file: nothing may be dropped. */
  function validateBackupState(data) {
    const result = sanitizeState(data);
    if (!result || result.dropped.length) return false;
    const s = result.state;
    return typeof s.mainGoal === 'string' && typeof s.nickname === 'string' && Array.isArray(s.activity) && Array.isArray(s.completedTasks);
  }

  /* ---------- focus timer ---------- */

  /* Decides what to do with a focus timer that was saved before the page closed.
     status: idle | paused | running | finished */
  function resumeFocus(run, now) {
    if (!isPlain(run)) return { status: 'idle' };
    const minutes = Number(run.minutes);
    if (!FOCUS_MINUTES.includes(minutes)) return { status: 'idle' };
    const category = ['study', 'job', 'personal'].includes(run.category) ? run.category : 'study';
    const base = { minutes, category };
    if (run.status === 'paused') {
      const remaining = Math.min(minutes * 60, Math.max(1, Math.ceil(Number(run.remaining))));
      if (!Number.isFinite(remaining)) return { status: 'idle' };
      return { ...base, status: 'paused', remaining };
    }
    if (run.status === 'running') {
      const deadline = Number(run.deadline);
      if (!Number.isFinite(deadline) || deadline <= 0) return { status: 'idle' };
      const left = deadline - now;
      if (left > 0) return { ...base, status: 'running', deadline, remaining: Math.ceil(left / 1000) };
      return { ...base, status: 'finished', deadline, finishedAt: new Date(deadline).toISOString(), date: koreaDate(deadline) };
    }
    return { status: 'idle' };
  }

  /* ---------- backup reminder ---------- */

  function hasUserData(state) {
    if (!state) return false;
    return Boolean(state.mainGoal) ||
      ['habits', 'plannerEntries', 'focusHistory', 'jobPostings', 'favoriteCerts'].some(k => Array.isArray(state[k]) && state[k].length);
  }

  /* Returns {kind, message} when the user should be nudged to back up, otherwise null. */
  function backupNudge(state, now, opts) {
    const staleDays = (opts && opts.staleDays) || 14;
    const limit = (opts && opts.historyLimit) || FOCUS_HISTORY_LIMIT;
    if (!hasUserData(state)) return null;
    if (state.backupSnoozeUntil && Date.parse(state.backupSnoozeUntil) > now) return null;
    const count = Array.isArray(state.focusHistory) ? state.focusHistory.length : 0;
    if (count >= Math.floor(limit * 0.9)) {
      return { kind: 'history', message: '집중 기록이 ' + count + '/' + limit + '개예요. 가득 차면 오래된 기록부터 지워져요. 지금 백업해 두면 안전해요.' };
    }
    const last = Date.parse(state.lastBackupAt || '');
    if (!Number.isFinite(last)) return { kind: 'never', message: '아직 백업한 적이 없어요. 브라우저 데이터를 지우면 기록이 사라지니 한 번 백업해 두세요.' };
    const days = Math.floor((now - last) / 86400000);
    if (days >= staleDays) return { kind: 'stale', message: '마지막 백업이 ' + days + '일 전이에요. 새 기록을 백업해 두면 좋아요.' };
    return null;
  }

  const api = {
    FOCUS_MINUTES, FOCUS_HISTORY_LIMIT,
    validDate, koreaDate, dateOffset, daysInMonth,
    occurs, isRepeating, isDone, toggleDone, habitStreak,
    STATE_SCHEMA_VERSION, migrateState, sanitizeState, validateBackupState,
    resumeFocus, backupNudge, hasUserData
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LifeLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
