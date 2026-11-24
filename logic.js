/* LIFE AI pure logic. No DOM access here so Node tests can exercise it directly.
   Loaded in the browser with <script src="logic.js"> (exposes window.LifeLogic)
   and in Node with require('./logic.js'). */
(function (root) {
  'use strict';

  const FOCUS_MINUTES = [5, 10, 15, 25, 30, 45, 50, 60];
  const FOCUS_MAX_MINUTES = 180;
  const FOCUS_CATEGORIES = [
    { name: 'study', label: '📚 자격증·공부' },
    { name: 'job', label: '💼 취업 준비' },
    { name: 'personal', label: '🌿 개인 목표' }
  ];
  // Returns the value when it is a known focus category, otherwise the first one ('study').
  function focusCategoryName(value) {
    return FOCUS_CATEGORIES.some(c => c.name === value) ? value : FOCUS_CATEGORIES[0].name;
  }
  const FOCUS_HISTORY_LIMIT = 500;
  const DANGEROUS_KEYS = ['__proto__', 'prototype', 'constructor'];

  // The calendar asks about the same few date strings thousands of times per draw, so the answer is remembered.
  const validDateCache = new Map();
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const known = validDateCache.get(value);
    if (known !== undefined) return known;
    const d = new Date(value + 'T00:00:00Z');
    // Chrome's date box turns a typed "26" into the year 0026: years outside 2000-2100 are treated as typos.
    const year = Number(value.slice(0, 4));
    const ok = year >= 2000 && year <= 2100 && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
    if (validDateCache.size >= 5000) validDateCache.clear();
    validDateCache.set(value, ok);
    return ok;
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

  // Sunday-based start of the week that contains `date` (YYYY-MM-DD).
  function weekStart(date) {
    return dateOffset(date, -new Date(date + 'T12:00:00Z').getUTCDay());
  }

  // Start, end and every date of the week or month that contains `today`.
  function periodDates(today, period) {
    let start, end;
    if (period === 'month') {
      start = today.slice(0, 7) + '-01';
      end = today.slice(0, 7) + '-' + String(daysInMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)))).padStart(2, '0');
    } else {
      start = weekStart(today);
      end = dateOffset(start, 6);
    }
    const count = Math.round((new Date(end + 'T12:00:00Z') - new Date(start + 'T12:00:00Z')) / 86400000) + 1;
    return { start, end, dates: Array.from({ length: count }, (_, i) => dateOffset(start, i)) };
  }

  // One entry per exam event. A saved schedule keeps only `rounds`; `items` is built from it when needed.
  // Schedules saved by older versions also stored `items`, which is used when `rounds` is missing.
  function scheduleItems(schedule) {
    if (!schedule || typeof schedule !== 'object') return [];
    if (Array.isArray(schedule.rounds)) {
      const q = schedule.qualification || {};
      return schedule.rounds.flatMap(r => (r && Array.isArray(r.events) ? r.events.filter(e => e && typeof e === 'object') : []).map(e => ({
        qualificationName: q.name, qualificationCode: q.code, round: r.round,
        type: e.type, label: e.label, startDate: e.startDate, endDate: e.endDate, raw: e.raw
      })));
    }
    return Array.isArray(schedule.items) ? schedule.items : [];
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

  /* Same answers as occurs(), but for many dates at once: each item is checked once and each date is parsed once.
     Returns a Map: date -> items that fall on it (in item order). Invalid dates map to an empty list. */
  function occurrencesByDate(items, dates) {
    const result = new Map();
    const days = [];
    for (const date of dates) {
      if (result.has(date)) continue;
      result.set(date, []);
      if (validDate(date)) {
        const [year, month, day] = date.split('-').map(Number);
        days.push({ date, day, year, month, num: Math.round(Date.parse(date + 'T00:00:00Z') / 86400000), last: daysInMonth(year, month) });
      }
    }
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object' || !validDate(item.date)) continue;
      const skip = Array.isArray(item.skipDates) && item.skipDates.length ? new Set(item.skipDates) : null;
      const startNum = Math.round(Date.parse(item.date + 'T00:00:00Z') / 86400000);
      const startDay = Number(item.date.slice(8, 10));
      for (const d of days) {
        if (d.date < item.date) continue;
        if (item.until && d.date > item.until) continue;
        if (skip && skip.has(d.date)) continue;
        let hit;
        if (item.repeat === 'daily') hit = true;
        else if (item.repeat === 'weekly') hit = (d.num - startNum) % 7 === 0;
        else if (item.repeat === 'monthly') hit = d.day === Math.min(startDay, d.last);
        else hit = item.date === d.date;
        if (hit) result.get(d.date).push(item);
      }
    }
    return result;
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

  // Adds one date to the item's skipDates (created if missing, no duplicates, sorted).
  function skipOccurrence(item, date) {
    if (!item) return [];
    item.skipDates = [...new Set([...(Array.isArray(item.skipDates) ? item.skipDates : []), date])].sort();
    return item.skipDates;
  }

  /* Consecutive days with a check. A rest day does not break the run and does not add to it. */
  function habitStreak(checks, today, restDates) {
    const set = new Set(Array.isArray(checks) ? checks : []);
    const rest = new Set(Array.isArray(restDates) ? restDates : []);
    let date = today;
    if (!set.has(date) && !rest.has(date)) date = dateOffset(date, -1);
    let streak = 0;
    for (let steps = 0; (set.has(date) || rest.has(date)) && steps < 3650; steps++) {
      if (set.has(date)) streak++;
      date = dateOffset(date, -1);
    }
    return streak;
  }

  function isHabitRestDay(habit, date) {
    return isPlain(habit) && Array.isArray(habit.restDates) && habit.restDates.includes(date);
  }

  /* ---------- saved data checks ---------- */

  const isPlain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const isText = (value, max) => typeof value === 'string' && value.length <= (max || 2000);

  function isHttpUrl(value) {
    if (typeof value !== 'string') return false;
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch (e) { return false; }
  }

  const STRING_KEYS = ['nickname', 'mainGoal', 'selectedCompany', 'selectedJob', 'employmentStatus', 'career', 'education', 'ownedCert', 'policyIncome', 'recoveryMode', 'lastBackupAt', 'backupSnoozeUntil', 'goalId'];
  const BOOLEAN_KEYS = ['jobPreparationStarted', 'policyIncomeAdded', 'jobSubmitted', 'favorite'];
  const ARRAY_KEYS = ['activity', 'completedTasks', 'habits', 'plannerEntries', 'focusHistory', 'jobPostings', 'watchCompanies', 'favoriteCerts', 'otherGoals', 'taskNames'];
  const OBJECT_KEYS = ['parsedGoal', 'focusSettings', 'focusRun'];

  // Ids of habits and planner entries are used inside page markup, so only plain id characters are allowed.
  const validId = value => typeof value === 'string' && /^[\w-]{1,40}$/.test(value);

  const itemChecks = {
    activity: item => isText(item, 300),
    // only the name is checked here; broken check dates are removed one by one in sanitizeState
    habits: item => isPlain(item) && validId(item.id) && isText(item.name, 200) && Array.isArray(item.checks) &&
      (item.restDates === undefined || Array.isArray(item.restDates)),
    plannerEntries: item => isPlain(item) && validId(item.id) && isText(item.title, 300) && validDate(item.date),
    focusHistory: item => isPlain(item) && validDate(item.date) && Number.isFinite(Number(item.minutes)) && Number(item.minutes) >= 0,
    jobPostings: item => isPlain(item) && (item.tasks===undefined||Array.isArray(item.tasks)) && isText(item.id, 200) && isText(item.company, 2000) && isText(item.title, 2000) &&
      (item.url === undefined || item.url === '' || isHttpUrl(item.url)),
    taskNames: item => isText(item, 100) && item.trim() !== '',
    watchCompanies: item => isPlain(item) || typeof item === 'string',
    favoriteCerts: item => isPlain(item) && isText(item.name, 300) && isText(item.code, 300)
  };

  /* A planner item keeps its title and date even when time/repeat/until are broken: those fields fall back to their
     defaults (no time, no repeat, no end date) instead of the item being dropped or crashing the calendar. */
  function cleanPlannerEntry(item) {
    const out = Object.assign({}, item);
    if ('time' in out && !(out.time === '' || (typeof out.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(out.time)))) out.time = '';
    if ('repeat' in out && !['none', 'daily', 'weekly', 'monthly'].includes(out.repeat)) out.repeat = 'none';
    if ('until' in out && !(out.until === '' || validDate(out.until))) out.until = '';
    return out;
  }

  // A saved posting's memo is capped so a few pasted postings cannot fill the browser's storage. Longer ones are cut, not dropped.
  const POSTING_NOTES_MAX = 2000;

  /* Extra steps of one posting ("서류 발표", "인적성", "1차 면접" ...): {id, label, date, time}. Broken entries are dropped one by one. */
  const MAX_POSTING_EVENTS = 20;
  function cleanPostingEvents(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter(e => isPlain(e) && validId(e.id) && isText(e.label, 40) && e.label.trim() && validDate(e.date))
      .slice(0, MAX_POSTING_EVENTS)
      .map(e => ({ id: e.id, label: e.label.trim(), date: e.date, time: validTime(e.time) ? e.time : '' }));
  }
  /* The steps of a posting that are still ahead: none once it was rejected or cancelled. */
  function postingEventsOf(p) {
    if (!isPlain(p) || ['불합격', '지원 취소'].includes(p.stage)) return [];
    return cleanPostingEvents(p.events);
  }

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
    // a watch-company entry saved as plain text becomes a normal {id, name, url} record
    if (Array.isArray(out.watchCompanies)) {
      out.watchCompanies = out.watchCompanies.map(item =>
        typeof item === 'string' ? { id: newRecordId(), name: item.trim(), url: '' } : item);
    }
    // records without an id are shown but cannot be checked, edited or deleted: give them one instead of dropping them
    for (const key of ['habits', 'plannerEntries', 'watchCompanies']) {
      if (!Array.isArray(out[key])) continue;
      out[key] = out[key].map(item =>
        isPlain(item) && (item.id === undefined || item.id === null || item.id === '') ? Object.assign({}, item, { id: newRecordId() }) : item);
    }
    // an old or hand-edited file may list a favourite certificate as plain text: keep it as a named item without a code
    if (Array.isArray(out.favoriteCerts)) {
      out.favoriteCerts = out.favoriteCerts.map(item => (typeof item === 'string' && item.trim() ? { name: item.trim(), code: '' } : item));
    }
    out.schemaVersion = Math.max(version, STATE_SCHEMA_VERSION); // never lower a version written by a newer app
    return out;
  }

  function newRecordId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
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
        if (value === null) { out[key] = value; continue; }
        if (!isPlain(value)) { dropped.push(key); continue; }
        // The exam schedule can be fetched again, so malformed rounds are just emptied instead of crashing Home.
        const validRounds = Array.isArray(value.rounds) && value.rounds.every(r => isPlain(r) && typeof r.round === 'string' && Array.isArray(r.events) && r.events.every(isPlain));
        out[key] = (value.rounds === undefined || validRounds) ? value : { ...value, rounds: [] };
      } else if (key === 'completedTasks') {
        if (Array.isArray(value) && value.length <= 20 && value.every(v => typeof v === 'boolean')) out[key] = value; else dropped.push(key);
      } else if (ARRAY_KEYS.includes(key)) {
        if (!Array.isArray(value)) { dropped.push(key); continue; }
        const check = itemChecks[key];
        let items = value, droppedDate = false;
        if (key === 'habits') {
          // keep a habit's good check dates even when some other date in it is broken
          items = value.map(habit => {
            if (!(check(habit))) return habit;
            const checks = habit.checks.filter(validDate);
            const fixed = {};
            if (checks.length !== habit.checks.length) fixed.checks = checks;
            if (Array.isArray(habit.restDates) && !habit.restDates.every(validDate)) fixed.restDates = habit.restDates.filter(validDate);
            if (!Object.keys(fixed).length) return habit;
            droppedDate = true;
            return Object.assign({}, habit, fixed);
          });
        }
        if (key === 'otherGoals') {
          // parked goals: keep the usable ones, with wrong-typed fields replaced by defaults (at most MAX_GOALS - 1)
          const cleaned = value.map(cleanGoal).filter(Boolean).slice(0, MAX_GOALS - 1);
          if (cleaned.length !== value.length) dropped.push(key);
          out[key] = cleaned;
          continue;
        }
        let kept = check ? items.filter(check) : items;
        if (key === 'taskNames' && kept.length > 20) kept = kept.slice(0, 20);
        if (key === 'plannerEntries') kept = kept.map(cleanPlannerEntry);
        if (key === 'jobPostings') {
          kept = kept.map(p => {
            const fixes = {};
            if (p.events !== undefined) fixes.events = cleanPostingEvents(p.events);
            if (typeof p.notes === 'string' && p.notes.length > POSTING_NOTES_MAX) fixes.notes = p.notes.slice(0, POSTING_NOTES_MAX);
            return Object.keys(fixes).length ? Object.assign({}, p, fixes) : p;
          });
        }
        if (kept.length !== value.length || droppedDate) dropped.push(key);
        out[key] = kept;
      } else {
        out[key] = value; // unknown keys from newer versions are preserved
      }
    }
    if (Array.isArray(out.taskNames) && out.taskNames.length && Array.isArray(out.completedTasks)) {
      fitTaskFlags(out, out.taskNames.length); // one flag per own step
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

  const BACKUP_FORMAT = 'life-ai-backup';
  const BACKUP_VERSION = 1;

  /* Reads the text of a backup file and runs every check (JSON, format, version, state shape).
     Returns {ok:true, state} with the upgraded, cleaned state, or {ok:false, message} for the user. */
  function readBackup(text) {
    let backup;
    try { backup = JSON.parse(text); } catch (e) { return { ok: false, message: '백업 파일을 읽지 못했어요. 앱에서 만든 life-ai-backup-날짜.json 파일을 골라 주세요.' }; }
    if (isPlain(backup) && backup.format === BACKUP_FORMAT && Number.isFinite(backup.version) && backup.version > BACKUP_VERSION) {
      return { ok: false, message: '더 새로운 버전에서 만든 백업이에요. 앱을 새로 고침한 뒤 다시 시도해 주세요.' };
    }
    if (!isPlain(backup) || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION || !isPlain(backup.state)) {
      return { ok: false, message: '올바른 life-ai 백업 파일이 아니에요.' };
    }
    const migrated = migrateState(backup.state);
    if (!validateBackupState(migrated)) return { ok: false, message: '백업 데이터의 구조가 올바르지 않아요.' };
    return { ok: true, state: sanitizeState(migrated).state };
  }

  /* ---------- focus timer ---------- */

  /* Any whole number of minutes from 1 to 180 is allowed (the preset list FOCUS_MINUTES is only the quick choices). */
  function isFocusMinutes(value) {
    const n = Number(value);
    return value !== '' && value !== null && Number.isInteger(n) && n >= 1 && n <= FOCUS_MAX_MINUTES;
  }

  /* Sum of the minutes of the focus records that pass `filter` (all records when it is left out).
     A minutes value that is not a number counts as 0 - this is the only place that rule lives. */
  function focusMinutes(history, filter) {
    if (!Array.isArray(history)) return 0;
    return history.reduce((sum, x) => (!filter || filter(x) ? sum + (Number(x && x.minutes) || 0) : sum), 0);
  }

  /* Decides what to do with a focus timer that was saved before the page closed.
     status: idle | paused | running | finished */
  function resumeFocus(run, now) {
    if (!isPlain(run)) return { status: 'idle' };
    const minutes = Number(run.minutes);
    if (!isFocusMinutes(minutes)) return { status: 'idle' };
    const category = focusCategoryName(run.category);
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
      if (left > 0) {
        // never longer than the timer length (e.g. the phone clock was set back); keep the deadline in step with it
        const remaining = Math.min(minutes * 60, Math.ceil(left / 1000));
        return { ...base, status: 'running', deadline: remaining < Math.ceil(left / 1000) ? now + remaining * 1000 : deadline, remaining };
      }
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

  // How many saved records the user has made (habits, schedule entries, focus sessions, postings, favourites).
  function recordCount(state) {
    if (!state) return 0;
    return ['habits', 'plannerEntries', 'focusHistory', 'jobPostings', 'favoriteCerts']
      .reduce((sum, k) => sum + (Array.isArray(state[k]) ? state[k].length : 0), 0);
  }

  /* Returns {kind, message} when the user should be nudged to back up, otherwise null.
     A first-day user who only typed a goal is not nagged: "never backed up" needs at least 3 saved records. */
  function backupNudge(state, now, opts) {
    const staleDays = (opts && opts.staleDays) || 14;
    const limit = (opts && opts.historyLimit) || FOCUS_HISTORY_LIMIT;
    if (!hasUserData(state)) return null;
    if (state.backupSnoozeUntil && Date.parse(state.backupSnoozeUntil) > now) return null;
    const count = Array.isArray(state.focusHistory) ? state.focusHistory.length : 0;
    const last = Date.parse(state.lastBackupAt || '');
    // A backup made within the last 7 days answers the "history nearly full" warning; later checks still apply.
    const recentlyBackedUp = Number.isFinite(last) && now - last < 7 * 86400000;
    if (count >= Math.floor(limit * 0.9) && !recentlyBackedUp) {
      return { kind: 'history', message: '집중 기록이 ' + count + '/' + limit + '개예요. 가득 차면 오래된 기록부터 지워져요. 지금 백업해 두면 안전해요.' };
    }
    if (!Number.isFinite(last)) {
      if (recordCount(state) < 3) return null;
      return { kind: 'never', message: '아직 백업한 적이 없어요. 브라우저 데이터를 지우면 기록이 사라지니 한 번 백업해 두세요.' };
    }
    const days = Math.floor((now - last) / 86400000);
    if (days >= staleDays) return { kind: 'stale', message: '마지막 백업이 ' + days + '일 전이에요. 새 기록을 백업해 두면 좋아요.' };
    return null;
  }

  /* ---------- job posting helpers ---------- */

  function firstUrl(text) {
    const match = String(text || '').match(/https?:\/\/[^\s<>"'`]+/i);
    if (!match) return '';
    const cleaned = match[0].replace(/[)\]}>.,;:!?。、」』”’]+$/, '');
    try { const u = new URL(cleaned); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch (e) { return ''; }
  }

  /* Tidy a posting link before it is saved or compared: http/https only, no id:password@, no #fragment,
     no tracking values (utm_*, fbclid, gclid ...). Returns '' when it is not a usable web link. */
  const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|igshid|mc_cid|mc_eid)$/i;
  function cleanPostingUrl(value) {
    let u;
    try { u = new URL(String(value || '').trim()); } catch (e) { return ''; }
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    u.username = ''; u.password = ''; u.hash = '';
    const drop = [...u.searchParams.keys()].filter(k => TRACKING_PARAMS.test(k));
    if (drop.length) drop.forEach(k => u.searchParams.delete(k));
    return u.href;
  }

  /* What the phone's "Share" sheet sends to the app (?title=&text=&url=). Many apps put the link in `text`. */
  function parseShareParams(search) {
    let params;
    try { params = new URLSearchParams(search || ''); } catch (e) { return null; }
    const title = params.get('title') || '', text = params.get('text') || '', urlParam = params.get('url') || '';
    const url = firstUrl(urlParam) || firstUrl(text) || firstUrl(title);
    if (!url) return null;
    const strip = s => s.replace(/https?:\/\/[^\s]+/gi, '').replace(/\s+/g, ' ').trim();
    const label = strip(title) || strip(text);
    return { url, title: label.slice(0, 120) };
  }

  // "공고 제목 - 사람인" -> "공고 제목" (only when the tail really is the site name)
  function cleanTitle(title, siteName) {
    let t = String(title || '').replace(/\s+/g, ' ').trim();
    const site = String(siteName || '').trim();
    if (site) {
      for (const sep of [' - ', ' | ', ' : ', ' · ', ' – ', ' — ']) {
        if (t.endsWith(sep + site)) { t = t.slice(0, -(sep + site).length).trim(); break; }
      }
    }
    return t.slice(0, 120);
  }

  // Dates about 2 years away from today are not trusted as a posting deadline ('9999-12-31' placeholders etc.)
  function deadlineInRange(iso, today) {
    return validDate(iso) && validDate(today) && iso >= dateOffset(today, -366 * 2) && iso <= dateOffset(today, 366 * 2);
  }

  const POSITIVE = [['마감', 3], ['까지', 2], ['접수', 1], ['지원기간', 1], ['모집기간', 1], ['서류', 1]];
  const NEGATIVE = ['공고일', '게시일', '등록일', '작성일', '발표', '면접', '시작', '개시', '입사', '입과', '교육'];

  /* 'HH:MM' (24 hours) - the form of every time stored in a record. */
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

  /* A closing time written right after a date: "2026.11.30(일) 18:00", "11월 30일 오후 6시", "11/30 17시 30분".
     "24:00" / "24시" means the end of that day and is kept as 23:59. Returns '' when there is none. */
  function timeRightAfter(text) {
    const m = String(text || '').match(/^\s*(?:\([^)]*\)|[월화수목금토일]요일)?\s*(오전|오후)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시(?!간)(?:\s*(\d{1,2})\s*분)?)/);
    if (!m) return '';
    let hour = Number(m[2]);
    const minute = Number(m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : 0));
    if (minute > 59) return '';
    if (m[1] === '오후' && hour < 12) hour += 12;
    if (m[1] === '오전' && hour === 12) hour = 0;
    if (hour === 24 && minute === 0) return '23:59';
    if (hour > 23) return '';
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  /* Finds the most likely application deadline in pasted posting text.
     Returns {date:'YYYY-MM-DD', time:'HH:MM' or '', past:boolean, confident:boolean, snippet} or null. Never guesses without a clue word. */
  function extractDeadline(text, today) {
    // links often hold dates (/2026/11/30/) that are not deadlines; blank them out but keep every position
    const src = String(text || '').slice(0, 30000).replace(/https?:\/\/[^\s<>"'`]+/gi, u => ' '.repeat(u.length));
    if (!src || !validDate(today)) return null;
    const year = Number(today.slice(0, 4));
    const found = [];
    const add = (index, length, y, m, d, hasYear) => {
      let iso = null;
      const make = (yy) => { const s = yy + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); return validDate(s) ? s : null; };
      if (hasYear) iso = make(y);
      else {
        iso = make(year);
        // "1월 5일까지" read in December means next year; "2월 29일" in a non-leap year only exists in a later year
        if (!iso || iso < dateOffset(today, -180)) iso = make(year + 1); // a date only weeks ago ("10월 5일" in mid-November) stays a past date
        // "12월 28일까지" read in early January means last month, not 11 months from now
        else if (iso > dateOffset(today, 183)) iso = make(year - 1) || iso;
      }
      if (iso && deadlineInRange(iso, today)) found.push({ index, length, iso, hasYear });
    };
    let m;
    const full = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/g;
    while ((m = full.exec(src))) add(m.index, m[0].length, Number(m[1]), Number(m[2]), Number(m[3]), true);
    // two-digit year as many company sites write it: 26.11.22(일) -> 2026-11-22
    const twoDigit = /(?<![\d.\-/])(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?![\d])/g;
    while ((m = twoDigit.exec(src))) {
      if (found.some(f => m.index >= f.index && m.index < f.index + f.length)) continue;
      add(m.index, m[0].length, 2000 + Number(m[1]), Number(m[2]), Number(m[3]), true);
    }
    const korean = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
    while ((m = korean.exec(src))) {
      if (found.some(f => m.index >= f.index && m.index < f.index + f.length)) continue;
      add(m.index, m[0].length, 0, Number(m[1]), Number(m[2]), false);
    }
    const short = /(?<![\d.\-/])(\d{1,2})\s*[./]\s*(\d{1,2})(?![\d.\-/])/g;
    while ((m = short.exec(src))) {
      if (found.some(f => m.index >= f.index && m.index < f.index + f.length)) continue;
      const before = found.length;
      add(m.index, m[0].length, 0, Number(m[1]), Number(m[2]), false);
      if (found.length > before) found[found.length - 1].short = true; // "11.30" / "11/30"
    }
    // "11월 10일 ~ 30일": the end of a range often drops the month. Read it as the same month's end date.
    const tail = /^\s*(?:\([^)]*\))?\s*[~∼～]\s*(\d{1,2})(?:\s*일|(?=\s*(?:\(|까지|마감|$|[,)\n])))/;
    for (const c of found.slice()) {
      const t = tail.exec(src.slice(c.index + c.length, c.index + c.length + 40));
      if (!t) continue;
      const ym = c.iso.slice(0, 8);
      const endIso = ym + String(Number(t[1])).padStart(2, '0');
      if (!validDate(endIso) || endIso < c.iso) continue;
      const offset = t[0].lastIndexOf(t[1]);
      const at = c.index + c.length + offset, length = t[0].length - offset;
      if (found.some(f => f.index === at)) continue;
      found.push({ index: at, length, iso: endIso, hasYear: c.hasYear });
    }
    if (!found.length) return null;
    const closing = [];
    for (let i = src.indexOf('마감'); i >= 0; i = src.indexOf('마감', i + 1)) closing.push(i);
    const closingDistance = c => closing.reduce((min, i) => Math.min(min, i >= c.index + c.length ? i - (c.index + c.length) : c.index - (i + 2)), Infinity);
    let best = null;
    for (const c of found) {
      const before = src.slice(Math.max(0, c.index - 30), c.index);
      const after = src.slice(c.index + c.length, c.index + c.length + 16);
      let score = 0;
      // "3.5" in "학점 3.5 이상" must not borrow a 마감 that is far away: a short form needs the clue right next to it.
      const clueNear = !c.short || /(마감|까지)[^\d]{0,6}$/.test(before) || /^[^\d]{0,3}(까지|마감)/.test(after);
      if (clueNear) for (const [word, points] of POSITIVE) { if (before.includes(word) || after.includes(word)) score += points; }
      // end of a range: "11.10 ~ 11.30" (parenthesised weekdays are ignored)
      // also "11.10 – 11.30", "11.10 — 11.30" and a space-separated "11.10 - 11.30"
      const noParen = before.replace(/\([^)]*\)/g, '');
      const compact = noParen.replace(/\s+/g, '');
      const isRangeEnd = /[~∼～–—]$/.test(compact) || /\s-\s*$/.test(noParen);
      // for a range end, the clue words sit before the range start ("면접: 12.5 ~ 12.7"), so look there too
      let near = before.slice(-10);
      if (isRangeEnd) {
        const cut = noParen.search(/(?:[~∼～–—]|\s-)\s*$/);
        if (cut >= 0) near += noParen.slice(0, cut).replace(/[\d.\-/년월일\s]+$/, '').slice(-10);
      }
      for (const word of NEGATIVE) { if (near.includes(word)) score -= 3; }
      if (isRangeEnd) score += 3;
      if (!c.hasYear && score < 3) score -= 1; // short forms need a stronger clue
      // equal score: the one closest to a 마감 word, then the later date
      const dist = closingDistance(c);
      if (!best || score > best.score || (score === best.score && (dist < best.dist || (dist === best.dist && c.iso > best.iso)))) best = { ...c, score, dist };
    }
    if (!best || best.score < 2) return null;
    return {
      date: best.iso,
      time: timeRightAfter(src.slice(best.index + best.length, best.index + best.length + 16)),
      past: best.iso < today,
      confident: best.score >= 4,
      snippet: src.slice(Math.max(0, best.index - 12), best.index + best.length + 8).replace(/\s+/g, ' ').trim()
    };
  }

  /* Goal progress shown on Home. A job goal has no 5-step list, so it counts the prepare checks of every saved posting. */
  /* ---------- several goals ----------
     The goal in use ("active") lives in the top-level fields (mainGoal, goalType, ...), so every screen keeps working
     on it. The other goals are parked as copies in state.otherGoals; switching swaps the two. */
  const GOAL_FIELDS = ['mainGoal', 'goalType', 'parsedGoal', 'completedTasks', 'policyIncome', 'policyIncomeAdded',
    'certSchedule', 'selectedCompany', 'selectedJob', 'employmentStatus', 'career', 'education', 'ownedCert', 'favorite', 'taskNames'];
  const MAX_GOALS = 5;

  const goalDefaults = () => ({
    mainGoal: '', goalType: null, parsedGoal: {}, completedTasks: [false, false, false, false, false],
    policyIncome: '', policyIncomeAdded: false, certSchedule: null,
    selectedCompany: '', selectedJob: '', employmentStatus: '', career: '', education: '', ownedCert: '', favorite: false,
    taskNames: [] // the user's own to-do steps; empty = the default steps of the goal type
  });
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  /* A goal read from storage or a backup: wrong-typed fields are replaced by their defaults so switching to it cannot
     break a screen. Returns null when it is not a usable goal (no plain object, bad id, no title). */
  function cleanGoal(raw) {
    if (!isPlain(raw) || !validId(raw.id) || !isText(raw.mainGoal, 5000) || !raw.mainGoal.trim()) return null;
    const d = goalDefaults();
    const out = { id: raw.id };
    for (const key of GOAL_FIELDS) {
      const v = raw[key];
      if (typeof d[key] === 'string') out[key] = isText(v, 5000) ? v : d[key];
      else if (typeof d[key] === 'boolean') out[key] = typeof v === 'boolean' ? v : d[key];
      else if (key === 'completedTasks') out[key] = Array.isArray(v) && v.length <= 20 && v.every(x => typeof x === 'boolean') ? clone(v) : d[key];
      else if (key === 'taskNames') out[key] = Array.isArray(v) ? v.filter(n => isText(n, 100) && n.trim()).slice(0, 20) : [];
      else if (key === 'parsedGoal') out[key] = isPlain(v) ? clone(v) : d[key];
      else if (key === 'certSchedule') out[key] = isPlain(v) ? clone(v) : null;
      else if (key === 'goalType') out[key] = v === null || isText(v, 50) ? (v === undefined ? null : v) : null;
    }
    return out;
  }

  function goalCount(state) {
    const s = state || {};
    return (s.mainGoal ? 1 : 0) + (Array.isArray(s.otherGoals) ? s.otherGoals.length : 0);
  }
  function canAddGoal(state) { return goalCount(state) < MAX_GOALS; }

  /* The active goal needs an id so it can be told apart from the parked ones. */
  function ensureGoalId(state, makeId) {
    if (state.mainGoal && !validId(state.goalId)) state.goalId = makeId();
    return state.goalId;
  }

  /* Copy of the active goal's fields (what gets parked). */
  function snapshotGoal(state, makeId) {
    ensureGoalId(state, makeId);
    const snap = { id: state.goalId };
    for (const key of GOAL_FIELDS) if (state[key] !== undefined) snap[key] = clone(state[key]);
    return snap;
  }

  /* Makes `goal` the active goal. */
  function applyGoal(state, goal) {
    const clean = cleanGoal(goal) || Object.assign(goalDefaults(), { id: null });
    const defaults = goalDefaults();
    for (const key of GOAL_FIELDS) state[key] = clean[key] !== undefined ? clean[key] : defaults[key];
    if (clean.id) state.goalId = clean.id; else delete state.goalId;
    if (state.taskNames.length) fitTaskFlags(state, state.taskNames.length); // one flag per step
  }

  /* Puts the active goal aside and leaves an empty slot for a new one. Returns false when there is nothing to put
     aside or the limit is reached. */
  function parkActiveGoal(state, makeId) {
    if (!state.mainGoal || !canAddGoal(state)) return false;
    if (!Array.isArray(state.otherGoals)) state.otherGoals = [];
    state.otherGoals.push(snapshotGoal(state, makeId));
    applyGoal(state, null);
    return true;
  }

  /* An empty slot with parked goals means a new goal was started and never finished: bring the last parked one back. */
  function restoreParkedGoal(state) {
    if (state.mainGoal || !Array.isArray(state.otherGoals) || !state.otherGoals.length) return false;
    applyGoal(state, state.otherGoals.pop());
    return true;
  }

  /* Swaps the active goal with the parked goal `id` (the old active goal takes its place in the list). */
  function switchGoal(state, makeId, id) {
    const list = Array.isArray(state.otherGoals) ? state.otherGoals : [];
    const at = list.findIndex(g => g && g.id === id);
    if (at < 0) return false;
    const target = list[at];
    list[at] = state.mainGoal ? snapshotGoal(state, makeId) : null;
    if (list[at] === null) list.splice(at, 1);
    state.otherGoals = list;
    applyGoal(state, target);
    return true;
  }

  /* Deletes a goal. The last remaining goal cannot be deleted. Deleting the active goal activates the first parked one. */
  function removeGoal(state, makeId, id) {
    if (goalCount(state) <= 1) return { ok: false, reason: 'last' };
    ensureGoalId(state, makeId);
    if (id === state.goalId) {
      applyGoal(state, state.otherGoals.shift());
      return { ok: true };
    }
    const at = (state.otherGoals || []).findIndex(g => g && g.id === id);
    if (at < 0) return { ok: false, reason: 'missing' };
    state.otherGoals.splice(at, 1);
    return { ok: true };
  }

  /* Cards for the goals screen: the active goal first, then the parked ones. */
  function goalList(state, makeId) {
    const s = state || {};
    const out = [];
    if (s.mainGoal) {
      out.push({ id: ensureGoalId(s, makeId), active: true, title: s.mainGoal, type: s.goalType || null });
    }
    for (const g of Array.isArray(s.otherGoals) ? s.otherGoals : []) {
      if (g && g.mainGoal) out.push({ id: g.id, active: false, title: g.mainGoal, type: g.goalType || null });
    }
    return out;
  }

  /* Looks for a goal with exactly this title (spaces ignored). Returns {id, active} or null. */
  function findGoalByTitle(state, title, makeId) {
    const norm = t => String(t || '').replace(/\s+/g, '');
    const hit = goalList(state, makeId).find(g => norm(g.title) === norm(title));
    return hit ? { id: hit.id, active: hit.active } : null;
  }

  /* ---------- exam schedules of all goals ---------- */

  /* The saved exam schedule of every goal (the active one and the parked ones). */
  function certSchedulesOf(state) {
    const s = state || {};
    const out = [];
    if (isPlain(s.certSchedule)) out.push({ goalTitle: s.mainGoal || '', schedule: s.certSchedule });
    for (const g of Array.isArray(s.otherGoals) ? s.otherGoals : []) {
      if (g && isPlain(g.certSchedule)) out.push({ goalTitle: g.mainGoal, schedule: g.certSchedule });
    }
    return out;
  }

  /* The closest exam date (a period that is still running counts) over all goals.
     Returns {name, date, end, goalTitle} or null. With more than one schedule the name starts with the exam name. */
  function nextExam(state, today) {
    const sets = certSchedulesOf(state);
    const found = [];
    for (const { goalTitle, schedule } of sets) {
      for (const it of scheduleItems(schedule)) {
        const end = it.endDate || it.startDate;
        if (!validDate(it.startDate) || !validDate(end) || end < today) continue;
        const parts = [it.round, it.label].filter(Boolean).join(' · ');
        found.push({ name: sets.length > 1 && it.qualificationName ? it.qualificationName + ' · ' + parts : parts, date: it.startDate, end, goalTitle, started: it.startDate < today && end > it.startDate });
      }
    }
    found.sort((a, b) => a.end.localeCompare(b.end) || a.date.localeCompare(b.date));
    return found[0] || null;
  }

  /* ---------- things coming up soon (banner on the home screen) ---------- */
  const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  const ALERT_ORDER = { job: 0, interview: 1, step: 1, cert: 2, planner: 3 };

  /* Deadlines, interviews, exam dates and high-priority entries from today up to `days` days ahead, soonest first.
     Each: {kind, title, label, date, left (days from today), go (screen to open)}. */
  function upcomingAlerts(state, today, days) {
    const s = state || {};
    if (!validDate(today)) return [];
    const limit = dateOffset(today, days);
    const inWindow = d => validDate(d) && d >= today && d <= limit;
    const out = [];
    const add = (kind, title, label, date, go, extra) => out.push(Object.assign({ kind, title, label, date, left: dayDiff(today, date), go }, extra));
    for (const p of Array.isArray(s.jobPostings) ? s.jobPostings : []) {
      if (!p || typeof p !== 'object') continue;
      const name = [p.company, p.title].filter(Boolean).join(' · ');
      if (['관심', '준비 중'].includes(p.stage) && inWindow(p.deadline)) add('job', name, '마감' + (validTime(p.deadlineTime) ? ' ' + p.deadlineTime : ''), p.deadline, 'jobHub', { guess: p.deadlineGuess === true });
      if (p.interviewDate && !['합격', '불합격', '지원 취소'].includes(p.stage) && inWindow(p.interviewDate)) add('interview', name, '면접' + (/^([01]\d|2[0-3]):[0-5]\d$/.test(p.interviewTime || '') ? ' ' + p.interviewTime : ''), p.interviewDate, 'jobHub');
      for (const e of postingEventsOf(p)) if (inWindow(e.date)) add('step', name, e.label + (e.time ? ' ' + e.time : ''), e.date, 'jobHub');
    }
    for (const { schedule } of certSchedulesOf(s)) {
      for (const it of scheduleItems(schedule)) {
        const name = [it.qualificationName, it.label].filter(Boolean).join(' ');
        const end = it.endDate || it.startDate;
        if (/접수/.test(it.type || it.label || '')) {
          if (inWindow(end)) add('cert', name, '마감', end, 'cert');
          if (it.startDate !== end && inWindow(it.startDate)) add('cert', name, '시작', it.startDate, 'cert');
        } else if (inWindow(it.startDate)) {
          add('cert', name, /발표/.test(it.label || '') ? '발표' : '', it.startDate, 'cert');
        }
      }
    }
    for (const e of Array.isArray(s.plannerEntries) ? s.plannerEntries : []) {
      if (!e || e.priority !== 'high') continue;
      for (let i = 0; i <= days; i++) {
        const d = dateOffset(today, i);
        if (occurs(e, d) && !isDone(e, d)) { add('planner', e.title, '', d, 'calendar'); break; }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || ALERT_ORDER[a.kind] - ALERT_ORDER[b.kind]);
  }

  /* ---------- schedule search ---------- */

  /* Finds planner entries, saved postings and exam dates whose text contains `query` (spaces and case ignored).
     Each: {kind, id, title, date, sub}. Upcoming first (soonest first), then past ones (newest first). At most 30. */
  function searchSchedule(state, query, today) {
    const norm = t => String(t == null ? '' : t).replace(/\s+/g, '').toLowerCase();
    const q = norm(query);
    if (!q || !validDate(today)) return [];
    const s = state || {};
    const out = [];
    for (const e of Array.isArray(s.plannerEntries) ? s.plannerEntries : []) {
      if (!e || !norm([e.title, e.note].join(' ')).includes(q) || !validDate(e.date)) continue;
      let date = e.date;
      if (isRepeating(e)) {
        for (let i = 0; i <= 400; i++) { const d = dateOffset(today, i); if (occurs(e, d)) { date = d; break; } }
      }
      const rep = { daily: '매일 반복', weekly: '매주 반복', monthly: '매월 반복' }[e.repeat];
      out.push({ kind: 'entry', id: e.id, title: e.title, date, sub: [e.time, rep].filter(Boolean).join(' · ') });
    }
    for (const p of Array.isArray(s.jobPostings) ? s.jobPostings : []) {
      if (!p || !norm([p.company, p.title].join(' ')).includes(q)) continue;
      out.push({ kind: 'job', id: p.id, title: [p.company, p.title].filter(Boolean).join(' · '), date: validDate(p.deadline) ? p.deadline : '', sub: validDate(p.deadline) ? '공고 마감' : '공고 (마감일 미정)' });
    }
    for (const { schedule } of certSchedulesOf(s)) {
      for (const it of scheduleItems(schedule)) {
        const title = [it.qualificationName, it.label].filter(Boolean).join(' ');
        if (!norm(title).includes(q) || !validDate(it.startDate)) continue;
        out.push({ kind: 'cert', id: '', title, date: it.startDate, sub: '시험 일정' });
      }
    }
    const upcoming = out.filter(r => r.date && r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const rest = out.filter(r => !r.date || r.date < today).sort((a, b) => b.date.localeCompare(a.date));
    return upcoming.concat(rest).slice(0, 30);
  }

  /* ---------- editable to-do steps of a goal ----------
     state.taskNames holds the user's own step names; an empty list means "use the default steps of the goal type".
     state.completedTasks always has one flag per step. */
  const MAX_TASKS = 20;
  const taskText = name => String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 100);

  function goalTaskNames(state, defaults) {
    const own = Array.isArray(state && state.taskNames) ? state.taskNames.filter(n => isText(n, 100) && n.trim()) : [];
    return own.length ? own : defaults.slice();
  }
  function fitTaskFlags(state, count) {
    const old = Array.isArray(state.completedTasks) ? state.completedTasks : [];
    state.completedTasks = Array.from({ length: count }, (_, i) => old[i] === true);
  }
  function startEditingTasks(state, defaults) {
    state.taskNames = goalTaskNames(state, defaults);
    fitTaskFlags(state, state.taskNames.length);
  }
  function addGoalTask(state, defaults, name) {
    const text = taskText(name);
    if (!text) return { ok: false, reason: 'empty' };
    startEditingTasks(state, defaults);
    if (state.taskNames.length >= MAX_TASKS) return { ok: false, reason: 'full' };
    state.taskNames.push(text);
    fitTaskFlags(state, state.taskNames.length);
    return { ok: true };
  }
  function renameGoalTask(state, defaults, index, name) {
    const text = taskText(name);
    startEditingTasks(state, defaults);
    if (!Number.isInteger(index) || index < 0 || index >= state.taskNames.length) return { ok: false, reason: 'missing' };
    if (!text) return { ok: false, reason: 'empty' };
    state.taskNames[index] = text;
    return { ok: true };
  }
  function removeGoalTask(state, defaults, index) {
    startEditingTasks(state, defaults);
    if (!Number.isInteger(index) || index < 0 || index >= state.taskNames.length) return { ok: false, reason: 'missing' };
    if (state.taskNames.length <= 1) return { ok: false, reason: 'last' };
    state.taskNames.splice(index, 1);
    state.completedTasks.splice(index, 1);
    fitTaskFlags(state, state.taskNames.length);
    return { ok: true };
  }
  function resetGoalTasks(state, defaults) {
    state.taskNames = [];
    fitTaskFlags(state, defaults.length);
  }

  /* A swipe on a touch screen. dx/dy = how far the finger moved (px), ms = how long it took.
     Returns 'next' (finger moved left), 'prev' (finger moved right) or null when it was not a clear sideways swipe
     (too short, too slow, or mostly vertical, i.e. the user was scrolling). */
  function swipeDirection(dx, dy, ms) {
    if (![dx, dy, ms].every(Number.isFinite)) return null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || ms > 700) return null;
    return dx < 0 ? 'next' : 'prev';
  }
  /* The tab after/before `current`, or null at the ends of the list. */
  function stepTab(tabs, current, direction) {
    const i = tabs.indexOf(current);
    if (i < 0 || (direction !== 'next' && direction !== 'prev')) return null;
    const j = direction === 'next' ? i + 1 : i - 1;
    return j >= 0 && j < tabs.length ? tabs[j] : null;
  }

  function goalProgress(state) {
    const s = state || {};
    const flags = s.goalType === 'job'
      ? (Array.isArray(s.jobPostings) ? s.jobPostings : []).flatMap(p => (p && Array.isArray(p.tasks) ? p.tasks : []))
      : (Array.isArray(s.completedTasks) ? s.completedTasks : []);
    const done = flags.filter(Boolean).length;
    return { done, total: flags.length, percent: flags.length ? Math.round(done / flags.length * 100) : 0 };
  }

  const api = {
    GOAL_FIELDS, MAX_GOALS, goalCount, canAddGoal, snapshotGoal, applyGoal, parkActiveGoal, restoreParkedGoal,
    switchGoal, removeGoal, goalList, findGoalByTitle, swipeDirection, stepTab,
    certSchedulesOf, nextExam, upcomingAlerts, searchSchedule,
    MAX_TASKS, goalTaskNames, addGoalTask, renameGoalTask, removeGoalTask, resetGoalTasks,
    goalProgress,
    firstUrl, cleanPostingUrl, parseShareParams, cleanTitle, extractDeadline, deadlineInRange, validTime, cleanPostingEvents, postingEventsOf, MAX_POSTING_EVENTS, POSTING_NOTES_MAX,
    FOCUS_MINUTES, FOCUS_MAX_MINUTES, isFocusMinutes, FOCUS_CATEGORIES, focusCategoryName, FOCUS_HISTORY_LIMIT,
    validDate, koreaDate, dateOffset, daysInMonth, weekStart, periodDates, scheduleItems,
    occurs, occurrencesByDate, isRepeating, isDone, toggleDone, skipOccurrence, habitStreak, isHabitRestDay,
    STATE_SCHEMA_VERSION, migrateState, sanitizeState, validateBackupState,
    BACKUP_FORMAT, BACKUP_VERSION, readBackup,
    focusMinutes, resumeFocus, backupNudge, hasUserData, recordCount
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LifeLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
