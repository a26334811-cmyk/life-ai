const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const TODAY = '2026-05-10';
const sched = (name, events, round = '1회') => ({ qualification: { name, code: '1' }, rounds: [{ round, events }] });
const ev = (label, startDate, endDate = startDate, type = label) => ({ type, label, startDate, endDate, raw: startDate });

/* ---------- exam schedules of all goals ---------- */
test('exam schedules of the active goal and the parked goals are all found', () => {
  const s = { mainGoal: '전기기사 준비', certSchedule: sched('전기기사', []), otherGoals: [
    { id: 'a', mainGoal: '위험물 준비', certSchedule: sched('위험물산업기사', []) }, { id: 'b', mainGoal: '취업', certSchedule: null }] };
  assert.deepEqual(L.certSchedulesOf(s).map(x => x.goalTitle), ['전기기사 준비', '위험물 준비']);
  assert.deepEqual(L.certSchedulesOf({}), []);
});

test('nextExam takes the closest date over all goals and names the exam when there are several schedules', () => {
  const one = { mainGoal: 'x', certSchedule: sched('전기기사', [ev('필기원서접수', '2026-05-05', '2026-05-12'), ev('필기시험', '2026-06-01')]) };
  const a = L.nextExam(one, TODAY);
  assert.equal(a.name, '1회 · 필기원서접수', 'a period that is still running counts; one schedule keeps the short name');
  const two = { ...one, otherGoals: [{ id: 'o', mainGoal: '위험물', certSchedule: sched('위험물산업기사', [ev('필기시험', '2026-05-20')]) }] };
  const b = L.nextExam(two, TODAY);
  assert.equal(b.name, '전기기사 · 1회 · 필기원서접수', 'with several schedules the exam name is added');
  const later = { mainGoal: 'x', certSchedule: sched('전기기사', [ev('필기시험', '2026-09-01')]), otherGoals: [{ id: 'o', mainGoal: '위험물', certSchedule: sched('위험물산업기사', [ev('필기시험', '2026-05-20')]) }] };
  assert.equal(L.nextExam(later, TODAY).name, '위험물산업기사 · 1회 · 필기시험', 'the other goal has the closer date');
  assert.equal(L.nextExam({ mainGoal: 'x', certSchedule: sched('전기기사', [ev('필기시험', '2026-05-01')]) }, TODAY), null, 'past dates are ignored');
  assert.equal(L.nextExam({}, TODAY), null);
});

/* ---------- upcoming alerts ---------- */
test('upcomingAlerts collects deadlines, interviews, exam dates and high-priority entries within the window', () => {
  const s = {
    mainGoal: '전기기사 준비',
    certSchedule: sched('전기기사', [ev('필기원서접수', '2026-05-09', '2026-05-11', '필기원서접수'), ev('필기시험', '2026-05-12', '2026-05-12', '필기시험'), ev('필기합격발표', '2026-05-30', '2026-05-30', '필기합격발표')]),
    jobPostings: [
      { id: 'j1', company: '삼천리', title: '시설관리', stage: '관심', deadline: '2026-05-11', interviewDate: '' },
      { id: 'j2', company: '지원함', title: '정비', stage: '지원 완료', deadline: '2026-05-11' },
      { id: 'j3', company: '면접사', title: '기획', stage: '면접', deadline: '2026-04-01', interviewDate: '2026-05-10' },
      { id: 'j4', company: '먼회사', title: '먼일', stage: '관심', deadline: '2026-06-30' }],
    plannerEntries: [
      { id: 'p1', title: '치과', date: '2026-05-12', repeat: 'none', priority: 'high' },
      { id: 'p2', title: '장보기', date: '2026-05-12', repeat: 'none', priority: 'normal' },
      { id: 'p3', title: '끝난 일', date: '2026-05-11', repeat: 'none', priority: 'high', done: true }]
  };
  const list = L.upcomingAlerts(s, TODAY, 3);
  const rows = list.map(a => `${a.date} ${a.kind} ${a.title} ${a.label}`);
  assert.deepEqual(rows, [
    '2026-05-10 interview 면접사 · 기획 면접',
    '2026-05-11 job 삼천리 · 시설관리 마감',
    '2026-05-11 cert 전기기사 필기원서접수 마감',
    '2026-05-12 cert 전기기사 필기시험 ',
    '2026-05-12 planner 치과 ']);
  assert.equal(list[0].left, 0);
  assert.equal(list[1].left, 1);
  assert.equal(list[1].go, 'jobHub');
  const start = L.upcomingAlerts({ mainGoal: 'x', certSchedule: sched('전기기사', [ev('필기원서접수', '2026-05-11', '2026-05-18')]) }, TODAY, 3);
  assert.deepEqual(start.map(a => a.label), ['시작'], 'a registration period that opens soon is announced');
});

test('upcomingAlerts includes exam dates of parked goals, repeats once per entry, and survives bad data', () => {
  const s = { mainGoal: 'a', otherGoals: [{ id: 'o', mainGoal: 'b', certSchedule: sched('위험물산업기사', [ev('필기시험', '2026-05-11')]) }],
    plannerEntries: [{ id: 'r', title: '스터디', date: '2026-04-01', repeat: 'daily', priority: 'high' }, null, 5] };
  const list = L.upcomingAlerts(s, TODAY, 3);
  assert.equal(list.filter(a => a.title === '스터디').length, 1, 'a repeating entry shows once');
  assert.ok(list.some(a => a.title === '위험물산업기사 필기시험'));
  assert.deepEqual(L.upcomingAlerts({}, TODAY, 3), []);
  assert.deepEqual(L.upcomingAlerts({ jobPostings: 'x', plannerEntries: 4 }, 'bad', 3), []);
});

/* ---------- search ---------- */
test('searchSchedule finds entries, postings and exam dates; upcoming first, past after', () => {
  const s = {
    mainGoal: '전기기사 준비', certSchedule: sched('전기기사', [ev('필기시험', '2026-06-01')]),
    plannerEntries: [
      { id: 'p1', title: '치과 검진', date: '2026-04-01', repeat: 'none' },
      { id: 'p2', title: '치과 예약', date: '2026-05-20', repeat: 'none', time: '09:30' },
      { id: 'p3', title: '치과 스케일링', date: '2026-03-01', repeat: 'monthly' },
      { id: 'p4', title: '장보기', date: '2026-05-12', repeat: 'none' }],
    jobPostings: [{ id: 'j1', company: '삼천리', title: '시설관리', deadline: '2026-05-30' }, { id: 'j2', company: '치과기공', title: '구인', deadline: '' }]
  };
  const r = L.searchSchedule(s, ' 치과 ', TODAY);
  assert.deepEqual(r.map(x => x.title), ['치과 예약', '치과 스케일링', '치과 검진', '치과기공 · 구인'], 'upcoming by date, then past ones, then entries without a date');
  assert.equal(r[1].date, '2026-06-01', 'a monthly entry is shown at its next occurrence');
  assert.equal(r[1].sub, '매월 반복');
  assert.equal(r[0].sub, '09:30');
  assert.equal(L.searchSchedule(s, '필기', TODAY)[0].kind, 'cert');
  assert.equal(L.searchSchedule(s, 'ㅋㅋㅋ', TODAY).length, 0);
  assert.equal(L.searchSchedule(s, '  ', TODAY).length, 0);
  assert.equal(L.searchSchedule(s, '시설관리', TODAY)[0].kind, 'job');
  assert.equal(L.searchSchedule(s, '치과', TODAY).length, 4);
});

test('searchSchedule ignores case and spaces and caps the result list', () => {
  const entries = Array.from({ length: 45 }, (_, i) => ({ id: 'e' + i, title: 'Study ' + i, date: '2026-06-' + String((i % 28) + 1).padStart(2, '0'), repeat: 'none' }));
  assert.equal(L.searchSchedule({ plannerEntries: entries }, 'sTuDy', TODAY).length, 30);
  assert.equal(L.searchSchedule({ plannerEntries: [{ id: 'a', title: '자격증 공부', date: '2026-06-01' }] }, '자격증공부', TODAY).length, 1);
});

/* ---------- editable to-do steps ---------- */
const DEFAULTS = ['응시 일정 확인', '응시조건 확인', '공부 계획 만들기', '원서접수', '시험 응시'];

test('goalTaskNames uses the default steps until the user makes their own', () => {
  assert.deepEqual(L.goalTaskNames({ taskNames: [] }, DEFAULTS), DEFAULTS);
  assert.deepEqual(L.goalTaskNames({}, DEFAULTS), DEFAULTS);
  assert.deepEqual(L.goalTaskNames({ taskNames: ['필기 1회독', ' ', 7] }, DEFAULTS), ['필기 1회독']);
});

test('adding a step starts from the default steps and keeps the finished flags', () => {
  const s = { completedTasks: [true, false, true, false, false], taskNames: [] };
  assert.deepEqual(L.addGoalTask(s, DEFAULTS, '  필기   1회독 '), { ok: true });
  assert.equal(s.taskNames.length, 6);
  assert.equal(s.taskNames[5], '필기 1회독', 'extra spaces are cleaned');
  assert.deepEqual(s.completedTasks, [true, false, true, false, false, false]);
  assert.deepEqual(L.addGoalTask(s, DEFAULTS, '   '), { ok: false, reason: 'empty' });
  assert.equal(s.taskNames.length, 6);
});

test('renaming and deleting steps keep the flags in line; the last step cannot be deleted; at most 20 steps', () => {
  const s = { completedTasks: [true, true, false, false, false], taskNames: [] };
  assert.deepEqual(L.renameGoalTask(s, DEFAULTS, 1, '필기 1회독'), { ok: true });
  assert.equal(s.taskNames[1], '필기 1회독');
  assert.deepEqual(L.renameGoalTask(s, DEFAULTS, 9, 'x'), { ok: false, reason: 'missing' });
  assert.deepEqual(L.renameGoalTask(s, DEFAULTS, 0, ''), { ok: false, reason: 'empty' });
  assert.deepEqual(L.removeGoalTask(s, DEFAULTS, 0), { ok: true });
  assert.deepEqual(s.taskNames, ['필기 1회독', '공부 계획 만들기', '원서접수', '시험 응시']);
  assert.deepEqual(s.completedTasks, [true, false, false, false], 'the flag of the removed step is removed with it');
  const one = { completedTasks: [false], taskNames: ['하나'] };
  assert.deepEqual(L.removeGoalTask(one, DEFAULTS, 0), { ok: false, reason: 'last' });
  const full = { completedTasks: [], taskNames: Array.from({ length: 20 }, (_, i) => '단계' + i) };
  assert.deepEqual(L.addGoalTask(full, DEFAULTS, '하나 더'), { ok: false, reason: 'full' });
});

test('resetting the steps goes back to the default list', () => {
  const s = { completedTasks: [true, false, true], taskNames: ['a', 'b', 'c'] };
  L.resetGoalTasks(s, DEFAULTS);
  assert.deepEqual(s.taskNames, []);
  assert.deepEqual(s.completedTasks, [true, false, true, false, false]);
});

test('own steps are kept per goal when switching goals, and cleaned when loaded', () => {
  const mk = (() => { let n = 0; return () => 'g' + (++n); })();
  const s = { mainGoal: '전기기사 준비', goalType: 'cert', completedTasks: [true, false, false, false, false, false], taskNames: [...DEFAULTS, '필기 1회독'], otherGoals: [] };
  L.parkActiveGoal(s, mk);
  assert.deepEqual(s.taskNames, [], 'the new empty goal has the default steps');
  assert.equal(s.otherGoals[0].taskNames.length, 6);
  const id = s.otherGoals[0].id;
  s.mainGoal = '위험물 준비'; s.goalId = mk();
  L.switchGoal(s, mk, id);
  assert.equal(s.taskNames[5], '필기 1회독');
  assert.equal(s.completedTasks.length, 6);
  const { state } = L.sanitizeState({ mainGoal: 'a', taskNames: ['하나', '', 3, '둘'], completedTasks: [true] });
  assert.deepEqual(state.taskNames, ['하나', '둘']);
  assert.deepEqual(state.completedTasks, [true, false], 'one flag per step');
  const many = L.sanitizeState({ mainGoal: 'a', taskNames: Array.from({ length: 30 }, (_, i) => 's' + i) });
  assert.equal(many.state.taskNames.length, 20);
});
