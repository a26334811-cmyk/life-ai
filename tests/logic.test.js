const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../logic.js');

test('monthly repeat that starts on the 31st lands on the last day of shorter months',()=>{
  const item={date:'2026-01-31',repeat:'monthly'};
  assert.equal(L.occurs(item,'2026-01-31'),true);
  assert.equal(L.occurs(item,'2026-02-28'),true);
  assert.equal(L.occurs(item,'2026-02-27'),false);
  assert.equal(L.occurs(item,'2026-04-30'),true);
  assert.equal(L.occurs(item,'2026-04-29'),false);
  assert.equal(L.occurs(item,'2026-03-31'),true);
  assert.equal(L.occurs(item,'2028-02-29'),true,'leap year');
});

test('monthly repeat on a normal day and before the start date',()=>{
  const item={date:'2026-03-15',repeat:'monthly'};
  assert.equal(L.occurs(item,'2026-04-15'),true);
  assert.equal(L.occurs(item,'2026-04-14'),false);
  assert.equal(L.occurs(item,'2026-02-15'),false,'before start');
});

test('weekly, daily, one-off and until bounds',()=>{
  assert.equal(L.occurs({date:'2026-05-01',repeat:'weekly'},'2026-05-15'),true);
  assert.equal(L.occurs({date:'2026-05-01',repeat:'weekly'},'2026-05-16'),false);
  assert.equal(L.occurs({date:'2026-05-01',repeat:'daily',until:'2026-05-03'},'2026-05-04'),false);
  assert.equal(L.occurs({date:'2026-05-01',repeat:'none'},'2026-05-01'),true);
  assert.equal(L.occurs({date:'2026-05-01',repeat:'none'},'2026-05-02'),false);
  assert.equal(L.occurs({date:'2026-02-30',repeat:'daily'},'2026-03-01'),false,'invalid start date');
});

test('skipDates remove a single occurrence of a repeating item',()=>{
  const item={date:'2026-05-01',repeat:'daily',skipDates:['2026-05-03']};
  assert.equal(L.occurs(item,'2026-05-02'),true);
  assert.equal(L.occurs(item,'2026-05-03'),false);
  assert.equal(L.occurs(item,'2026-05-04'),true);
});

test('done is tracked per date for repeating items and globally for one-off items',()=>{
  const daily={date:'2026-05-01',repeat:'daily'};
  L.toggleDone(daily,'2026-05-02');
  assert.equal(L.isDone(daily,'2026-05-02'),true);
  assert.equal(L.isDone(daily,'2026-05-03'),false);
  L.toggleDone(daily,'2026-05-02');
  assert.equal(L.isDone(daily,'2026-05-02'),false);
  const once={date:'2026-05-01',repeat:'none'};
  L.toggleDone(once,'2026-05-01');
  assert.equal(L.isDone(once,'2026-05-09'),true);
});

test('habit streak counts back from today or yesterday',()=>{
  assert.equal(L.habitStreak(['2026-05-10','2026-05-09','2026-05-08'],'2026-05-10'),3);
  assert.equal(L.habitStreak(['2026-05-09','2026-05-08'],'2026-05-10'),2,'today not yet checked');
  assert.equal(L.habitStreak(['2026-05-07'],'2026-05-10'),0);
  assert.equal(L.habitStreak(undefined,'2026-05-10'),0);
  assert.equal(L.habitStreak(['2026-03-01','2026-02-28'],'2026-03-01'),2,'month boundary');
});

test('sanitizeState drops wrong-typed fields and broken list items but keeps good data',()=>{
  const raw={
    nickname:'지훈',mainGoal:'전기기사',goalType:'cert',
    completedTasks:'oops',
    habits:[{name:'운동',checks:['2026-05-01']},{name:5,checks:[]},null],
    plannerEntries:[{title:'a',date:'2026-05-01'},{title:'b',date:'2026-02-30'}],
    focusHistory:[{date:'2026-05-01',minutes:25},{date:'bad',minutes:25},{date:'2026-05-01',minutes:-3}],
    activity:['ok',{x:1}],
    focusSettings:'nope',
    futureField:{keep:true},
    __proto__x:1
  };
  const {state,dropped}=L.sanitizeState(raw);
  assert.equal(state.nickname,'지훈');
  assert.equal('completedTasks' in state,false);
  assert.equal(state.habits.length,1);
  assert.equal(state.plannerEntries.length,1);
  assert.equal(state.focusHistory.length,1);
  assert.deepEqual(state.activity,['ok']);
  assert.equal('focusSettings' in state,false);
  assert.deepEqual(state.futureField,{keep:true});
  for(const k of ['completedTasks','habits','plannerEntries','focusHistory','activity','focusSettings'])assert.ok(dropped.includes(k),k);
});

test('sanitizeState rejects non-objects and strips prototype keys',()=>{
  assert.equal(L.sanitizeState(null),null);
  assert.equal(L.sanitizeState([]),null);
  assert.equal(L.sanitizeState('x'),null);
  const parsed=JSON.parse('{"nickname":"a","__proto__":{"polluted":true},"constructor":1}');
  const {state}=L.sanitizeState(parsed);
  assert.equal(state.polluted,undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(state,'constructor'),false);
});

test('validateBackupState is strict and never throws on missing fields',()=>{
  const good={nickname:'a',mainGoal:'b',activity:[],completedTasks:[false,false,false,false,false]};
  assert.equal(L.validateBackupState(good),true);
  assert.equal(L.validateBackupState({nickname:'a',mainGoal:'b',activity:[]}),false,'missing completedTasks');
  assert.equal(L.validateBackupState({...good,habits:[{name:1}]}),false);
  assert.equal(L.validateBackupState({...good,completedTasks:[1]}),false);
  assert.equal(L.validateBackupState(null),false);
});

test('resumeFocus restores running, paused and finished timers',()=>{
  const now=Date.parse('2026-05-10T03:00:00Z');
  const running=L.resumeFocus({status:'running',deadline:now+90500,minutes:25,category:'job'},now);
  assert.equal(running.status,'running');assert.equal(running.remaining,91);assert.equal(running.category,'job');
  const paused=L.resumeFocus({status:'paused',remaining:600,minutes:25},now);
  assert.equal(paused.status,'paused');assert.equal(paused.remaining,600);assert.equal(paused.category,'study');
  const finished=L.resumeFocus({status:'running',deadline:now-5000,minutes:25,category:'personal'},now);
  assert.equal(finished.status,'finished');assert.equal(finished.minutes,25);assert.equal(finished.date,'2026-05-10');
  assert.equal(finished.finishedAt,new Date(now-5000).toISOString());
});

test('resumeFocus ignores damaged data',()=>{
  const now=Date.now();
  for(const bad of [null,undefined,'x',[],{},{status:'running'},{status:'running',deadline:'abc',minutes:25},{status:'running',deadline:now+1000,minutes:7},{status:'paused',remaining:'x',minutes:25},{status:'other',minutes:25}]){
    assert.equal(L.resumeFocus(bad,now).status,'idle',JSON.stringify(bad));
  }
  assert.equal(L.resumeFocus({status:'paused',remaining:99999,minutes:25},now).remaining,1500,'capped to the chosen length');
});

test('backupNudge asks when never backed up, stale, or history is nearly full',()=>{
  const now=Date.parse('2026-05-20T00:00:00Z');
  assert.equal(L.backupNudge({},now),null,'empty app is not nagged');
  assert.equal(L.backupNudge({mainGoal:'x'},now).kind,'never');
  assert.equal(L.backupNudge({mainGoal:'x',lastBackupAt:'2026-05-15T00:00:00Z'},now),null);
  const stale=L.backupNudge({mainGoal:'x',lastBackupAt:'2026-05-01T00:00:00Z'},now);
  assert.equal(stale.kind,'stale');assert.match(stale.message,/19일/);
  const full=L.backupNudge({mainGoal:'x',lastBackupAt:'2026-05-19T00:00:00Z',focusHistory:Array.from({length:450},()=>({}))},now);
  assert.equal(full.kind,'history');assert.match(full.message,/450\/500/);
  assert.equal(L.backupNudge({mainGoal:'x',backupSnoozeUntil:'2026-05-25T00:00:00Z'},now),null,'snoozed');
});
