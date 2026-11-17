const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./helpers/app-harness.js');

/* Fake form fields by id; everything else behaves as in the normal test harness. */
function withFields(a, fields) {
  const get = a.context.document.getElementById;
  a.context.document.getElementById = id => (id in fields ? { value: fields[id] } : get(id));
}
const base = { mainGoal: 'x', focusHistory: [
  { date: '2026-05-10', minutes: 25, category: 'study', completedAt: '2026-05-10T01:00:00.000Z' },
  { date: '2026-05-09', minutes: 5, category: 'study', completedAt: '2026-05-09T01:00:00.000Z' }
] };

test('a focus record can be added by hand and counts in the totals', () => {
  const a = createApp(JSON.stringify(base));
  withFields(a, { focusManualDate: '2026-05-08', focusManualMinutes: '40', focusManualCategory: 'job' });
  a.run('focusHistoryAdd()');
  const history = a.saved().focusHistory;
  assert.equal(history.length, 3);
  const added = history.find(x => x.date === '2026-05-08');
  assert.equal(added.minutes, 40);
  assert.equal(added.category, 'job');
  assert.match(added.completedAt, /^manual-/);
  assert.deepEqual(history.map(x => x.date), ['2026-05-10', '2026-05-09', '2026-05-08'], 'kept newest date first');
  assert.match(a.run('focusHistoryHTML()'), /1시간 10분/, '25+5+40 minutes in the total');
});

test('a manual record never collides with the timer duplicate check', () => {
  const a = createApp(JSON.stringify(base));
  withFields(a, { focusManualDate: '2026-05-10', focusManualMinutes: '30', focusManualCategory: 'study' });
  a.run('focusHistoryAdd()');
  a.run('focusHistoryAdd()');
  assert.equal(a.saved().focusHistory.length, 4, 'two identical manual entries are both kept');
  a.run("focusRecordCompletion({minutes:25,category:'study',completedAt:'2026-05-10T05:00:00.000Z',date:'2026-05-10'})");
  assert.equal(a.saved().focusHistory.length, 5, 'a timer session is still recorded normally');
});

test('wrong manual input is refused with a message', () => {
  for (const f of [
    { focusManualDate: '2026-05-11', focusManualMinutes: '30' }, // after today (2026-05-10 in Korea)
    { focusManualDate: 'abc', focusManualMinutes: '30' },
    { focusManualDate: '2026-05-08', focusManualMinutes: '0' },
    { focusManualDate: '2026-05-08', focusManualMinutes: '601' },
    { focusManualDate: '2026-05-08', focusManualMinutes: '2.5' }
  ]) {
    const a = createApp(JSON.stringify(base));
    withFields(a, { focusManualCategory: 'study', ...f });
    a.run('focusHistoryAdd()');
    assert.equal(a.toasts.length, 1, JSON.stringify(f));
    assert.equal(a.saved().focusHistory.length, 2, 'nothing was added: ' + JSON.stringify(f));
  }
});

test('a wrong record can be deleted after asking, and a "no" keeps it', async () => {
  const keep = createApp(JSON.stringify(base), { confirm: false });
  await keep.run("focusHistoryRemove('2026-05-09T01:00:00.000Z')");
  assert.equal(keep.saved().focusHistory.length, 2);
  const a = createApp(JSON.stringify(base));
  await a.run("focusHistoryRemove('2026-05-09T01:00:00.000Z')");
  assert.deepEqual(a.saved().focusHistory.map(x => x.minutes), [25]);
  assert.match(a.dialogs[0].message, /지울까요/);
});

test('recent records show a delete button and the add form; the fold stays open after a change', () => {
  const a = createApp(JSON.stringify(base));
  const html = a.run('focusHistoryHTML()');
  assert.equal((html.match(/focusHistoryRemove\(/g) || []).length, 2);
  assert.match(html, /id="focusManualDate"/);
  assert.doesNotMatch(html, /<details class="focus-history-more" open/);
  a.run('focusHistoryOpen=true');
  assert.match(a.run('focusHistoryHTML()'), /<details class="focus-history-more" open/);
});
