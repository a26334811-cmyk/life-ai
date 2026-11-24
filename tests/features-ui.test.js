const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./helpers/app-harness.js');

// fake clock of the harness: 2026-05-10 (Korea time)
const sched = (name, events, round = '1회') => ({ qualification: { name, code: '1' }, rounds: [{ round, events }] });
const ev = (label, startDate, endDate = startDate) => ({ type: label, label, startDate, endDate, raw: startDate });
const certGoal = { nickname: '지훈', mainGoal: '전기기사 준비', goalType: 'cert', completedTasks: [true, false, false, false, false] };

/* ---------- 2. banner of what is coming up ---------- */
test('the home banner lists deadlines, interviews, exam dates and urgent entries, with today and tomorrow marked', () => {
  const a = createApp(JSON.stringify({ ...certGoal,
    certSchedule: sched('전기기사', [ev('필기원서접수', '2026-05-09', '2026-05-11'), ev('필기시험', '2026-05-30')]),
    jobPostings: [{ id: 'j', company: '삼천리', title: '시설관리', stage: '관심', deadline: '2026-05-10', url: 'https://e.com', tasks: [false, false, false, false] },
      { id: 'k', company: '면접사', title: '기획', stage: '면접', deadline: '', interviewDate: '2026-05-12', url: 'https://e.com', tasks: [false, false, false, false] }],
    plannerEntries: [{ id: 'p', title: '치과', date: '2026-05-11', repeat: 'none', priority: 'high' }] }));
  a.run("go('home')");
  const html = a.el('homeContent').innerHTML;
  assert.match(html, /곧 다가오는 일정 4건/);
  assert.match(html, /alert-when">오늘</);
  assert.match(html, /alert-when">내일</);
  assert.match(html, /alert-when">2일 뒤</);
  assert.match(html, /삼천리 · 시설관리/);
  assert.match(html, /전기기사 필기원서접수/);
  assert.match(html, /면접사 · 기획/);
  assert.match(html, /치과/);
  assert.doesNotMatch(html, /필기시험/, 'the exam on the 30th is outside the 3 days');
  assert.match(html, /오늘·내일 챙길 일정이 3건/);
  assert.ok(html.indexOf('urgent-postings') < html.indexOf('soft-overview'), 'the banner comes first');
});

test('the banner is absent when nothing is coming up', () => {
  const a = createApp(JSON.stringify(certGoal));
  a.run("go('home')");
  assert.doesNotMatch(a.el('homeContent').innerHTML, /곧 다가오는 일정/);
});

/* ---------- 6. check today's things on the home screen ---------- */
test('home shows today\'s entries and habits and they can be checked there', () => {
  const a = createApp(JSON.stringify({ ...certGoal,
    plannerEntries: [{ id: 'p1', title: '치과', date: '2026-05-10', time: '09:30', repeat: 'none' }, { id: 'p2', title: '내일 일', date: '2026-05-11', repeat: 'none' }],
    habits: [{ id: 'h1', name: '운동', createdAt: '2026-05-01', checks: [] }] }));
  a.run("go('home')");
  let html = a.el('homeContent').innerHTML;
  assert.match(html, /오늘 할 일 <span class="meta">0\/2</);
  assert.match(html, /data-id="p1" onchange="homeToggleEntry\(this\.dataset\.id\)"/);
  assert.match(html, /data-id="h1" onchange="homeToggleHabit\(this\.dataset\.id\)"/);
  assert.doesNotMatch(html, /내일 일/);
  a.run("homeToggleEntry('p1')");
  a.run("homeToggleHabit('h1')");
  assert.equal(a.run("state.plannerEntries[0].done"), true);
  assert.equal(a.run("state.habits[0].checks.includes(koreaToday())"), true);
  html = a.el('homeContent').innerHTML;
  assert.match(html, /오늘 할 일 <span class="meta">2\/2</);
  assert.match(html, /done-text/);
  assert.equal(a.saved().habits[0].checks.length, 1, 'saved');
  a.run("homeToggleHabit('h1')");
  assert.equal(a.run("state.habits[0].checks.length"), 0, 'unchecking works too');
});

test('home with nothing planned for today offers to add an entry', () => {
  const a = createApp(JSON.stringify(certGoal));
  a.run("go('home')");
  assert.match(a.el('homeContent').innerHTML, /오늘 등록한 일정과 습관이 아직 없어요/);
});

test('a repeating entry is checked for today only', () => {
  const a = createApp(JSON.stringify({ ...certGoal, plannerEntries: [{ id: 'r', title: '운동', date: '2026-05-01', repeat: 'daily' }] }));
  a.run("go('home')");
  a.run("homeToggleEntry('r')");
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(state.plannerEntries[0].doneDates)')), ['2026-05-10']);
  assert.equal(a.run("plannerForDate('2026-05-11')[0].done"), false);
});

test('titles and names with markup are shown as text on the home screen', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const a = createApp(JSON.stringify({ ...certGoal, plannerEntries: [{ id: 'p', title: evil, date: '2026-05-10', repeat: 'none', priority: 'high' }], habits: [{ id: 'h', name: evil, checks: [] }] }));
  a.run("go('home')");
  assert.doesNotMatch(a.el('homeContent').innerHTML, /<img/);
});

/* ---------- 7. several goals on the home screen ---------- */
test('the home shows the closest exam over all goals and the progress of each goal', () => {
  const a = createApp(JSON.stringify({ ...certGoal, certSchedule: sched('전기기사', [ev('필기시험', '2026-09-01')]),
    otherGoals: [{ id: 'g2', mainGoal: '위험물산업기사 준비', goalType: 'cert', completedTasks: [true, true, true, false, false], certSchedule: sched('위험물산업기사', [ev('필기시험', '2026-06-01')]) }] }));
  a.run("go('home')");
  const html = a.el('homeContent').innerHTML;
  assert.match(html, /위험물산업기사 · 1회 · 필기시험/, 'the other goal has the closer exam');
  assert.match(html, /목표별 진행/);
  assert.match(html, /전기기사 준비<\/strong> \(지금 집중 중\) · 1\/5단계 · 20%/);
  assert.match(html, /위험물산업기사 준비<\/strong> · 3\/5단계 · 60%/);
});

test('the calendar and the search also know the exam dates of other goals', () => {
  const a = createApp(JSON.stringify({ ...certGoal, otherGoals: [{ id: 'g2', mainGoal: '위험물 준비', goalType: 'cert', certSchedule: sched('위험물산업기사', [ev('필기시험', '2026-05-20')]) }] }));
  assert.match(a.run("plannerForDate('2026-05-20').map(e=>e.title).join()"), /위험물산업기사 필기시험/);
});

/* ---------- 3. exam date -> my schedule ---------- */
const withCert = () => createApp(JSON.stringify({ ...certGoal, certSchedule: sched('전기기사', [ev('필기원서접수', '2026-05-12', '2026-05-18'), ev('필기시험', '2026-06-01')]) }));

test('an exam date has an add-to-my-schedule button; registration periods are added on their last day', () => {
  const a = withCert();
  a.run("plannerSelected='2026-05-14';renderCalendar()");
  let html = a.el('calendarContent').innerHTML;
  assert.match(html, /data-title="전기기사 필기원서접수 마감" data-date="2026-05-18" onclick="plannerAddFromCert\(this\.dataset\.title,this\.dataset\.date\)"/);
  a.run("plannerSelected='2026-06-01';renderCalendar()");
  html = a.el('calendarContent').innerHTML;
  assert.match(html, /data-title="전기기사 필기시험" data-date="2026-06-01"/);
});

test('adding an exam date creates a normal high-priority entry once; the button then says it is there', () => {
  const a = withCert();
  a.run("plannerAddFromCert('전기기사 필기시험','2026-06-01')");
  const entries = a.saved().plannerEntries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, '전기기사 필기시험');
  assert.equal(entries[0].date, '2026-06-01');
  assert.equal(entries[0].priority, 'high');
  assert.equal(entries[0].repeat, 'none');
  assert.match(a.toasts.at(-1), /내 일정에 추가했어요/);
  a.run("plannerAddFromCert('전기기사 필기시험','2026-06-01')");
  assert.equal(a.saved().plannerEntries.length, 1, 'no duplicate');
  assert.match(a.toasts.at(-1), /이미 내 일정에 있어요/);
  a.run("plannerSelected='2026-06-01';renderCalendar()");
  assert.match(a.el('calendarContent').innerHTML, /✓ 내 일정에 있어요/);
});

test('bad data cannot be added as an entry', () => {
  const a = withCert();
  a.run("plannerAddFromCert('','2026-06-01')");
  a.run("plannerAddFromCert('x','2026-02-30')");
  a.run("plannerAddFromCert('" + 'x'.repeat(121) + "','2026-06-01')");
  assert.equal(a.run('(state.plannerEntries||[]).length'), 0);
});

/* ---------- 5. search ---------- */
const withEntries = () => createApp(JSON.stringify({ ...certGoal,
  plannerEntries: [{ id: 'p1', title: '치과 예약', date: '2026-05-20', time: '09:30', repeat: 'none' }, { id: 'p2', title: '장보기', date: '2026-05-12', repeat: 'none' }],
  jobPostings: [{ id: 'j', company: '삼천리', title: '시설관리', stage: '관심', deadline: '2026-05-30', url: 'https://e.com', tasks: [false, false, false, false] }] }));

test('the calendar tab has a search box and typing shows matching entries', () => {
  const a = withEntries();
  a.run("go('calendar')");
  assert.match(a.el('calendarContent').innerHTML, /id="plannerSearch" type="search"/);
  a.run("plannerSearchRun('치과')");
  const html = a.el('plannerSearchResults').innerHTML;
  assert.match(html, /치과 예약/);
  assert.match(html, /09:30/);
  assert.doesNotMatch(html, /장보기/);
  a.run("plannerSearchRun('없는말')");
  assert.match(a.el('plannerSearchResults').innerHTML, /찾은 일정이 없어요/);
  a.run("plannerSearchRun('')");
  assert.equal(a.el('plannerSearchResults').innerHTML, '');
});

test('opening a result jumps to the day; a posting opens the job screen; the query survives a redraw', () => {
  const a = withEntries();
  a.run("go('calendar')");
  a.run("plannerSearchRun('치과')");
  a.run("plannerSearchOpen('entry','2026-05-20')");
  assert.equal(a.run('plannerSelected'), '2026-05-20');
  assert.equal(a.run('plannerActiveTab'), 'calendar');
  a.run('renderCalendar()');
  assert.match(a.el('calendarContent').innerHTML, /value="치과"/);
  a.run("plannerSearchOpen('job','2026-05-30')");
  assert.equal(a.run('currentScreen'), 'jobHub');
});

test('search text with markup is shown as text', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const a = createApp(JSON.stringify({ ...certGoal, plannerEntries: [{ id: 'p', title: evil, date: '2026-05-20', repeat: 'none' }] }));
  a.run("go('calendar')");
  a.run("plannerSearchRun('img')");
  assert.doesNotMatch(a.el('plannerSearchResults').innerHTML, /<img/);
  a.run('plannerSearchRun(\'"><script>\')');
  assert.doesNotMatch(a.el('plannerSearchResults').innerHTML, /<script>/);
});

/* ---------- 4. editable to-do steps ---------- */
test('the goal screen can be switched to edit mode and shows the default steps as inputs', () => {
  const a = createApp(JSON.stringify(certGoal));
  a.run("go('goalDetail')");
  assert.match(a.el('taskList').innerHTML, /할 일 편집/);
  a.run('taskEditStart()');
  const html = a.el('taskList').innerHTML;
  assert.match(html, /value="응시 일정 확인"/);
  assert.match(html, /id="newTaskName"/);
  assert.match(html, /기본 할 일로 되돌리기/);
});

test('adding, renaming and deleting steps works and is saved with the goal', async () => {
  const a = createApp(JSON.stringify(certGoal));
  a.run("go('goalDetail');taskEditStart()");
  a.el('newTaskName').value = '필기 1회독';
  a.run('taskAdd()');
  assert.equal(a.saved().taskNames.length, 6);
  assert.equal(a.saved().taskNames[5], '필기 1회독');
  assert.equal(a.saved().completedTasks.length, 6);
  a.run("taskRename(0,'일정 먼저 확인')");
  assert.equal(a.saved().taskNames[0], '일정 먼저 확인');
  assert.equal(a.saved().completedTasks[0], true, 'the finished mark stays with the step');
  await a.run('taskRemove(1)');
  assert.equal(a.saved().taskNames.length, 5);
  assert.match(a.dialogs.at(-1).message, /응시조건 확인/);
  a.run('taskEditDone()');
  const html = a.el('taskList').innerHTML;
  assert.match(html, /일정 먼저 확인/);
  assert.match(html, /필기 1회독/);
  const home = a.run("go('home'),LifeLogic.goalProgress(state)");
  assert.equal(home.total, 5);
});

test('an empty name is refused, the last step stays, and cancelling a delete keeps the step', async () => {
  const a = createApp(JSON.stringify({ ...certGoal, taskNames: ['하나'], completedTasks: [false] }));
  a.run("go('goalDetail');taskEditStart()");
  a.el('newTaskName').value = '   ';
  a.run('taskAdd()');
  assert.match(a.toasts.at(-1), /할 일 이름을 적어 주세요/);
  a.run("taskRename(0,'')");
  assert.match(a.toasts.at(-1), /비워 둘 수 없어요/);
  assert.equal(a.run('state.taskNames[0]'), '하나');
  await a.run('taskRemove(0)');
  assert.match(a.toasts.at(-1), /최소 1개/);
  const no = createApp(JSON.stringify(certGoal), { confirm: false });
  no.run("go('goalDetail');taskEditStart()");
  await no.run('taskRemove(0)');
  assert.equal(no.run('(state.taskNames||[]).length'), 0, 'cancelled: still the default steps');
});

test('resetting goes back to the default steps; step names with markup are shown as text', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const a = createApp(JSON.stringify({ ...certGoal, taskNames: [evil, '둘'], completedTasks: [true, false] }));
  a.run("go('goalDetail')");
  assert.doesNotMatch(a.el('taskList').innerHTML, /<img/);
  a.run('taskEditStart()');
  assert.doesNotMatch(a.el('taskList').innerHTML, /<img/);
  await a.run('taskReset()');
  assert.deepEqual(a.saved().taskNames, []);
  assert.equal(a.saved().completedTasks.length, 5);
  assert.match(a.el('taskList').innerHTML, /응시 일정 확인/);
});

test('each goal keeps its own steps when switching, and a new goal starts with the default steps', () => {
  const a = createApp(JSON.stringify({ ...certGoal, taskNames: ['필기 1회독', '필기 2회독'], completedTasks: [true, false] }));
  a.run('addGoal()');
  a.el('customGoalInput').value = '위험물 취득';
  a.run('createCustomGoal()');
  assert.deepEqual(a.saved().taskNames, []);
  assert.equal(a.saved().completedTasks.length, 5);
  const id = a.run('state.otherGoals[0].id');
  a.run(`switchToGoal('${id}')`);
  assert.deepEqual(a.saved().taskNames, ['필기 1회독', '필기 2회독']);
  assert.deepEqual(a.saved().completedTasks, [true, false]);
});

/* ---------- 1. send the backup to another device ---------- */
test('send-to-other-device uses the share sheet with a backup file when the browser can share files', async () => {
  const a = createApp(JSON.stringify(certGoal), { downloads: true });
  const shared = [];
  a.context.File = class { constructor(parts, name, o) { this.parts = parts; this.name = name; this.type = o.type; } };
  a.context.navigator = { canShare: d => Boolean(d.files), share: async d => { shared.push(d); } };
  await a.run('shareLifeAIBackup()');
  assert.equal(shared.length, 1);
  assert.match(shared[0].files[0].name, /^life-ai-backup-2026-05-10-\d{4}\.json$/);
  const payload = JSON.parse(shared[0].files[0].parts[0]);
  assert.equal(payload.format, 'life-ai-backup');
  assert.equal(payload.state.mainGoal, '전기기사 준비');
  assert.equal(a.downloads.length, 0, 'no extra download');
  assert.ok(a.saved().lastBackupAt, 'counts as a backup');
  assert.match(a.toasts.at(-1), /백업 파일을 보냈어요/);
});

test('browsers that cannot share files save the file instead', async () => {
  const a = createApp(JSON.stringify(certGoal), { downloads: true });
  await a.run('shareLifeAIBackup()');
  assert.equal(a.downloads.length, 1);
  assert.match(a.toasts.at(-1), /파일로 저장했어요/);
});

test('closing the share sheet leaves no backup date and shows no error', async () => {
  const a = createApp(JSON.stringify(certGoal), { downloads: true });
  a.context.File = class { constructor(parts, name, o) { this.name = name; } };
  a.context.navigator = { canShare: () => true, share: async () => { const e = new Error('closed'); e.name = 'AbortError'; throw e; } };
  const before = a.toasts.length;
  await a.run('shareLifeAIBackup()');
  assert.equal(a.toasts.length, before);
  assert.equal(a.saved().lastBackupAt, undefined);
});

test('a failing share shows a message and does not claim a backup', async () => {
  const a = createApp(JSON.stringify(certGoal), { downloads: true });
  a.context.File = class { constructor(parts, name) { this.name = name; } };
  a.context.navigator = { canShare: () => true, share: async () => { throw new Error('boom'); } };
  await a.run('shareLifeAIBackup()');
  assert.match(a.toasts.at(-1), /보내지 못했어요/);
  assert.equal(a.saved().lastBackupAt, undefined);
});

test('the MY screen has the send button and explains how to use two devices', () => {
  const a = createApp(JSON.stringify(certGoal));
  a.run("go('my')");
  const html = a.el('myContent').innerHTML;
  assert.match(html, /onclick="shareLifeAIBackup\(\)">📤 다른 기기로 보내기/);
  assert.match(html, /기기를 바꿔 쓰려면/);
});
