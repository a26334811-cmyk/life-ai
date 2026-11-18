const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');
const { createApp } = require('./helpers/app-harness.js');

/* ---------- logic: several goals ---------- */
const counter = () => { let n = 0; return () => 'g' + (++n); };
const cert = { mainGoal: '위험물산업기사 준비', goalType: 'cert', parsedGoal: { subject: '위험물산업기사' }, completedTasks: [true, false, false, false, false],
  certSchedule: { qualification: { name: '위험물산업기사' }, rounds: [{ round: '1회', events: [] }] } };

test('parking the active goal keeps all its fields and empties the slot', () => {
  const s = { ...cert, goalType: 'cert', selectedCompany: '기아' };
  const mk = counter();
  assert.equal(L.parkActiveGoal(s, mk), true);
  assert.equal(s.mainGoal, '');
  assert.equal(s.goalType, null);
  assert.equal(s.certSchedule, null);
  assert.deepEqual(s.completedTasks, [false, false, false, false, false]);
  assert.equal(s.selectedCompany, '');
  assert.equal(s.otherGoals.length, 1);
  const parked = s.otherGoals[0];
  assert.equal(parked.mainGoal, '위험물산업기사 준비');
  assert.deepEqual(parked.completedTasks, [true, false, false, false, false]);
  assert.equal(parked.certSchedule.rounds[0].round, '1회');
  assert.equal(parked.selectedCompany, '기아');
  assert.equal(parked.id, 'g1');
});

test('there is nothing to park when no goal exists, and no more than 5 goals', () => {
  assert.equal(L.parkActiveGoal({ mainGoal: '' }, counter()), false);
  const s = { mainGoal: '넷째', otherGoals: [1, 2, 3, 4].map(i => ({ id: 'o' + i, mainGoal: '목표' + i })) };
  assert.equal(L.goalCount(s), 5);
  assert.equal(L.canAddGoal(s), false);
  assert.equal(L.parkActiveGoal(s, counter()), false, 'at the limit the active goal stays');
  assert.equal(s.mainGoal, '넷째');
});

test('switching swaps the goals and each keeps its own progress', () => {
  const s = { ...cert, otherGoals: [] };
  const mk = counter();
  L.parkActiveGoal(s, mk);
  s.mainGoal = '전기기사 준비'; s.goalType = 'cert'; s.completedTasks = [true, true, false, false, false]; s.goalId = mk();
  const parkedId = s.otherGoals[0].id;
  assert.equal(L.switchGoal(s, mk, parkedId), true);
  assert.equal(s.mainGoal, '위험물산업기사 준비');
  assert.deepEqual(s.completedTasks, [true, false, false, false, false]);
  assert.equal(s.otherGoals.length, 1);
  assert.equal(s.otherGoals[0].mainGoal, '전기기사 준비');
  assert.deepEqual(s.otherGoals[0].completedTasks, [true, true, false, false, false]);
  assert.equal(L.switchGoal(s, mk, 'nope'), false);
});

test('an unfinished new goal is dropped: the put-aside goal comes back', () => {
  const s = { ...cert };
  L.parkActiveGoal(s, counter());
  assert.equal(L.restoreParkedGoal(s), true);
  assert.equal(s.mainGoal, '위험물산업기사 준비');
  assert.deepEqual(s.otherGoals, []);
  assert.equal(L.restoreParkedGoal(s), false, 'nothing to bring back when a goal is active');
});

test('deleting goals: the last one stays; deleting the active one activates the next', () => {
  const mk = counter();
  const s = { ...cert };
  assert.deepEqual(L.removeGoal(s, mk, 'x'), { ok: false, reason: 'last' });
  L.parkActiveGoal(s, mk);
  s.mainGoal = '전기기사 준비'; s.goalType = 'cert'; s.goalId = mk();
  const activeId = s.goalId, parkedId = s.otherGoals[0].id;
  assert.deepEqual(L.removeGoal(s, mk, 'zzz'), { ok: false, reason: 'missing' });
  assert.deepEqual(L.removeGoal(s, mk, activeId), { ok: true });
  assert.equal(s.mainGoal, '위험물산업기사 준비');
  assert.equal(s.goalId, parkedId);
  assert.equal(L.goalCount(s), 1);
});

test('goal list shows the active goal first; finding a goal by title ignores spaces', () => {
  const mk = counter();
  const s = { ...cert };
  L.parkActiveGoal(s, mk);
  s.mainGoal = '전기기사 준비'; s.goalType = 'cert'; s.goalId = mk();
  const list = L.goalList(s, mk);
  assert.deepEqual(list.map(g => [g.title, g.active]), [['전기기사 준비', true], ['위험물산업기사 준비', false]]);
  assert.equal(L.findGoalByTitle(s, '위험물산업기사준비', mk).active, false);
  assert.equal(L.findGoalByTitle(s, '전기기사 준비', mk).active, true);
  assert.equal(L.findGoalByTitle(s, '없는 목표', mk), null);
});

test('saved parked goals are cleaned: bad entries dropped, bad fields replaced, at most 4 kept', () => {
  const good = { id: 'ok1', mainGoal: '전기기사 준비', goalType: 'cert', completedTasks: [true, false, false, false, false] };
  const raw = { mainGoal: 'a', otherGoals: [good,
    { id: "x');alert(1);('", mainGoal: '나쁜 아이디' },
    { id: 'no-title', mainGoal: '' },
    { id: 'wrong-types', mainGoal: '타입이 틀림', completedTasks: 'x', parsedGoal: 7, certSchedule: 'bad', career: 5 },
    'text'] };
  const { state, dropped } = L.sanitizeState(raw);
  assert.ok(dropped.includes('otherGoals'));
  assert.deepEqual(state.otherGoals.map(g => g.id), ['ok1', 'wrong-types']);
  const fixed = state.otherGoals[1];
  assert.deepEqual(fixed.completedTasks, [false, false, false, false, false]);
  assert.deepEqual(fixed.parsedGoal, {});
  assert.equal(fixed.certSchedule, null);
  assert.equal(fixed.career, '');
  const many = L.sanitizeState({ mainGoal: 'a', otherGoals: [1, 2, 3, 4, 5, 6].map(i => ({ id: 'p' + i, mainGoal: '목표' + i })) });
  assert.equal(many.state.otherGoals.length, 4);
  const base = { nickname: 'a', mainGoal: 'b', activity: [], completedTasks: [false, false, false, false, false] };
  assert.equal(L.validateBackupState({ ...base, otherGoals: [good] }), true);
  assert.equal(L.validateBackupState({ ...base, otherGoals: [{ id: 'bad id', mainGoal: 'x' }] }), false, 'a backup with a broken goal is refused');
});

/* ---------- screens ---------- */
// values created inside the app's sandbox have another Array prototype, so compare them through JSON
const tasksOf = a => JSON.parse(a.run('JSON.stringify(state.completedTasks)'));
const certState = { nickname: '지훈', mainGoal: '위험물산업기사 준비', goalType: 'cert', parsedGoal: { subject: '위험물산업기사' },
  completedTasks: [true, true, false, false, false] };

test('adding a goal keeps the old goal with its progress and the new one becomes active', () => {
  const a = createApp(JSON.stringify(certState));
  a.run('addGoal()');
  assert.equal(a.run('currentScreen'), 'goalChoice');
  assert.equal(a.saved().otherGoals.length, 1, 'the old goal is saved right away');
  assert.equal(a.run('state.mainGoal'), '');
  a.el('customGoalInput').value = '전기기사 취득';
  a.run('createCustomGoal()');
  assert.equal(a.run('state.mainGoal'), '전기기사 취득');
  assert.deepEqual(tasksOf(a), [false, false, false, false, false]);
  const saved = a.saved();
  assert.equal(saved.otherGoals.length, 1);
  assert.equal(saved.otherGoals[0].mainGoal, '위험물산업기사 준비');
  assert.deepEqual(saved.otherGoals[0].completedTasks, [true, true, false, false, false]);
});

test('company and job chosen while adding a job goal do not change the goal that was already there', () => {
  const a = createApp(JSON.stringify({ ...certState, selectedCompany: '', goalType: 'cert' }));
  a.run('addGoal()');
  a.run("selectCompany('기아')");
  a.run("selectJob('설비')");
  a.run('createGoal()');
  assert.equal(a.run('state.mainGoal'), '기아 설비 취업');
  assert.equal(a.run('state.goalType'), 'job');
  const old = a.saved().otherGoals[0];
  assert.equal(old.mainGoal, '위험물산업기사 준비');
  assert.equal(old.goalType, 'cert', 'the cert goal is still a cert goal');
  assert.equal(old.selectedCompany, '');
});

test('leaving the new-goal screens without finishing brings the old goal back', () => {
  const a = createApp(JSON.stringify(certState));
  a.run('addGoal()');
  a.run("go('home')");
  assert.equal(a.run('state.mainGoal'), '위험물산업기사 준비');
  assert.deepEqual(tasksOf(a), [true, true, false, false, false]);
  assert.deepEqual(a.saved().otherGoals, []);
  const b = createApp(JSON.stringify(certState));
  b.run('addGoal()');
  b.run('goalChoiceBack()');
  assert.equal(b.run('state.mainGoal'), '위험물산업기사 준비');
  assert.equal(b.run('currentScreen'), 'goals');
});

test('a goal left empty by a closed app is restored on the next start', () => {
  const parked = { id: 'g9', mainGoal: '위험물산업기사 준비', goalType: 'cert', completedTasks: [true, false, false, false, false] };
  const a = createApp(JSON.stringify({ nickname: '지훈', mainGoal: '', otherGoals: [parked] }));
  assert.equal(a.run('state.mainGoal'), '위험물산업기사 준비');
  assert.equal(a.run('state.otherGoals.length'), 0);
});

test('the goals screen lists every goal, marks the active one and offers switch and delete', () => {
  const a = createApp(JSON.stringify({ ...certState, otherGoals: [{ id: 'g2', mainGoal: '기아 설비 취업', goalType: 'job' }] }));
  a.run("go('goals')");
  const html = a.el('goalsContent').innerHTML;
  assert.match(html, /위험물산업기사 준비/);
  assert.match(html, /기아 설비 취업/);
  assert.match(html, /지금 집중 중/);
  assert.match(html, /data-id="g2" onclick="switchToGoal\(this\.dataset\.id\)"/);
  assert.match(html, /data-id="g2" onclick="removeGoalById\(this\.dataset\.id\)"/);
  assert.match(html, /＋ 목표 추가하기/);
});

test('with one goal there is no delete button', () => {
  const a = createApp(JSON.stringify(certState));
  a.run("go('goals')");
  assert.doesNotMatch(a.el('goalsContent').innerHTML, /removeGoalById/);
});

test('switching goals swaps what the home screen shows', () => {
  const a = createApp(JSON.stringify({ ...certState, otherGoals: [{ id: 'g2', mainGoal: '전기기사 준비', goalType: 'cert', completedTasks: [true, true, true, true, false] }] }));
  a.run("go('home')");
  assert.match(a.el('homeContent').innerHTML, /목표 진행 40%/);
  assert.match(a.el('homeContent').innerHTML, /다른 목표 1개/);
  a.run("switchToGoal('g2')");
  a.run("go('home')");
  assert.match(a.el('homeContent').innerHTML, /목표 진행 80%/);
  assert.equal(a.saved().otherGoals[0].mainGoal, '위험물산업기사 준비');
});

test('deleting a goal asks first; cancelling keeps it; the last goal cannot be deleted', async () => {
  const withTwo = JSON.stringify({ ...certState, otherGoals: [{ id: 'g2', mainGoal: '전기기사 준비', goalType: 'cert' }] });
  const no = createApp(withTwo, { confirm: false });
  await no.run("removeGoalById('g2')");
  assert.equal(no.run('state.otherGoals.length'), 1);
  const yes = createApp(withTwo);
  await yes.run("removeGoalById('g2')");
  assert.equal(yes.saved().otherGoals.length, 0);
  assert.match(yes.dialogs.at(-1).message, /전기기사 준비/);
  await yes.run("removeGoalById('" + yes.run('state.goalId') + "')");
  assert.equal(yes.run('state.mainGoal'), '위험물산업기사 준비', 'the last goal is still there');
  assert.match(yes.toasts.at(-1), /마지막 목표/);
});

test('starting a certificate goal adds a goal; the same certificate switches to the existing goal; the limit is 5', () => {
  const certApp = saved => {
    const a = createApp(saved);
    a.el('certSearchInput').value = '전기기사';
    return a;
  };
  const a = certApp(JSON.stringify(certState));
  a.run('startCertGoal()');
  assert.equal(a.run('state.mainGoal'), '전기기사 준비');
  assert.equal(a.saved().otherGoals[0].mainGoal, '위험물산업기사 준비', 'the goal in use stays as one of the goals');
  a.el('certSearchInput').value = '위험물산업기사';
  a.run('startCertGoal()');
  assert.equal(a.run('state.mainGoal'), '위험물산업기사 준비');
  assert.deepEqual(tasksOf(a), [true, true, false, false, false], 'switching keeps the progress');
  assert.equal(a.run('state.otherGoals.length'), 1, 'no copy was made');
  const full = certApp(JSON.stringify({ ...certState, otherGoals: [1, 2, 3, 4].map(i => ({ id: 'f' + i, mainGoal: '다른 ' + i })) }));
  full.run('startCertGoal()');
  assert.equal(full.run('state.mainGoal'), '위험물산업기사 준비');
  assert.match(full.toasts.at(-1), /최대 5개/);
});

test('adding a sixth goal is refused with an explanation', () => {
  const a = createApp(JSON.stringify({ ...certState, otherGoals: [1, 2, 3, 4].map(i => ({ id: 'f' + i, mainGoal: '다른 ' + i })) }));
  a.run('addGoal()');
  assert.match(a.toasts.at(-1), /최대 5개/);
  assert.equal(a.run('state.mainGoal'), '위험물산업기사 준비');
});

test('interested companies appear on the goals screen with their official page link', () => {
  const a = createApp(JSON.stringify({ ...certState, watchCompanies: [
    { id: 'c1', name: '기아', url: 'https://career.kia.com/apply/applyView.kc' },
    { id: 'c2', name: '삼천리', url: '' }] }));
  a.run("go('goals')");
  const html = a.el('goalsContent').innerHTML;
  assert.match(html, /관심 회사/);
  assert.match(html, /기아/);
  assert.match(html, /href="https:\/\/career\.kia\.com\/apply\/applyView\.kc"/);
  assert.match(html, /삼천리/);
  assert.match(html, /주소는 아직 없어요/);
  a.run("go('home')");
  assert.match(a.el('homeContent').innerHTML, /관심 회사 2곳/);
});

test('goal titles with markup are shown as text', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const a = createApp(JSON.stringify({ ...certState, otherGoals: [{ id: 'g2', mainGoal: evil, goalType: 'job' }] }));
  a.run("go('goals')");
  assert.doesNotMatch(a.el('goalsContent').innerHTML, /<img/);
});

test('the first goal of a new user is made as before (no goal is put aside)', () => {
  const a = createApp();
  a.el('customGoalInput').value = '전기기사 취득';
  a.run('createCustomGoal()');
  assert.equal(a.run('state.mainGoal'), '전기기사 취득');
  assert.equal(a.saved().otherGoals, undefined);
  assert.ok(a.run('state.goalId'));
});
