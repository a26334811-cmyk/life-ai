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

/* ---------- #92 habit rename ---------- */
const habitsSeed=()=>JSON.stringify({habits:[
  {id:'h1',name:'운동',createdAt:'2026-05-01',checks:['2026-05-09','2026-05-10']},
  {id:'h2',name:'독서',createdAt:'2026-05-02',checks:[]}]});

test('renaming a habit keeps id, checks and createdAt',async()=>{
  const a=createApp(habitsSeed(),{answer:'  달리기  '});
  await a.run("habitRename('h1')");
  const h=a.saved().habits[0];
  assert.equal(h.name,'달리기');
  assert.equal(h.id,'h1');assert.equal(h.createdAt,'2026-05-01');
  assert.deepEqual(h.checks,['2026-05-09','2026-05-10']);
  assert.match(a.run('habitPanelHTML()'),/habitRename\('h1'\)/);
});

test('renaming a habit is refused for empty, too long or duplicate names, and cancel changes nothing',async()=>{
  for(const answer of ['   ','가'.repeat(61),'독서',null]){
    const a=createApp(habitsSeed(),{answer});
    await a.run("habitRename('h1')");
    assert.equal(a.saved().habits[0].name,'운동',JSON.stringify(answer));
  }
  const b=createApp(habitsSeed(),{answer:'독서'});
  await b.run("habitRename('h1')");
  assert.match(b.toasts.at(-1),/같은 이름/);
  const c=createApp(habitsSeed(),{answer:'운동'});
  await c.run("habitRename('h1')");
  assert.equal(c.saved().habits[0].name,'운동','same own name is a no-op');
});
