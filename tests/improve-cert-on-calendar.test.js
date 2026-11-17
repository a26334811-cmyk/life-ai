const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./helpers/app-harness.js');

const certSchedule = {
  qualification: { name: '전기기사', code: '1150' },
  items: [
    { qualificationName: '전기기사', type: '필기원서접수', label: '필기원서접수', startDate: '2026-05-11', endDate: '2026-05-14' },
    { qualificationName: '전기기사', type: '필기시험', label: '필기시험', startDate: '2026-05-16', endDate: '2026-05-16' },
    { qualificationName: '전기기사', type: '필기합격발표', label: '필기합격발표', startDate: '2026-05-20', endDate: '2026-05-20' }
  ]
};
const base = { mainGoal: '전기기사', goalType: 'cert', certSchedule };

test('plannerForDate returns registration and exam days as origin cert, but not result announcements', () => {
  const a = createApp(JSON.stringify(base));
  const day = a.run("plannerForDate('2026-05-12')");
  assert.equal(day.length, 1);
  assert.equal(day[0].origin, 'cert');
  assert.match(day[0].title, /전기기사 필기원서접수/);
  assert.match(a.run("plannerForDate('2026-05-16')")[0].title, /필기시험/);
  assert.equal(a.run("plannerForDate('2026-05-15')").length, 0, 'between periods nothing is shown');
  assert.equal(a.run("plannerForDate('2026-05-20')").length, 0, 'announcement days are not registration or exam days');
});

test('cert dates are marked 🏅 on the calendar, in the day list, and have no edit or delete buttons', () => {
  const a = createApp(JSON.stringify(base));
  a.run("plannerSelected='2026-05-16'");
  a.run('renderCalendar()');
  const screen = a.el('calendarContent').innerHTML;
  assert.match(screen, /🏅 전기기사 필기시험/);
  const from = screen.indexOf('📍 2026-05-16 일정');
  const list = screen.slice(from, screen.indexOf('<div class="card">', from)); // only the day-list card
  assert.match(list, /🏅 전기기사 필기시험/);
  assert.match(list, /조회한 자격증 일정/);
  assert.doesNotMatch(list, /plannerEdit|plannerRemove|plannerToggle/);
});

test('cert dates do not enter the "check first" list but may appear in the 7-day list', () => {
  const a = createApp(JSON.stringify(base), { now: Date.parse('2026-05-12T03:00:00Z') });
  const brief = a.run('plannerFocusHTML()');
  assert.doesNotMatch(brief, /먼저 확인할 일정/, 'cert items are not "external"');
  assert.match(brief, /필기원서접수/);
});

test('without a looked-up schedule nothing changes', () => {
  const a = createApp(JSON.stringify({ mainGoal: 'x', goalType: 'job' }));
  assert.equal(a.run("plannerForDate('2026-05-12')").length, 0);
});
