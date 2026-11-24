const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../logic.js');

/* 한국 시간 새벽 0~9시(UTC 15~24시)에는 한국 날짜가 UTC 날짜보다 하루 빨라요 (#243) */
test('koreaDate uses the Korean calendar day, also between 00:00 and 09:00 KST',()=>{
  assert.equal(L.koreaDate(Date.parse('2026-05-10T16:30:00Z')),'2026-05-11');
  assert.equal(L.koreaDate(Date.parse('2026-05-10T14:59:59Z')),'2026-05-10');
  assert.equal(L.koreaDate(Date.parse('2026-05-10T15:00:00Z')),'2026-05-11');
  assert.equal(L.koreaDate(Date.parse('2026-12-31T20:00:00Z')),'2027-01-01','year boundary');
});

/* 집중 시간 합계는 한 곳에서만 계산해요 (#250) */
test('focusMinutes adds up the records that match and treats a non-number as 0',()=>{
  const history=[
    {date:'2026-05-10',minutes:25,category:'study'},
    {date:'2026-05-10',minutes:'30',category:'job'},
    {date:'2026-05-09',minutes:'abc',category:'study'},
    {date:'2026-05-09',minutes:null,category:'study'},
    {date:'2026-05-08',category:'job'},
    {date:'2026-05-08',minutes:15,category:'study'}
  ];
  assert.equal(L.focusMinutes(history),70,'no filter = all records');
  assert.equal(L.focusMinutes(history,x=>x.date==='2026-05-10'),55);
  assert.equal(L.focusMinutes(history,x=>x.category==='study'),40);
  assert.equal(L.focusMinutes(history,x=>x.date>='2026-05-09'&&x.date<='2026-05-09'),0,'text minutes never turn the total into NaN');
  assert.equal(L.focusMinutes(history,()=>false),0);
  assert.equal(L.focusMinutes([]),0);
  assert.equal(L.focusMinutes(undefined),0);
});

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

test('skipOccurrence adds a date once and keeps the list sorted',()=>{
  const item={date:'2026-05-01',repeat:'daily'};
  L.skipOccurrence(item,'2026-05-05');
  L.skipOccurrence(item,'2026-05-03');
  L.skipOccurrence(item,'2026-05-05');
  assert.deepEqual(item.skipDates,['2026-05-03','2026-05-05']);
  assert.equal(L.occurs(item,'2026-05-05'),false);
  assert.equal(L.occurs(item,'2026-05-04'),true);
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
    habits:[{id:'h1',name:'운동',checks:['2026-05-01']},{id:'h2',name:5,checks:[]},null],
    plannerEntries:[{id:'p1',title:'a',date:'2026-05-01'},{id:'p2',title:'b',date:'2026-02-30'}],
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

test('sanitizeState keeps a habit and its good dates when only some check dates are broken',()=>{
  const raw={habits:[{id:'h1',name:'운동',checks:['2026-05-01','bad','2026-02-30',7,'2026-05-02']},{id:'h2',name:'독서',checks:['2026-05-03']}]};
  const {state,dropped}=L.sanitizeState(raw);
  assert.equal(state.habits.length,2);
  assert.deepEqual(state.habits[0].checks,['2026-05-01','2026-05-02']);
  assert.equal(state.habits[0].name,'운동');
  assert.deepEqual(state.habits[1].checks,['2026-05-03']);
  assert.ok(dropped.includes('habits'),'the user is told something was skipped');
  assert.deepEqual(raw.habits[0].checks,['2026-05-01','bad','2026-02-30',7,'2026-05-02'],'input is not changed');
  assert.deepEqual(L.sanitizeState({habits:[{id:'a1',name:'a',checks:['2026-05-01']}]}).dropped,[],'clean data reports nothing');
  assert.equal(L.validateBackupState({mainGoal:'',nickname:'',activity:[],completedTasks:[],habits:raw.habits}),false,'restoring a backup stays strict');
});

test('habit and planner ids must be plain characters (no quotes or markup)',()=>{
  const evil="x');alert(1);('";
  const raw={
    habits:[{id:'ab-12_X',name:'a',checks:[]},{id:evil,name:'b',checks:[]},{name:'c',checks:[]},{id:'a'.repeat(41),name:'d',checks:[]}],
    plannerEntries:[{id:'mq1-abc',title:'a',date:'2026-05-01'},{id:evil,title:'b',date:'2026-05-01'},{id:'',title:'c',date:'2026-05-01'}]
  };
  const {state,dropped}=L.sanitizeState(raw);
  assert.deepEqual(state.habits.map(h=>h.id),['ab-12_X']);
  assert.deepEqual(state.plannerEntries.map(e=>e.id),['mq1-abc']);
  assert.ok(dropped.includes('habits')&&dropped.includes('plannerEntries'));
  const base={nickname:'a',mainGoal:'b',activity:[],completedTasks:[false,false,false,false,false]};
  assert.equal(L.validateBackupState({...base,habits:[{id:evil,name:'b',checks:[]}]}),false);
  assert.equal(L.validateBackupState({...base,plannerEntries:[{id:evil,title:'b',date:'2026-05-01'}]}),false);
});

test('occurs does not rebuild Date objects for dates it has already checked, and still rejects bad dates',()=>{
  const RealDate=global.Date;
  let made=0;
  global.Date=class extends RealDate{constructor(...args){made++;super(...args);}};
  try{
    const items=[{date:'2026-05-01',repeat:'daily'},{date:'2026-05-01',repeat:'weekly'},{date:'2026-05-01',repeat:'none'},{date:'2026-02-30',repeat:'daily'}];
    const days=['2026-05-10','2026-05-11','2026-05-12','2026-02-31'];
    for(const item of items)for(const day of days)L.occurs(item,day); // warm up
    made=0;
    for(let n=0;n<200;n++)for(const item of items)for(const day of days)L.occurs(item,day);
    assert.equal(made,0,'no new Date objects after the first answers are known');
  }finally{global.Date=RealDate;}
  assert.equal(L.occurs({date:'2026-02-30',repeat:'daily'},'2026-03-01'),false,'invalid start date stays rejected');
  assert.equal(L.occurs({date:'2026-05-01',repeat:'daily'},'2026-02-31'),false,'invalid day stays rejected');
  assert.equal(L.occurs({date:'2026-05-01',repeat:'daily'},'2026-05-02'),true);
});

test('sanitizeState empties malformed certSchedule rounds (refetchable) but keeps good ones',()=>{
  const good={qualification:{name:'전기기사'},items:[],rounds:[{round:'2026년 1회',events:[{label:'접수',startDate:'2026-11-20'}]}]};
  assert.deepEqual(L.sanitizeState({certSchedule:good}).state.certSchedule,good);
  for(const rounds of [[null],[{round:'1회'}],[{round:'1회',events:'x'}],[{round:'1회',events:[null]}],[{events:[]}],'x',null]){
    const r=L.sanitizeState({certSchedule:{qualification:{name:'전기기사'},items:[],rounds}});
    assert.deepEqual(r.state.certSchedule.rounds,[]);assert.equal(r.state.certSchedule.qualification.name,'전기기사');assert.deepEqual(r.dropped,[]);
  }
  assert.equal(L.sanitizeState({certSchedule:{items:[]}}).state.certSchedule.rounds,undefined);
});

test('sanitizeState keeps planner items with broken time/repeat/until and resets those fields',()=>{
  const raw={plannerEntries:[
    {id:'a',title:'숫자 시간',date:'2026-05-10',time:900,repeat:'yearly',until:'abc'},
    {id:'b',title:'이상한 시간',date:'2026-05-11',time:'25:99',repeat:'none',until:'2026-02-30'},
    {id:'c',title:'정상',date:'2026-05-12',time:'09:30',repeat:'weekly',until:'2026-12-31'},
    {id:'d',title:'시간 없음',date:'2026-05-13'}]};
  const {state,dropped}=L.sanitizeState(raw);
  assert.deepEqual(dropped,[],'nothing is dropped, so a backup with such items can still be restored');
  assert.equal(state.plannerEntries.length,4);
  assert.deepEqual(state.plannerEntries.slice(0,2).map(e=>[e.time,e.repeat,e.until]),[['','none',''],['','none','']]);
  assert.deepEqual([state.plannerEntries[2].time,state.plannerEntries[2].repeat,state.plannerEntries[2].until],['09:30','weekly','2026-12-31']);
  assert.equal('time' in state.plannerEntries[3],false);
  assert.equal(L.validateBackupState({mainGoal:'',nickname:'',activity:[],completedTasks:[],plannerEntries:raw.plannerEntries}),true);
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

test('readBackup checks file text, format, version and state in one place',()=>{
  const state={nickname:'a',mainGoal:'b',activity:[],completedTasks:[false,false,false,false,false]};
  const file=(over)=>JSON.stringify({format:'life-ai-backup',version:1,exportedAt:'2026-05-10T00:00:00Z',state,...over});
  const ok=L.readBackup(file());
  assert.equal(ok.ok,true);assert.equal(ok.state.mainGoal,'b');assert.equal(ok.state.schemaVersion,L.STATE_SCHEMA_VERSION);
  const notBackup='올바른 life-ai 백업 파일이 아니에요.',badShape='백업 데이터의 구조가 올바르지 않아요.';
  const fail=(text,message)=>{const r=L.readBackup(text);assert.equal(r.ok,false);assert.equal(r.message,message);assert.equal(r.state,undefined);};
  const unreadable='백업 파일을 읽지 못했어요. 앱에서 만든 life-ai-backup-날짜.json 파일을 골라 주세요.';
  fail('not json at all',unreadable);
  fail('',unreadable);
  fail('null',notBackup);fail('[]',notBackup);fail('"text"',notBackup);
  fail(file({format:'other'}),notBackup);
  assert.match(L.readBackup(file({version:2})).message,/더 새로운 버전에서 만든 백업/,'a newer backup version gets its own message');
  fail(file({state:null}),notBackup);
  fail(file({state:[1,2]}),notBackup);
  fail(file({state:{...state,completedTasks:undefined}}),badShape);
  fail(file({state:{nickname:'a',activity:[],completedTasks:[]}}),badShape);
  fail(file({state:{...state,habits:[{name:1}]}}),badShape);
  fail(file({state:{...state,completedTasks:[1]}}),badShape);
  assert.equal(L.BACKUP_FORMAT,'life-ai-backup');assert.equal(L.BACKUP_VERSION,1);
});

test('focus categories come from one list and unknown values fall back to the first',()=>{
  assert.deepEqual(L.FOCUS_CATEGORIES.map(c=>c.name),['study','job','personal']);
  assert.ok(L.FOCUS_CATEGORIES.every(c=>typeof c.label==='string'&&c.label));
  for(const c of L.FOCUS_CATEGORIES)assert.equal(L.focusCategoryName(c.name),c.name);
  for(const bad of [undefined,null,'',7,'work','__proto__'])assert.equal(L.focusCategoryName(bad),'study');
  assert.equal(L.resumeFocus({status:'paused',minutes:25,category:'work',remaining:60},0).category,'study');
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

test('migrateState turns text-only watch companies into records',()=>{
  const out=L.migrateState({schemaVersion:2,watchCompanies:['삼천리 ',{id:'a1',name:'현대제철',url:''}]});
  assert.equal(out.watchCompanies[0].name,'삼천리');
  assert.equal(out.watchCompanies[0].url,'');
  assert.ok(typeof out.watchCompanies[0].id==='string'&&out.watchCompanies[0].id);
  assert.deepEqual(out.watchCompanies[1],{id:'a1',name:'현대제철',url:''});
  assert.equal(L.sanitizeState(out).dropped.length,0);
});

test('migrateState gives an id to habits, planner entries and watch companies that have none',()=>{
  const out=L.migrateState({schemaVersion:2,
    habits:[{name:'운동',checks:[]},{id:'h1',name:'독서',checks:[]}],
    plannerEntries:[{title:'면접',date:'2026-12-01'},{id:'p1',title:'시험',date:'2026-12-02'}],
    watchCompanies:[{name:'삼천리',url:''}]});
  assert.ok(out.habits[0].id);assert.equal(out.habits[1].id,'h1');
  assert.ok(out.plannerEntries[0].id);assert.equal(out.plannerEntries[1].id,'p1');
  assert.ok(out.watchCompanies[0].id);
  assert.equal(out.habits[0].name,'운동','record is kept, not dropped');
  const ids=[out.habits[0].id,out.plannerEntries[0].id,out.watchCompanies[0].id];
  assert.equal(new Set(ids).size,3,'new ids are different from each other');
  assert.equal(L.sanitizeState(out).dropped.length,0);
});

test('migrateState does not lower the version of data saved by a newer app',()=>{
  assert.equal(L.migrateState({schemaVersion:L.STATE_SCHEMA_VERSION+1}).schemaVersion,L.STATE_SCHEMA_VERSION+1);
  assert.equal(L.migrateState({schemaVersion:1}).schemaVersion,L.STATE_SCHEMA_VERSION);
  assert.equal(L.migrateState({}).schemaVersion,L.STATE_SCHEMA_VERSION);
});

test('resumeFocus never returns more remaining time than the timer length',()=>{
  const now=Date.parse('2026-05-10T03:00:00Z');
  const r=L.resumeFocus({status:'running',deadline:now+90*60*1000,minutes:25},now);
  assert.equal(r.status,'running');assert.equal(r.remaining,1500);
  assert.equal(r.deadline,now+1500*1000,'deadline matches the capped remaining time');
  const ok=L.resumeFocus({status:'running',deadline:now+600000,minutes:25},now);
  assert.equal(ok.remaining,600);assert.equal(ok.deadline,now+600000,'normal case is unchanged');
});

test('focus length accepts any whole number from 1 to 180 and a saved custom timer is restored',()=>{
  const now=Date.now();
  for(const ok of [1,7,40,90,180,'40'])assert.equal(L.isFocusMinutes(ok),true,String(ok));
  for(const bad of [0,181,2.5,-1,'',null,undefined,'abc',NaN])assert.equal(L.isFocusMinutes(bad),false,String(bad));
  const running=L.resumeFocus({status:'running',deadline:now+60000,minutes:90,category:'study'},now);
  assert.equal(running.status,'running');assert.equal(running.minutes,90);
  const paused=L.resumeFocus({status:'paused',remaining:3000,minutes:40},now);
  assert.equal(paused.status,'paused');assert.equal(paused.remaining,2400,'capped to the custom length');
});

test('resumeFocus ignores damaged data',()=>{
  const now=Date.now();
  for(const bad of [null,undefined,'x',[],{},{status:'running'},{status:'running',deadline:'abc',minutes:25},{status:'running',deadline:now+1000,minutes:0},{status:'running',deadline:now+1000,minutes:181},{status:'running',deadline:now+1000,minutes:2.5},{status:'running',deadline:now+1000,minutes:-5},{status:'running',deadline:now+1000,minutes:''},{status:'paused',remaining:'x',minutes:25},{status:'other',minutes:25}]){
    assert.equal(L.resumeFocus(bad,now).status,'idle',JSON.stringify(bad));
  }
  assert.equal(L.resumeFocus({status:'paused',remaining:99999,minutes:25},now).remaining,1500,'capped to the chosen length');
});

test('backupNudge asks when never backed up, stale, or history is nearly full',()=>{
  const now=Date.parse('2026-05-20T00:00:00Z');
  assert.equal(L.backupNudge({},now),null,'empty app is not nagged');
  assert.equal(L.backupNudge({mainGoal:'x'},now),null,'only a goal typed: not nagged on day one');
  assert.equal(L.backupNudge({mainGoal:'x',habits:[{}],plannerEntries:[{}]},now),null,'two records: still not nagged');
  assert.equal(L.backupNudge({mainGoal:'x',habits:[{}],plannerEntries:[{}],jobPostings:[{}]},now).kind,'never','three records and never backed up');
  assert.equal(L.recordCount({habits:[{},{}],focusHistory:[{}],favoriteCerts:'bad'}),3);
  assert.equal(L.backupNudge({mainGoal:'x',lastBackupAt:'2026-05-15T00:00:00Z'},now),null);
  const stale=L.backupNudge({mainGoal:'x',lastBackupAt:'2026-05-01T00:00:00Z'},now);
  assert.equal(stale.kind,'stale');assert.match(stale.message,/19일/);
  const full=L.backupNudge({mainGoal:'x',lastBackupAt:'2026-05-10T00:00:00Z',focusHistory:Array.from({length:450},()=>({}))},now);
  assert.equal(full.kind,'history');assert.match(full.message,/450\/500/);
  assert.equal(L.backupNudge({mainGoal:'x',focusHistory:Array.from({length:450},()=>({}))},now).kind,'history','never backed up');
  assert.equal(L.backupNudge({mainGoal:'x',lastBackupAt:'2026-05-19T00:00:00Z',focusHistory:Array.from({length:450},()=>({}))},now),null,'a backup made yesterday silences the full-history warning');
  assert.equal(L.backupNudge({mainGoal:'x',lastBackupAt:'2026-05-01T00:00:00Z',focusHistory:Array.from({length:10},()=>({}))},now).kind,'stale');
  assert.equal(L.backupNudge({mainGoal:'x',backupSnoozeUntil:'2026-05-25T00:00:00Z'},now),null,'snoozed');
});

/* ---------- job posting helpers ---------- */
test('extractDeadline finds the deadline in typical Korean posting text',()=>{
  const today='2026-11-16';
  const cases=[
    ['접수기간 : 2026.11.10(월) ~ 2026.11.30(일) 18:00','2026-11-30'],
    ['마감일: 2026-12-05','2026-12-05'],
    ['지원 마감 12월 5일 (금) 18시까지','2026-12-05'],
    ['공고일 2026.11.01 / 마감 2026.11.20','2026-11-20'],
    ['11/30까지 접수','2026-11-30'],
    ['서류 접수 11월 10일부터 11월 30일까지','2026-11-30'],
    ['2026년 12월 20일까지 지원해 주세요','2026-12-20'],
    ['마감 1월 5일','2027-01-05']
  ];
  for(const [text,expected] of cases)assert.equal(L.extractDeadline(text,today)?.date,expected,text);
});

test('extractDeadline year-less dates pick the closest year around new year',()=>{
  const jan=L.extractDeadline('12월 28일까지 접수','2027-01-03');
  assert.equal(jan.date,'2026-12-28');assert.equal(jan.past,true,'December deadline read in January is already over');
  const dec=L.extractDeadline('마감 1월 5일','2026-12-20');
  assert.equal(dec.date,'2027-01-05');assert.equal(dec.past,false);
  assert.equal(L.extractDeadline('마감 1월 5일','2027-01-03').date,'2027-01-05');
  assert.equal(L.extractDeadline('마감 12월 28일','2026-11-17').date,'2026-12-28');
});

test('extractDeadline reads "2월 29일" in both leap and non-leap years',()=>{
  assert.equal(L.extractDeadline('서류 접수 마감 2월 29일까지','2027-12-10')?.date,'2028-02-29','non-leap year: next leap year');
  assert.equal(L.extractDeadline('서류 접수 마감 2월 29일까지','2028-01-10')?.date,'2028-02-29','leap year: this year');
  assert.equal(L.extractDeadline('서류 접수 마감 2월 30일까지','2027-12-10'),null,'a date that never exists is still ignored');
});

test('extractDeadline picks the end of a range joined by a dash',()=>{
  const today='2026-11-16';
  const cases=[
    ['모집기간 2026.11.10 – 2026.11.30','2026-11-30'],
    ['모집기간 2026.11.10 — 2026.11.30','2026-11-30'],
    ['모집기간 2026.11.10(월) - 2026.11.30(일)','2026-11-30'],
    ['모집기간 2026.11.10 – 2026.11.30 18:00','2026-11-30'],
    ['접수기간 11.10 – 11.30','2026-11-30']
  ];
  for(const [text,expected] of cases)assert.equal(L.extractDeadline(text,today)?.date,expected,text);
  assert.equal(L.extractDeadline('모집기간 2026.11.10 - 2026.11.30',today)?.confident,true);
});

test('extractDeadline keeps a recently passed short date in this year and flags it as past',()=>{
  const today='2026-11-16';
  const recent=L.extractDeadline('마감 10월 5일',today);
  assert.equal(recent.date,'2026-10-05');assert.equal(recent.past,true);
  assert.equal(L.extractDeadline('마감 10/5',today).date,'2026-10-05');
  assert.equal(L.extractDeadline('마감 1월 5일',today).date,'2027-01-05');
  // boundary: 179 days ago stays this year, 181 days ago moves to next year
  assert.equal(L.extractDeadline('마감 5월 21일',today).date,'2026-05-21');
  assert.equal(L.extractDeadline('마감 5월 19일',today).date,'2027-05-19');
});

test('extractDeadline does not pick the end of an interview period as the deadline',()=>{
  const today='2026-11-16';
  assert.equal(L.extractDeadline('접수: 11.1 ~ 11.30, 면접: 12.5 ~ 12.7',today)?.date,'2026-11-30');
  assert.equal(L.extractDeadline('접수기간 2026.11.10(월) ~ 2026.11.30(일), 면접 2026.12.05(금) ~ 2026.12.07(일)',today)?.date,'2026-11-30');
  assert.equal(L.extractDeadline('서류 접수 11월 10일 ~ 11월 30일 / 면접전형 12월 5일 ~ 12월 7일',today)?.date,'2026-11-30');
});

test('extractDeadline stays quiet when there is no clear deadline',()=>{
  const today='2026-11-16';
  for(const text of ['채용시 마감','급여 3.5% 인상, 3.5 리터','면접 발표 2026.12.10','','공고일 2026.11.01',null,undefined]){
    assert.equal(L.extractDeadline(text,today),null,String(text));
  }
  assert.equal(L.extractDeadline('마감 2026.12.05','2026-02-30'),null,'bad today');
});

test('extractDeadline does not pick a decimal like 학점 3.5 as the deadline',()=>{
  const today='2026-11-16';
  assert.equal(L.extractDeadline('학점 3.5 이상 우대, 지원 마감 11.30',today)?.date,'2026-11-30');
  assert.equal(L.extractDeadline('학점 3.5 이상 우대, 지원 마감 11/30',today)?.date,'2026-11-30');
  assert.equal(L.extractDeadline('지원 마감 11.30, 어학 점수 1.5배 가산',today)?.date,'2026-11-30');
  assert.equal(L.extractDeadline('학점 3.5 이상 우대, 지원 마감은 공고 참고',today),null,'decimal alone is not a deadline');
  assert.equal(L.extractDeadline('11.30 마감, 학점 3.5',today)?.date,'2026-11-30');
});

test('extractDeadline ignores dates inside links but still reads real dates around them',()=>{
  const today='2026-11-16';
  assert.equal(L.extractDeadline('마감 안내 https://site.com/2026/11/30/abc',today),null);
  assert.equal(L.extractDeadline('마감 https://news.example.com/2026/12/05/post',today),null);
  assert.equal(L.extractDeadline('자세히 https://site.com/2026/11/30/abc 접수 마감 2026.12.05',today)?.date,'2026-12-05');
  assert.equal(L.extractDeadline('마감 2026-12-05 https://site.com/2026/11/30/abc',today)?.date,'2026-12-05');
});

test('extractDeadline flags past dates and confidence',()=>{
  const r=L.extractDeadline('접수기간 2026.10.01 ~ 2026.10.31','2026-11-16');
  assert.equal(r.date,'2026-10-31');assert.equal(r.past,true);
  const strong=L.extractDeadline('마감일 2026-12-05 까지','2026-11-16');
  assert.equal(strong.confident,true);assert.equal(strong.past,false);
  assert.match(strong.snippet,/2026-12-05/);
});

test('firstUrl and parseShareParams read links from shared text',()=>{
  assert.equal(L.firstUrl('보세요 https://example.com/job/1?a=1&b=2. 감사'),'https://example.com/job/1?a=1&b=2');
  assert.equal(L.firstUrl('링크 없음'),'');
  assert.equal(L.firstUrl('javascript:alert(1) ftp://x.com'),'');
  // Korean text stuck to the link ends the link (messenger pastes)
  assert.equal(L.firstUrl('공고 (https://site.com/job/12)입니다'),'https://site.com/job/12');
  assert.equal(L.firstUrl('https://site.com/job/12에서 확인하세요'),'https://site.com/job/12');
  assert.equal(L.firstUrl('https://site.com/job/12?id=3&x=1입니다.'),'https://site.com/job/12?id=3&x=1');
  assert.equal(L.firstUrl('링크: https://site.com/job/12.'),'https://site.com/job/12');
  assert.equal(L.firstUrl('(https://site.com/job/12)'),'https://site.com/job/12');
  assert.equal(L.firstUrl('https://en.wikipedia.org/wiki/Foo_(bar) 참고'),'https://en.wikipedia.org/wiki/Foo_(bar)','a balanced bracket stays');
  assert.equal(L.firstUrl('https://en.wikipedia.org/wiki/Foo_(bar))입니다'),'https://en.wikipedia.org/wiki/Foo_(bar)');
  assert.equal(L.parseShareParams('?text='+encodeURIComponent('공고예요(https://site.com/job/12)입니다')).url,'https://site.com/job/12');
  const s=L.parseShareParams('?title=%EC%8B%9C%EC%84%A4%EA%B4%80%EB%A6%AC%20%EC%B1%84%EC%9A%A9&text=%EC%9E%90%EC%84%B8%ED%9E%88%20https%3A%2F%2Fexample.com%2Fjob%2F1');
  assert.equal(s.url,'https://example.com/job/1');assert.equal(s.title,'시설관리 채용');
  const onlyText=L.parseShareParams('?text='+encodeURIComponent('삼천리 신입 https://example.com/j/9'));
  assert.equal(onlyText.url,'https://example.com/j/9');assert.equal(onlyText.title,'삼천리 신입');
  assert.equal(L.parseShareParams('?text=hello'),null);
  assert.equal(L.parseShareParams(''),null);
  assert.equal(L.parseShareParams('?url='+encodeURIComponent('javascript:alert(1)')),null);
});

test('cleanTitle removes only a trailing site name',()=>{
  assert.equal(L.cleanTitle('시설관리 신입 - 사람인','사람인'),'시설관리 신입');
  assert.equal(L.cleanTitle('시설관리 | 원티드','원티드'),'시설관리');
  assert.equal(L.cleanTitle('사람인 연구원 채용','사람인'),'사람인 연구원 채용');
  assert.equal(L.cleanTitle('  여러   공백  ',''),'여러 공백');
  assert.equal(L.cleanTitle('가'.repeat(300),'').length,120);
});

/* ---------- real posting text (hyundai-steel.recruiter.co.kr, user screenshot 2026-11-16) ---------- */
const HYUNDAI_TEXT=`4. 모집기간 및 지원방법
- 모집기간 : 26.11.11(수) 15:00  ~ 26.11.22(일) 23:59 까지
- 지원방법 : 당사 홈페이지 (hyundai-steel.recruiter.co.kr) 內 채용공고 메뉴 접속 후 지원서 작성
※ ①당사 홈페이지 지원서 ②기술직지원추가정보입력시스템, 총 2가지 지원서 ‘모두’ 작성시 최종지원 접수 완료
5. 전형절차 서류전형 26.12.03 발표`;

test('two-digit-year dates in a real posting give the end of the application period',()=>{
  const r=L.extractDeadline(HYUNDAI_TEXT,'2026-11-16');
  assert.equal(r.date,'2026-11-22');
  assert.equal(r.past,false);
  assert.equal(r.confident,true);
});

test('two-digit-year forms and look-alike numbers',()=>{
  const today='2026-11-16';
  assert.equal(L.extractDeadline('접수 마감: 26/12/05 18시까지',today)?.date,'2026-12-05');
  assert.equal(L.extractDeadline('지원기간 26-11-10 ~ 26-11-30',today)?.date,'2026-11-30');
  assert.equal(L.extractDeadline('서류전형 합격자 발표 26.12.03',today),null,'announcement date is not a deadline');
  assert.equal(L.extractDeadline('버전 10.20.30 안내, 문의 12.34.56',today),null,'version-like numbers have no deadline clue');
  assert.equal(L.extractDeadline('마감 26.13.45',today),null,'impossible date');
  assert.equal(L.extractDeadline('마감 2026.11.22',today)?.date,'2026-11-22','four-digit form still works');
});

test('sanitizeState keeps a posting that has no task list yet (the app fills it in) and drops ones with a wrong task list or non-text id/company/title',()=>{
  const good={id:'p1',company:'삼천리',title:'시설',tasks:[false,false,false,false]};
  const {state,dropped}=L.sanitizeState({jobPostings:[good,{id:'p3',company:'a',title:'b',tasks:'no'},{id:5,company:'a',title:'b',tasks:[]},{id:'p4',company:null,title:'b',tasks:[]},{id:'p5',company:'a',tasks:[]}]});
  assert.deepEqual(state.jobPostings,[good]);
  assert.ok(dropped.includes('jobPostings'));
  assert.equal(L.validateBackupState({nickname:'a',mainGoal:'b',activity:[],completedTasks:[],jobPostings:[{id:'p2',company:'a',title:'b'}]}),true,'an old backup without task lists is still accepted');
  assert.equal(L.sanitizeState({jobPostings:[{id:'p2',company:'a',title:'b'}]}).state.jobPostings.length,1);
});

test('weekStart gives the Sunday of the week, also across month and year ends',()=>{
  assert.equal(L.weekStart('2026-11-15'),'2026-11-15','a Sunday is its own week start');
  assert.equal(L.weekStart('2026-11-17'),'2026-11-15');
  assert.equal(L.weekStart('2026-11-21'),'2026-11-15','Saturday');
  assert.equal(L.weekStart('2026-01-01'),'2025-12-28','week that starts in the previous year');
  assert.equal(L.weekStart('2026-03-01'),'2026-03-01');
  assert.equal(L.weekStart('2026-04-01'),'2026-03-29','week that starts in the previous month');
});

test('periodDates lists the dates of the week or month that contains today',()=>{
  const week=L.periodDates('2026-12-31','week');
  assert.equal(week.start,'2026-12-27');
  assert.equal(week.end,'2027-01-02');
  assert.deepEqual(week.dates,['2026-12-27','2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
  const nov=L.periodDates('2026-11-17','month');
  assert.equal(nov.start,'2026-11-01');
  assert.equal(nov.end,'2026-11-30');
  assert.equal(nov.dates.length,30);
  assert.equal(nov.dates[29],'2026-11-30');
  const dec=L.periodDates('2026-12-31','month');
  assert.equal(dec.end,'2026-12-31');
  assert.equal(dec.dates.length,31);
  assert.equal(L.periodDates('2024-02-10','month').dates.length,29,'leap year February');
  assert.equal(L.periodDates('2026-02-10','month').end,'2026-02-28');
});

test('deadlineInRange accepts about two years either way and rejects placeholders',()=>{
  const today='2026-11-16';
  assert.equal(L.deadlineInRange('2026-12-05',today),true);
  assert.equal(L.deadlineInRange('2027-11-16',today),true);
  assert.equal(L.deadlineInRange('9999-12-31',today),false);
  assert.equal(L.deadlineInRange('1970-01-01',today),false);
  assert.equal(L.deadlineInRange('2026-02-30',today),false);
});

test('occurrencesByDate gives the same answers as occurs for every kind of item',()=>{
  const items=[
    {id:'a',date:'2026-01-31',repeat:'monthly'},
    {id:'b',date:'2026-11-03',repeat:'weekly',until:'2026-11-24',skipDates:['2026-11-10']},
    {id:'c',date:'2026-11-05',repeat:'daily'},
    {id:'d',date:'2026-11-12'},
    {id:'e',date:'2026-11-12',repeat:'none'},
    {id:'bad',date:'2026-13-40',repeat:'daily'},
    null,
    {id:'f',date:'2026-12-01',repeat:'daily'}
  ];
  const dates=[];
  for(let i=0;i<42;i++)dates.push(L.dateOffset('2026-10-25',i));
  dates.push('not-a-date','2026-11-12');
  const map=L.occurrencesByDate(items,dates);
  for(const date of dates){
    const expected=items.filter(x=>L.occurs(x,date)).map(x=>x.id);
    assert.deepEqual((map.get(date)||[]).map(x=>x.id),expected,date);
  }
  assert.deepEqual(map.get('not-a-date'),[]);
  assert.deepEqual(L.occurrencesByDate(null,['2026-11-12']).get('2026-11-12'),[]);
});

test('validDate rejects years outside 2000-2100 such as 0026 (a two-digit year typed into a date box)',()=>{
  assert.equal(L.validDate('0026-11-24'),false);
  assert.equal(L.validDate('1999-12-31'),false);
  assert.equal(L.validDate('2101-01-01'),false);
  assert.equal(L.validDate('2000-01-01'),true);
  assert.equal(L.validDate('2100-12-31'),true);
  assert.equal(L.validDate('2026-11-24'),true);
});

test('a posting memo longer than the limit is cut when loading, not dropped',()=>{
  const long='가'.repeat(L.POSTING_NOTES_MAX+500);
  const posting={id:'p1',company:'삼천리',title:'시설',url:'https://example.com/j',notes:long,stage:'관심',tasks:[false,false,false,false]};
  const {state,dropped}=L.sanitizeState({jobPostings:[posting,{...posting,id:'p2',notes:'짧은 메모'}]});
  assert.equal(state.jobPostings.length,2);
  assert.equal(state.jobPostings[0].notes.length,L.POSTING_NOTES_MAX);
  assert.equal(state.jobPostings[1].notes,'짧은 메모');
  assert.deepEqual(dropped,[],'cutting a long memo is not reported as lost data');
  assert.equal(posting.notes.length,L.POSTING_NOTES_MAX+500,'the input is not changed');
});

test('saved postings keep only http(s) links; a backup with an unsafe link is refused',()=>{
  const mk=(id,extra={})=>({id,company:'A',title:'t',...extra});
  const good=mk('a',{url:'https://example.com/1'});
  const raw={nickname:'n',mainGoal:'g',activity:[],completedTasks:[false],jobPostings:[good,mk('b',{url:'http://example.com/2'}),mk('c'),mk('d',{url:''}),mk('e',{url:'javascript:alert(1)'}),mk('f',{url:'not a url'}),mk('g',{url:42})]};
  const {state,dropped}=L.sanitizeState(raw);
  assert.deepEqual(state.jobPostings.map(p=>p.id),['a','b','c','d']);
  assert.ok(dropped.includes('jobPostings'));
  assert.equal(L.validateBackupState(raw),false);
  assert.equal(L.validateBackupState({...raw,jobPostings:[good,mk('c')]}),true);
});

test('sanitizeState fixes an unknown posting stage and a task list of the wrong size instead of leaving a broken posting',()=>{
  const mk=(id,extra)=>({id,company:'가',title:'x',...extra});
  const raw={jobPostings:[mk('a',{stage:'면접',tasks:[true,false,false,true]}),mk('b',{stage:'이상한 단계',tasks:[true]}),mk('c',{tasks:[true,'yes',null,false,true]}),mk('d',{})]};
  const {state,dropped}=L.sanitizeState(raw);
  assert.deepEqual(state.jobPostings[0].tasks,[true,false,false,true]);assert.equal(state.jobPostings[0].stage,'면접');
  assert.equal(state.jobPostings[1].stage,'관심');assert.deepEqual(state.jobPostings[1].tasks,[true,false,false,false]);
  assert.deepEqual(state.jobPostings[2].tasks,[true,false,false,false]);
  assert.equal('stage' in state.jobPostings[3],false,'a posting without a stage keeps no stage (the app reads that as 관심)');
  assert.deepEqual(dropped,[],'fixing a posting is not reported as lost data');
  assert.equal(L.validateBackupState({nickname:'a',mainGoal:'b',activity:[],completedTasks:[],jobPostings:raw.jobPostings}),true);
});

test('month.day dates that end with a dot are read, longer dotted numbers are not',()=>{
  const today='2026-11-16';
  assert.equal(L.extractDeadline('접수 마감 11.30.',today)?.date,'2026-11-30');
  assert.equal(L.extractDeadline('접수 마감 12.5.(금) 18시',today)?.date,'2026-12-05');
  assert.equal(L.extractDeadline('접수 마감 11.30. 이후 불가',today)?.date,'2026-11-30');
  assert.equal(L.extractDeadline('마감 1.2.3',today),null,'1.2.3 is a number, not a date');
  assert.equal(L.extractDeadline('마감 11.30.5',today),null,'dot followed by a digit is a longer number');
});
