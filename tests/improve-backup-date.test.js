const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./helpers/app-harness.js');

test('MY shows the Korean date of the last backup, even between 0:00 and 9:00 KST', () => {
  const a = createApp(JSON.stringify({ mainGoal: 'x', lastBackupAt: '2026-05-01T20:30:00.000Z' }));
  a.run('renderMy()');
  assert.ok(a.el('myContent').innerHTML.includes('마지막 백업:</strong> 2026-05-02'), '20:30 UTC is 05:30 the next day in Korea');
});

test('backup file name uses the Korean date', () => {
  const a = createApp(undefined, { now: Date.parse('2026-05-09T20:30:00Z') });
  const names = [];
  a.context.Blob = function () {};
  a.context.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  a.context.document.createElement = () => { const l = { click() { names.push(l.download); }, remove() {} }; return l; };
  a.context.document.body = { appendChild() {} };
  a.run('exportLifeAIBackup()');
  assert.deepEqual(names, ['life-ai-backup-2026-05-10-0530.json']);
});
