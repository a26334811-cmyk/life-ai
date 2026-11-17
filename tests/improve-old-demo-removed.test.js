const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, html, script } = require('./helpers/app-harness.js');
const L = require('../logic.js');

test('the old DEMO screens and helpers are gone', () => {
  assert.ok(!html.includes('id="jobDetail"'));
  assert.ok(!html.includes('id="prepare"'));
  for (const name of ['startPrep', 'favorite', 'syncJobDetail']) {
    assert.ok(!new RegExp('function ' + name + '\\b').test(script), name + ' is removed');
  }
  assert.ok(!script.includes("go('jobDetail')") && !script.includes("go('prepare')"));
  assert.ok(!script.includes('const _go=go'), 'go() is no longer overwritten');
});

test('every navigation target in the page still points to a real screen', () => {
  const screens = new Set([...html.matchAll(/<section id="([^"]+)" class="screen/g)].map(x => x[1]));
  const targets = [...html.matchAll(/go\('([A-Za-z]+)'\)/g)].map(x => x[1]);
  const missing = [...new Set(targets)].filter(t => !screens.has(t));
  assert.deepEqual(missing, []);
});

test('old saved data with the removed flags still loads and the job screens draw normally', () => {
  const old = { mainGoal: '취업', goalType: 'job', jobSubmitted: true, jobPreparationStarted: true, favorite: true, completedTasks: [true, true, true, true, true] };
  const result = L.sanitizeState(old);
  assert.deepEqual(result.dropped, [], 'the old flags are accepted, not rejected');
  assert.equal(L.validateBackupState({ ...old, nickname: 'n', activity: [] }), true, 'old backup files still restore');
  const a = createApp(JSON.stringify(old));
  a.run('renderHome()');
  a.run('renderGoals()');
  a.run('renderTasks()');
  assert.match(a.el('homeContent').innerHTML, /관심 회사와 공고를 관리해보세요/);
  assert.match(a.el('goalsContent').innerHTML, /기회 탐색 중/);
  assert.match(a.el('taskList').innerHTML, /저장한 공고에서 준비하기/);
});
