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

/* ---------- #85 posting stage date ---------- */
const postingsSeed=()=>JSON.stringify({jobPostings:[
  {id:'a',company:'가회사',title:'공고A',url:'https://a.example/1',deadline:'2026-05-20',stage:'관심',tasks:[false,false,false,false],createdAt:'2026-05-01T00:00:00.000Z'},
  {id:'b',company:'나회사',title:'공고B',url:'https://b.example/1',deadline:'',stage:'지원 완료',tasks:[false,false,false,false],stageChangedAt:'2026-05-03'},
  {id:'c',company:'다회사',title:'공고C',url:'https://c.example/1',deadline:'',stage:'지원 완료',tasks:[false,false,false,false]}]});

test('changing the stage records today and the card shows how many days since',()=>{
  const a=createApp(postingsSeed());
  a.run("setPostingStage('a','지원 완료')");
  assert.equal(a.saved().jobPostings.find(p=>p.id==='a').stageChangedAt,'2026-05-10');
  a.clock.now+=3*86400000;
  assert.match(a.run("postingStageLine(state.jobPostings.find(p=>p.id==='a'))"),/지원 완료 · 3일째/);
  a.run('renderJobHub()');
  assert.match(a.el('savedPostings').innerHTML,/지원 완료 · 3일째/);
  // picking the same stage again does not reset the date
  a.run("setPostingStage('a','지원 완료')");
  assert.equal(a.saved().jobPostings.find(p=>p.id==='a').stageChangedAt,'2026-05-10');
});

test('old postings without a stage date show nothing and early stages show no day count',()=>{
  const a=createApp(postingsSeed());
  assert.equal(a.run("postingStageLine(state.jobPostings.find(p=>p.id==='c'))"),'');
  assert.equal(a.run("postingStageLine(state.jobPostings.find(p=>p.id==='a'))"),'');
  assert.match(a.run("postingStageLine(state.jobPostings.find(p=>p.id==='b'))"),/7일째/);
  a.run("setPostingStage('a','준비 중')");
  assert.equal(a.run("postingStageLine(state.jobPostings.find(p=>p.id==='a'))"),'');
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
