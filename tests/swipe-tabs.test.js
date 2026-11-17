const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');
const { createApp, html } = require('./helpers/app-harness.js');

test('swipeDirection: only a clear, quick, sideways move counts', () => {
  assert.equal(L.swipeDirection(-120, 10, 200), 'next', 'finger moved left → next tab');
  assert.equal(L.swipeDirection(120, -10, 200), 'prev', 'finger moved right → previous tab');
  assert.equal(L.swipeDirection(-40, 0, 100), null, 'too short');
  assert.equal(L.swipeDirection(-120, 0, 900), null, 'too slow (a drag, not a swipe)');
  assert.equal(L.swipeDirection(-100, 90, 200), null, 'mostly vertical: the user is scrolling');
  assert.equal(L.swipeDirection(-100, 60, 200), 'next', 'a little diagonal is fine');
  assert.equal(L.swipeDirection(NaN, 0, 100), null);
});

test('stepTab walks the tab list and stops at both ends', () => {
  const tabs = ['today', 'calendar', 'habits', 'stats'];
  assert.equal(L.stepTab(tabs, 'today', 'next'), 'calendar');
  assert.equal(L.stepTab(tabs, 'calendar', 'next'), 'habits');
  assert.equal(L.stepTab(tabs, 'habits', 'prev'), 'calendar');
  assert.equal(L.stepTab(tabs, 'stats', 'next'), null);
  assert.equal(L.stepTab(tabs, 'today', 'prev'), null);
  assert.equal(L.stepTab(tabs, 'nope', 'next'), null);
  assert.equal(L.stepTab(tabs, 'today', 'sideways'), null);
});

/* ---------- on the screen ---------- */
const touch = (x, y) => ({ clientX: x, clientY: y });
const field = { closest: sel => (/input/.test(sel) ? {} : null) };
const plain = { closest: () => null };

// the events carry real objects, so hand them over through the sandbox instead of building code strings
function drive(a, from, to, { target = plain, ms = 150, fingers = 1 } = {}) {
  a.context.__ev = { start: { touches: Array(fingers).fill(from), target }, end: { changedTouches: [to] } };
  a.run('plannerTouchStart(__ev.start)');
  a.clock.now += ms;
  return a.run('plannerTouchEnd(__ev.end)');
}
const tabOf = a => a.run('plannerActiveTab');
const open = () => { const a = createApp(JSON.stringify({ mainGoal: 'x' })); a.run("go('calendar')"); return a; };

test('swiping left moves today → calendar → habits → stats, swiping right moves back', () => {
  const a = open();
  assert.equal(tabOf(a), 'today');
  assert.equal(drive(a, touch(300, 400), touch(120, 410)), true);
  assert.equal(tabOf(a), 'calendar');
  drive(a, touch(300, 400), touch(120, 400));
  assert.equal(tabOf(a), 'habits');
  drive(a, touch(300, 400), touch(120, 400));
  assert.equal(tabOf(a), 'stats');
  assert.equal(drive(a, touch(300, 400), touch(100, 400)), false, 'no tab after the last one');
  assert.equal(tabOf(a), 'stats');
  drive(a, touch(100, 400), touch(300, 400));
  assert.equal(tabOf(a), 'habits');
});

test('scrolling, slow drags, short moves, two fingers, typing fields and the screen edge do not change the tab', () => {
  const a = open();
  assert.equal(drive(a, touch(300, 300), touch(280, 700)), false, 'vertical scroll');
  assert.equal(drive(a, touch(300, 400), touch(120, 400), { ms: 1200 }), false, 'slow drag');
  assert.equal(drive(a, touch(300, 400), touch(270, 400)), false, 'short move');
  assert.equal(drive(a, touch(300, 400), touch(120, 400), { fingers: 2 }), false, 'two fingers (pinch)');
  assert.equal(drive(a, touch(300, 400), touch(120, 400), { target: field }), false, 'started on an input');
  a.context.window = { innerWidth: 390 };
  assert.equal(drive(a, touch(10, 400), touch(200, 400)), false, 'started at the left edge (system Back gesture)');
  assert.equal(drive(a, touch(385, 400), touch(120, 400)), false, 'started at the right edge');
  assert.equal(tabOf(a), 'today');
});

test('the swipe listeners are attached to the schedule screen and vertical scrolling stays free', () => {
  assert.match(html, /area\.addEventListener\('touchstart',plannerTouchStart,\{passive:true\}\)/);
  assert.match(html, /area\.addEventListener\('touchend',plannerTouchEnd,\{passive:true\}\)/);
  assert.match(html, /#calendarContent\{touch-action:pan-y pinch-zoom\}/);
  assert.match(html, /prefers-reduced-motion:reduce\)\{\.planner-tabpanel\.slide-next/);
});

test('tapping a tab button still works, and a screen redraw keeps the tab chosen by swiping', () => {
  const a = open();
  a.run("plannerSwitchTab('habits')");
  assert.equal(tabOf(a), 'habits');
  drive(a, touch(300, 400), touch(120, 400));
  assert.equal(tabOf(a), 'stats');
  a.run('renderCalendar()');
  assert.equal(tabOf(a), 'stats');
  assert.match(a.el('calendarContent').innerHTML, /data-tab="stats" role="tabpanel" >/);
});

test('the swipe hint is shown only the first time the schedule screen opens', () => {
  const a = createApp(JSON.stringify({ mainGoal: 'x' }));
  a.run("go('calendar')");
  assert.ok(a.toasts.some(t => /좌우로 밀어서/.test(t)));
  const n = a.toasts.length;
  a.run("go('home');go('calendar')");
  assert.equal(a.toasts.length, n, 'not again');
});
