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

/* ---------- #91 keep screen awake while the focus timer runs ---------- */
const installWakeLock=a=>{
  a.run(`globalThis.__wl={requests:0,released:0,sentinels:[]};
    navigator.wakeLock={request:async()=>{__wl.requests++;const s={released:false,release:async()=>{if(!s.released){s.released=true;__wl.released++;}}};__wl.sentinels.push(s);return s;}};`);
  return ()=>JSON.parse(a.run('JSON.stringify({requests:__wl.requests,released:__wl.released})'));
};
const flush=()=>new Promise(r=>setImmediate(r));

test('wake lock is requested on start and released on pause/finish/reset when the option is on',async()=>{
  const a=createApp(JSON.stringify({focusSettings:{minutes:25,alarm:'vibrate',keepAwake:true}}));
  const stats=installWakeLock(a);
  a.run('focusStartPause()');await flush();
  assert.deepEqual(stats(),{requests:1,released:0});
  a.run('focusStartPause()');await flush();               // pause
  assert.deepEqual(stats(),{requests:1,released:1});
  a.run('focusStartPause()');await flush();               // resume
  assert.equal(stats().requests,2);
  a.clock.now+=26*60*1000;a.tick();await flush();         // finished
  assert.deepEqual(stats(),{requests:2,released:2});
  a.run('focusStartPause()');await flush();
  await a.run('focusReset()');await flush();
  assert.deepEqual(stats(),{requests:3,released:3});
});

test('wake lock is not requested when the option is off or the device does not support it',async()=>{
  const a=createApp();
  const stats=installWakeLock(a);
  a.run('focusStartPause()');await flush();
  assert.equal(stats().requests,0,'option is off by default');
  const b=createApp(JSON.stringify({focusSettings:{minutes:25,alarm:'vibrate',keepAwake:true}}));
  b.run('focusStartPause()');await flush();               // navigator.wakeLock missing: must not throw
  assert.equal(b.run('focusRunning'),true);
});

test('wake lock is requested again when the page becomes visible; turning the option on/off while running works',async()=>{
  const a=createApp();
  const stats=installWakeLock(a);
  a.run('focusStartPause()');await flush();
  a.run('focusChangeKeepAwake(true)');await flush();
  assert.equal(stats().requests,1);
  assert.equal(a.saved().focusSettings.keepAwake,true);
  a.run('focusChangeKeepAwake(true)');await flush();
  assert.equal(stats().requests,1,'no second lock while one is held');
  a.run('__wl.sentinels[0].released=true;focusWakeSentinel=null;focusWakeAcquire()');await flush(); // the browser dropped it
  assert.equal(stats().requests,2);
  a.run('focusChangeKeepAwake(false)');await flush();
  assert.equal(a.saved().focusSettings.keepAwake,false);
  assert.equal(a.run('focusWakeSentinel'),null);
});

test('the keep-awake checkbox is shown in the notification settings',()=>{
  const a=createApp(JSON.stringify({focusSettings:{minutes:25,alarm:'vibrate',keepAwake:true}}));
  assert.match(a.run('focusPanelHTML()'),/id="focusKeepAwake" checked/);
});

/* ---------- #88 overdue entries card ---------- */
test('overdue card lists unfinished one-time entries from the last 14 days only',()=>{
  const e=(id,date,extra)=>({id,title:id,date,repeat:'none',done:false,...extra});
  const a=createApp(JSON.stringify({plannerEntries:[
    e('y','2026-05-09'),e('old','2026-04-26'),e('tooold','2026-04-25'),e('today','2026-05-10'),e('future','2026-05-11'),
    e('done','2026-05-08',{done:true}),e('rep','2026-05-01',{repeat:'daily',doneDates:[]})]}));
  const ids=JSON.parse(a.run('JSON.stringify(plannerOverdue().map(x=>x.id))'));
  assert.deepEqual(ids,['old','y']);
  a.run('renderCalendar()');
  const html=a.el('calendarContent').innerHTML;
  assert.match(html,/밀린 일정/);
  assert.match(html,/data-id="y" onclick="plannerToggle\(this\.dataset\.id,'2026-05-09'\)"/);
  assert.match(html,/plannerGoToDate\('2026-05-09'\)/);
  assert.doesNotMatch(html,/plannerToggle\('tooold'/);
});

test('completing an overdue entry removes it from the card; no card when nothing is overdue',()=>{
  const a=createApp(JSON.stringify({plannerEntries:[{id:'y',title:'y',date:'2026-05-09',repeat:'none',done:false}]}));
  a.run("plannerToggle('y','2026-05-09')");
  assert.equal(a.saved().plannerEntries[0].done,true);
  assert.equal(a.run('plannerOverdue().length'),0);
  assert.doesNotMatch(a.el('calendarContent').innerHTML,/밀린 일정/);
});

test('go-to-date opens the calendar tab on that day',()=>{
  const a=createApp();
  a.run("plannerGoToDate('2026-05-09')");
  assert.equal(a.run('plannerActiveTab'),'calendar');
  assert.equal(a.run('plannerSelected'),'2026-05-09');
});

/* ---------- #89 postpone to tomorrow ---------- */
const plannerSeed=()=>JSON.stringify({plannerEntries:[
  {id:'one',title:'단발',date:'2026-05-10',time:'',category:'personal',repeat:'none',until:'',priority:'normal',done:false},
  {id:'rep',title:'반복',date:'2026-05-01',time:'',category:'personal',repeat:'daily',until:'',priority:'normal',done:false,doneDates:[]}]});

test('postpone moves a one-time entry one day later; repeating entries get no button',()=>{
  const a=createApp(plannerSeed());
  a.run("plannerSelected='2026-05-10';renderCalendar()");
  const html=a.el('calendarContent').innerHTML;
  assert.match(html,/data-id="one" onclick="plannerPostpone\(this\.dataset\.id\)"/);
  assert.doesNotMatch(html,/plannerPostpone\('rep'\)/);
  a.run("plannerPostpone('one')");
  const one=a.saved().plannerEntries.find(e=>e.id==='one');
  assert.equal(one.date,'2026-05-11');assert.equal(one.title,'단발');
  assert.equal(a.run("plannerForDate('2026-05-10').some(e=>e.id==='one')"),false);
  assert.equal(a.run("plannerForDate('2026-05-11').some(e=>e.id==='one')"),true);
  a.run("plannerPostpone('rep')");
  assert.equal(a.saved().plannerEntries.find(e=>e.id==='rep').date,'2026-05-01','repeating entry is untouched');
});

test('postpone crosses a month end',()=>{
  const a=createApp(JSON.stringify({plannerEntries:[{id:'x',title:'t',date:'2026-05-31',repeat:'none'}]}));
  a.run("plannerPostpone('x')");
  assert.equal(a.saved().plannerEntries[0].date,'2026-06-01');
});

/* ---------- #84 posting display order ---------- */
test('saved postings are shown by deadline urgency without changing the stored order',()=>{
  const mk=(id,deadline,stage)=>({id,company:id,title:id,url:'https://x.example/'+id,deadline,stage,tasks:[false,false,false,false]});
  const list=[mk('past','2026-05-01','관심'),mk('applied','2026-05-12','지원 완료'),mk('none1','','관심'),
    mk('late','2026-06-01','준비 중'),mk('soon','2026-05-11','관심'),mk('today','2026-05-10','준비 중'),mk('none2','','준비 중'),mk('result','','합격')];
  const a=createApp(JSON.stringify({jobPostings:list}));
  const ids=JSON.parse(a.run('JSON.stringify(postingsForDisplay().map(p=>p.id))'));
  assert.deepEqual(ids,['today','soon','late','none1','none2','applied','result','past']);
  a.run('renderJobHub()');
  const html=a.el('savedPostings').innerHTML;
  assert.ok(html.indexOf('<h3>today ·')<html.indexOf('<h3>past ·'));
  assert.deepEqual(a.saved().jobPostings?.map(p=>p.id)??list.map(p=>p.id),list.map(p=>p.id));
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(state.jobPostings.map(p=>p.id))')),list.map(p=>p.id));
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
  assert.match(a.run('habitPanelHTML()'),/data-id="h1" onclick="habitRename\(this\.dataset\.id\)"/);
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
