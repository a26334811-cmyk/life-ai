const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');
const { createApp } = require('./helpers/app-harness.js');

test('goalProgress for a job goal counts the prepare checks of saved postings', () => {
  const state = {
    goalType: 'job',
    completedTasks: [false, false, false, false, false],
    jobPostings: [{ tasks: [true, true, false, false] }, { tasks: [true, false, false, false] }]
  };
  assert.deepEqual(L.goalProgress(state), { done: 3, total: 8, percent: 38 });
});

test('goalProgress for a job goal without postings or with broken postings is 0', () => {
  assert.deepEqual(L.goalProgress({ goalType: 'job', completedTasks: [true] }), { done: 0, total: 0, percent: 0 });
  assert.deepEqual(L.goalProgress({ goalType: 'job', jobPostings: [null, {}, { tasks: 'x' }] }), { done: 0, total: 0, percent: 0 });
});

test('goalProgress for other goals still uses the 5 steps', () => {
  assert.deepEqual(L.goalProgress({ goalType: 'cert', completedTasks: [true, true, false, false, false], jobPostings: [{ tasks: [true] }] }), { done: 2, total: 5, percent: 40 });
  assert.deepEqual(L.goalProgress({}), { done: 0, total: 0, percent: 0 });
});

test('Home shows job progress from saved postings, not the unreachable 5 steps', () => {
  const a = createApp(JSON.stringify({
    mainGoal: '취업', goalType: 'job',
    jobPostings: [{ id: 'a', company: 'A', title: 't', stage: '관심', tasks: [true, true, false, false] }]
  }));
  a.run('renderHome()');
  const html = a.el('homeContent').innerHTML;
  assert.match(html, /목표 진행 50%/);
  assert.match(html, /2 \/ 4단계 완료/);
});
