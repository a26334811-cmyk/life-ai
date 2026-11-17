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

test('extractDeadline stays quiet when there is no clear deadline',()=>{
  const today='2026-11-16';
  for(const text of ['채용시 마감','급여 3.5% 인상, 3.5 리터','면접 발표 2026.12.10','','공고일 2026.11.01',null,undefined]){
    assert.equal(L.extractDeadline(text,today),null,String(text));
  }
  assert.equal(L.extractDeadline('마감 2026.12.05','2026-02-30'),null,'bad today');
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
