const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');
// The fake clock starts at 2026-05-10 (Korea time).

/* ---------- #7 habit: check yesterday ---------- */
test('a forgotten habit can be checked for yesterday, which keeps the streak; future days are refused',()=>{
  const a=createApp(JSON.stringify({habits:[{id:'h',name:'운동',createdAt:'2026-05-01',checks:['2026-05-08','2026-05-07']}]}));
  assert.equal(a.run('habitStreak(habitEntries()[0])'),0,'yesterday missed -> streak is 0');
  a.run("habitToggle('h','2026-05-09')");
  assert.deepEqual(a.saved().habits[0].checks.sort(),['2026-05-07','2026-05-08','2026-05-09']);
  assert.equal(a.run('habitStreak(habitEntries()[0])'),3);
  assert.match(a.run('habitPanelHTML()'),/어제 체크 취소/);
  a.run("habitToggle('h','2026-05-09')");
  assert.equal(a.saved().habits[0].checks.includes('2026-05-09'),false,'toggling again removes it');
  assert.match(a.run('habitPanelHTML()'),/어제 체크</);
  a.run("habitToggle('h','2026-05-11')");
  assert.equal(a.saved().habits[0].checks.includes('2026-05-11'),false,'tomorrow is refused');
});
