/* LIFE AI pure logic. No DOM access here so Node tests can exercise it directly.
   Loaded in the browser with <script src="logic.js"> (exposes window.LifeLogic)
   and in Node with require('./logic.js'). */
(function (root) {
  'use strict';

  const FOCUS_MINUTES = [5, 10, 15, 25, 30, 45, 50, 60];
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
    const ok = Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
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

  // Ids of habits and planner entries are used inside page markup, so only plain id characters are allowed.
  const validId = value => typeof value === 'string' && /^[\w-]{1,40}$/.test(value);

  const itemChecks = {
    activity: item => isText(item, 300),
    // only the name is checked here; broken check dates are removed one by one in sanitizeState
    habits: item => isPlain(item) && validId(item.id) && isText(item.name, 200) && Array.isArray(item.checks),
    plannerEntries: item => isPlain(item) && validId(item.id) && isText(item.title, 300) && validDate(item.date),
    focusHistory: item => isPlain(item) && validDate(item.date) && Number.isFinite(Number(item.minutes)) && Number(item.minutes) >= 0,
    jobPostings: item => isPlain(item) && Array.isArray(item.tasks) && isText(item.id, 200) && isText(item.company, 2000) && isText(item.title, 2000),
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
        let items = value, droppedDate = false;
        if (key === 'habits') {
          // keep a habit's good check dates even when some other date in it is broken
          items = value.map(habit => {
            if (!(check(habit))) return habit;
            const checks = habit.checks.filter(validDate);
            if (checks.length === habit.checks.length) return habit;
            droppedDate = true;
            return Object.assign({}, habit, { checks });
          });
        }
        const kept = check ? items.filter(check) : items;
        if (kept.length !== value.length || droppedDate) dropped.push(key);
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

  const BACKUP_FORMAT = 'life-ai-backup';
  const BACKUP_VERSION = 1;

  /* Reads the text of a backup file and runs every check (JSON, format, version, state shape).
     Returns {ok:true, state} with the upgraded, cleaned state, or {ok:false, message} for the user. */
  function readBackup(text) {
    let backup;
    try { backup = JSON.parse(text); } catch (e) { return { ok: false, message: '백업 파일을 읽지 못했어요. 앱에서 만든 life-ai-backup-날짜.json 파일을 골라 주세요.' }; }
    if (!isPlain(backup) || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION || !isPlain(backup.state)) {
      return { ok: false, message: '올바른 life-ai 백업 파일이 아니에요.' };
    }
    const migrated = migrateState(backup.state);
    if (!validateBackupState(migrated)) return { ok: false, message: '백업 데이터의 구조가 올바르지 않아요.' };
    return { ok: true, state: sanitizeState(migrated).state };
  }

  /* ---------- focus timer ---------- */

  /* Decides what to do with a focus timer that was saved before the page closed.
     status: idle | paused | running | finished */
  function resumeFocus(run, now) {
    if (!isPlain(run)) return { status: 'idle' };
    const minutes = Number(run.minutes);
    if (!FOCUS_MINUTES.includes(minutes)) return { status: 'idle' };
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

  const POSITIVE = [['마감', 3], ['까지', 2], ['접수', 1], ['지원기간', 1], ['모집기간', 1], ['서류', 1]];
  const NEGATIVE = ['공고일', '게시일', '등록일', '작성일', '발표', '면접', '시작', '개시', '입사', '입과', '교육'];

  /* Finds the most likely application deadline in pasted posting text.
     Returns {date:'YYYY-MM-DD', past:boolean, confident:boolean, snippet} or null. Never guesses without a clue word. */
  function extractDeadline(text, today) {
    const src = String(text || '').slice(0, 30000);
    if (!src || !validDate(today)) return null;
    const year = Number(today.slice(0, 4));
    const found = [];
    const add = (index, length, y, m, d, hasYear) => {
      let iso = null;
      const make = (yy) => { const s = yy + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); return validDate(s) ? s : null; };
      if (hasYear) iso = make(y);
      else {
        iso = make(year);
        // "1월 5일까지" read in December means next year
        if (iso && iso < dateOffset(today, -31)) iso = make(year + 1);
        // "12월 28일까지" read in early January means last month, not 11 months from now
        else if (iso && iso > dateOffset(today, 183)) iso = make(year - 1) || iso;
      }
      if (iso && iso >= dateOffset(today, -366 * 2) && iso <= dateOffset(today, 366 * 2)) found.push({ index, length, iso, hasYear });
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
      add(m.index, m[0].length, 0, Number(m[1]), Number(m[2]), false);
    }
    if (!found.length) return null;
    let best = null;
    for (const c of found) {
      const before = src.slice(Math.max(0, c.index - 30), c.index);
      const after = src.slice(c.index + c.length, c.index + c.length + 16);
      let score = 0;
      for (const [word, points] of POSITIVE) { if (before.includes(word) || after.includes(word)) score += points; }
      for (const word of NEGATIVE) { if (before.slice(-10).includes(word)) score -= 3; }
      // end of a range: "11.10 ~ 11.30" (parenthesised weekdays are ignored)
      const compact = before.replace(/\([^)]*\)/g, '').replace(/\s+/g, '');
      if (/[~∼～]$/.test(compact)) score += 3;
      if (!c.hasYear && score < 3) score -= 1; // short forms need a stronger clue
      if (!best || score > best.score || (score === best.score && c.iso > best.iso)) best = { ...c, score };
    }
    if (!best || best.score < 2) return null;
    return {
      date: best.iso,
      past: best.iso < today,
      confident: best.score >= 4,
      snippet: src.slice(Math.max(0, best.index - 12), best.index + best.length + 8).replace(/\s+/g, ' ').trim()
    };
  }

  /* Goal progress shown on Home. A job goal has no 5-step list, so it counts the prepare checks of every saved posting. */
  function goalProgress(state) {
    const s = state || {};
    const flags = s.goalType === 'job'
      ? (Array.isArray(s.jobPostings) ? s.jobPostings : []).flatMap(p => (p && Array.isArray(p.tasks) ? p.tasks : []))
      : (Array.isArray(s.completedTasks) ? s.completedTasks : []);
    const done = flags.filter(Boolean).length;
    return { done, total: flags.length, percent: flags.length ? Math.round(done / flags.length * 100) : 0 };
  }

  const api = {
    goalProgress,
    firstUrl, parseShareParams, cleanTitle, extractDeadline,
    FOCUS_MINUTES, FOCUS_CATEGORIES, focusCategoryName, FOCUS_HISTORY_LIMIT,
    validDate, koreaDate, dateOffset, daysInMonth,
    occurs, isRepeating, isDone, toggleDone, habitStreak,
    STATE_SCHEMA_VERSION, migrateState, sanitizeState, validateBackupState,
    BACKUP_FORMAT, BACKUP_VERSION, readBackup,
    resumeFocus, backupNudge, hasUserData, recordCount
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LifeLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
