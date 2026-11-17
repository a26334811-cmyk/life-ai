const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

const titles=(a,date)=>JSON.parse(a.run(`JSON.stringify(plannerForDate('${date}').map(e=>e.title))`));
const fillForm=(a,v)=>{
  a.el('plannerTitle').value=v.title;a.el('plannerDate').value=v.date;a.el('plannerTime').value=v.time||'';
  a.el('plannerCategory').value=v.category||'personal';a.el('plannerRepeat').value=v.repeat||'none';
  a.el('plannerUntil').value=v.until||'';a.el('plannerPriority').value=v.priority||'normal';
};

/* ---------- focus timer persistence (improvement 1) ---------- */
test('a running focus timer survives reload and keeps counting',()=>{
  const a=createApp();
  a.run('focusStartPause()');
  assert.equal(a.saved().focusRun.status,'running');
  const later=a.clock.now+10*60*1000;
  const b=createApp(JSON.stringify(a.saved()),{now:later});
  assert.equal(b.run('focusRunning'),true);
  assert.equal(b.run('focusRemaining'),15*60);
  assert.equal(b.run('focusSettings().minutes'),25);
});

test('a paused focus timer is restored with its remaining time',()=>{
  const a=createApp();
  a.run('focusStartPause()');
  a.clock.now+=5*60*1000;
  a.run('focusStartPause()');
  assert.equal(a.saved().focusRun.status,'paused');
  const b=createApp(JSON.stringify(a.saved()),{now:a.clock.now+3600000});
  assert.equal(b.run('focusRunning'),false);
  assert.equal(b.run('focusRemaining'),20*60);
});

test('a timer that ended while the app was closed is recorded once with its real end date',()=>{
  const a=createApp();
  a.run("focusSettings().category='job';focusStartPause()");
  const deadline=a.saved().focusRun.deadline;
  const reopened=deadline+90*60*1000;
  const b=createApp(JSON.stringify(a.saved()),{now:reopened});
  assert.equal(b.run('focusRunning'),false);
  assert.equal(b.run('focusHistory().length'),1);
  const entry=b.saved().focusHistory[0];
  assert.equal(entry.minutes,25);assert.equal(entry.category,'job');
  assert.equal(entry.completedAt,new Date(deadline).toISOString());
  assert.equal('focusRun' in b.saved(),false);
  assert.match(b.run('startupNotice'),/25분 집중이 끝났어요/);
  // opening it again must not add a second record
  const c=createApp(JSON.stringify(b.saved()),{now:reopened+1000});
  assert.equal(c.run('focusHistory().length'),1);
});

test('the same finished session is not recorded twice by two tabs',()=>{
  const a=createApp();
  a.run("focusRecordCompletion({minutes:25,category:'study',completedAt:'2026-05-10T03:25:00.000Z',date:'2026-05-10'});focusRecordCompletion({minutes:25,category:'study',completedAt:'2026-05-10T03:25:00.000Z',date:'2026-05-10'})");
  assert.equal(a.run('focusHistory().length'),1);
});

test('reset and duration change clear the saved timer; cancelled dialog keeps it',async()=>{
  const a=createApp(undefined,{confirm:false});
  a.run('focusStartPause()');
  await a.run('focusReset()');
  assert.equal(a.run('focusRunning'),true);
  assert.equal(a.saved().focusRun.status,'running');
  const b=createApp(undefined,{confirm:true});
  b.run('focusStartPause()');
  await b.run('focusReset()');
  assert.equal(b.run('focusRunning'),false);
  assert.equal('focusRun' in b.saved(),false);
  b.run('focusStartPause()');
  await b.run('focusChangeMinutes(30)');
  assert.equal(b.run('focusRemaining'),30*60);
  assert.equal('focusRun' in b.saved(),false);
});

test('finishing the timer records it using the deadline time and clears the saved run',()=>{
  const a=createApp();
  a.run('focusStartPause()');
  a.clock.now+=25*60*1000+500;
  a.tick();
  assert.equal(a.run('focusRunning'),false);
  assert.equal(a.run('focusHistory().length'),1);
  assert.equal('focusRun' in a.saved(),false);
  assert.equal(a.run('focusRemaining'),0);
});

/* ---------- notifications (improvement 2) ---------- */
test('browser notification is sent only when enabled, permitted and the tab is hidden',async()=>{
  const hidden=createApp(undefined,{hidden:true,notification:{permission:'default',requestResult:'granted'}});
  await hidden.run('focusChangeNotify(true)');
  assert.equal(hidden.run('focusSettings().notify'),true);
  await hidden.run('focusShowNotification()');
  assert.equal(hidden.notifications.length,1);
  assert.match(hidden.notifications[0].title,/집중 시간이 끝났어요/);
  const visible=createApp(undefined,{hidden:false,notification:{permission:'granted',requestResult:'granted'}});
  await visible.run('focusChangeNotify(true)');
  await visible.run('focusShowNotification()');
  assert.equal(visible.notifications.length,0,'visible tab already shows the toast');
});

test('denied or unsupported notification permission switches the option back off',async()=>{
  const denied=createApp(undefined,{notification:{permission:'default',requestResult:'denied'}});
  await denied.run('focusChangeNotify(true)');
  assert.equal(denied.run('focusSettings().notify'),false);
  const none=createApp();
  await none.run('focusChangeNotify(true)');
  assert.equal(none.run('focusSettings().notify'),false);
  assert.match(none.toasts.join('|'),/지원하지 않아요/);
});

/* ---------- planner repeat handling (improvements 3 and 4) ---------- */
test('monthly item on the 31st shows on the last day of February',()=>{
  const a=createApp();
  a.run("state.plannerEntries=[{id:'m',title:'월말 정산',date:'2026-01-31',repeat:'monthly'}]");
  assert.deepEqual(titles(a,'2026-02-28'),['월말 정산']);
  assert.deepEqual(titles(a,'2026-02-27'),[]);
});

test('deleting one occurrence keeps the rest of the repeating item',async()=>{
  const a=createApp(undefined,{choice:'one'});
  a.run("state.plannerEntries=[{id:'d',title:'운동',date:'2026-05-01',repeat:'daily'}]");
  await a.run("plannerRemove('d','2026-05-05')");
  assert.deepEqual(titles(a,'2026-05-05'),[]);
  assert.deepEqual(titles(a,'2026-05-06'),['운동']);
  assert.equal(a.saved().plannerEntries[0].skipDates[0],'2026-05-05');
});

test('deleting all occurrences removes the item, cancelling keeps it',async()=>{
  const keep=createApp(undefined,{choice:null});
  keep.run("state.plannerEntries=[{id:'d',title:'운동',date:'2026-05-01',repeat:'daily'}]");
  await keep.run("plannerRemove('d','2026-05-05')");
  assert.equal(keep.run('state.plannerEntries.length'),1);
  const all=createApp(undefined,{choice:'all'});
  all.run("state.plannerEntries=[{id:'d',title:'운동',date:'2026-05-01',repeat:'daily'}]");
  await all.run("plannerRemove('d','2026-05-05')");
  assert.equal(all.run('state.plannerEntries.length'),0);
});

test('one-off items are removed after a plain confirmation',async()=>{
  const a=createApp(undefined,{confirm:true});
  a.run("state.plannerEntries=[{id:'o',title:'치과',date:'2026-05-02',repeat:'none'}]");
  await a.run("plannerRemove('o','2026-05-02')");
  assert.equal(a.run('state.plannerEntries.length'),0);
  assert.equal(a.dialogs.at(-1).kind,'confirm');
  const b=createApp(undefined,{confirm:false});
  b.run("state.plannerEntries=[{id:'o',title:'치과',date:'2026-05-02',repeat:'none'}]");
  await b.run("plannerRemove('o','2026-05-02')");
  assert.equal(b.run('state.plannerEntries.length'),1);
});

test('editing one occurrence changes only that day',async()=>{
  const a=createApp(undefined,{choice:'one'});
  a.run("state.plannerEntries=[{id:'d',title:'운동',date:'2026-05-01',repeat:'daily'}]");
  a.run("plannerEdit('d','2026-05-05')");
  fillForm(a,{title:'병원',date:'2026-05-05',repeat:'none'});
  await a.run('plannerSave()');
  assert.equal(a.run('state.plannerEntries.length'),2);
  assert.deepEqual(titles(a,'2026-05-05'),['병원']);
  assert.deepEqual(titles(a,'2026-05-04'),['운동']);
  assert.deepEqual(titles(a,'2026-05-06'),['운동']);
});

test('editing all occurrences changes the series and keeps skipped days',async()=>{
  const a=createApp(undefined,{choice:'all'});
  a.run("state.plannerEntries=[{id:'d',title:'운동',date:'2026-05-01',repeat:'daily',skipDates:['2026-05-03']}]");
  a.run("plannerEdit('d','2026-05-05')");
  fillForm(a,{title:'조깅',date:'2026-05-01',repeat:'daily'});
  await a.run('plannerSave()');
  assert.equal(a.run('state.plannerEntries.length'),1);
  assert.deepEqual(titles(a,'2026-05-04'),['조깅']);
  assert.deepEqual(titles(a,'2026-05-03'),[]);
});

test('cancelling the scope question leaves the series untouched',async()=>{
  const a=createApp(undefined,{choice:null});
  a.run("state.plannerEntries=[{id:'d',title:'운동',date:'2026-05-01',repeat:'daily'}]");
  a.run("plannerEdit('d','2026-05-05')");
  fillForm(a,{title:'바뀜',date:'2026-05-01',repeat:'daily'});
  await a.run('plannerSave()');
  assert.deepEqual(titles(a,'2026-05-05'),['운동']);
});

test('ticking a repeating item done affects only that day',()=>{
  const a=createApp();
  a.run("state.plannerEntries=[{id:'d',title:'운동',date:'2026-05-01',repeat:'daily'}]");
  a.run("plannerToggle('d','2026-05-05')");
  assert.equal(a.run("plannerForDate('2026-05-05')[0].done"),true);
  assert.equal(a.run("plannerForDate('2026-05-06')[0].done"),false);
});

/* ---------- damaged saved data (improvement 5) ---------- */
test('damaged saved data does not break startup and the original is kept',()=>{
  const raw=JSON.stringify({mainGoal:'전기기사 준비',goalType:'cert',completedTasks:'bad',habits:'oops',plannerEntries:[{title:'x',date:'nope'}],focusSettings:7});
  const a=createApp(raw);
  assert.equal(a.run('state.mainGoal'),'전기기사 준비');
  assert.equal(a.run('state.completedTasks.length'),5);
  assert.equal(a.run('habitEntries().length'),0);
  assert.equal(a.run('focusSettings().minutes'),25);
  assert.equal(a.storage.get('lifeAIPrototypeV5.damaged'),raw);
});

test('unreadable saved data starts fresh but is preserved',()=>{
  const a=createApp('{not json');
  assert.equal(a.run('state.mainGoal'),'');
  assert.equal(a.storage.get('lifeAIPrototypeV5.damaged'),'{not json');
});

test('data saved by the previous version is upgraded',()=>{
  const old=JSON.stringify({mainGoal:'x',plannerEntries:[{id:'r',title:'매일',date:'2026-05-01',repeat:'daily',done:true}]});
  const a=createApp(old);
  assert.equal(a.run('state.schemaVersion'),2);
  assert.equal(a.run("plannerForDate('2026-05-02')[0].done"),false,'old global done flag no longer hides every day');
});

/* ---------- backup reminders (improvement 6) ---------- */
test('home and MY show the backup reminder until a backup is made, and it can be snoozed',()=>{
  const goalOnly=createApp(JSON.stringify({mainGoal:'전기기사 준비',goalType:'cert'}));
  assert.equal(goalOnly.run('backupNudgeHTML()'),'','a goal alone does not trigger the reminder');
  const a=createApp(JSON.stringify({mainGoal:'전기기사 준비',goalType:'cert',habits:[{id:'h',name:'공부',checks:[]}],plannerEntries:[{id:'p',title:'a',date:'2026-05-01'},{id:'q',title:'b',date:'2026-05-02'}]}));
  assert.match(a.run('backupNudgeHTML()'),/백업한 적이 없어요/);
  a.run('renderHome()');
  assert.match(a.el('homeContent').innerHTML,/backup-nudge/);
  a.run('snoozeBackupNudge()');
  assert.equal(a.run('backupNudgeHTML()'),'');
  const fresh=createApp();
  assert.equal(fresh.run('backupNudgeHTML()'),'','empty app is not nagged');
});

test('a nearly full focus history triggers the reminder and overflow warns',()=>{
  const history=Array.from({length:460},(_,i)=>({date:'2026-05-01',minutes:25,category:'study',completedAt:'t'+i}));
  const a=createApp(JSON.stringify({mainGoal:'x',lastBackupAt:new Date(Date.parse('2026-05-10T03:00:00Z')-10*86400000).toISOString(),focusHistory:history}));
  assert.match(a.run('backupNudgeHTML()'),/460\/500/);
  const backedUp=createApp(JSON.stringify({mainGoal:'x',lastBackupAt:new Date(Date.parse('2026-05-10T03:00:00Z')-86400000).toISOString(),focusHistory:history}));
  assert.equal(backedUp.run('backupNudgeHTML()'),'','a recent backup removes the full-history reminder');
  const full=Array.from({length:500},(_,i)=>({date:'2026-05-01',minutes:25,category:'study',completedAt:'t'+i}));
  const b=createApp(JSON.stringify({mainGoal:'x',focusHistory:full}));
  b.run("focusRecordCompletion({minutes:25,category:'study',completedAt:'new',date:'2026-05-10'})");
  assert.equal(b.run('focusHistory().length'),500);
  assert.match(b.toasts.join('|'),/가장 오래된 기록/);
});

/* ---------- in-app dialogs (improvement 7) ---------- */
test('the app no longer uses the browser confirm/prompt/alert popups',()=>{
  const {html}=require('./helpers/app-harness.js');
  const appScript=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(appScript,/[^.\w]confirm\(/);
  assert.doesNotMatch(appScript,/[^.\w]prompt\(/);
  assert.doesNotMatch(appScript,/[^.\w]alert\(/);
});

test('cancelling a posting delete keeps the posting',async()=>{
  const a=createApp(undefined,{confirm:false});
  a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='https://example.com/j';
  a.run('savePosting()');
  const id=a.run('state.jobPostings[0].id');
  await a.run(`deletePosting('${id}')`);
  assert.equal(a.run('state.jobPostings.length'),1);
  const b=createApp(a.storage.get('lifeAIPrototypeV5'),{confirm:true});
  await b.run(`deletePosting('${id}')`);
  assert.equal(b.run('state.jobPostings.length'),0);
});

/* ---------- job posting auto-fill (option A) ---------- */
const reply=(body,ok=true)=>async()=>({ok,json:async()=>body});
const status=a=>a.el('postingFetchStatus').textContent;

test('a pasted link fills empty title, company, region and deadline from the page summary',async()=>{
  let requested='';
  const a=createApp(undefined,{now:Date.parse('2026-11-16T03:00:00Z'),fetch:async url=>{requested=url;return {ok:true,json:async()=>({ok:true,title:'시설관리 신입 - 사람인',siteName:'사람인',company:'삼천리',region:'경기 수원시',deadline:'2026-12-05',description:''})};}});
  a.el('postingUrl').value='https://example.com/job/1';
  await a.run('fillPostingFromUrl()');
  assert.match(requested,/^\/\.netlify\/functions\/link-preview\?url=https%3A%2F%2Fexample\.com%2Fjob%2F1$/);
  assert.equal(a.el('postingTitle').value,'시설관리 신입');
  assert.equal(a.el('postingCompany').value,'삼천리');
  assert.equal(a.el('postingRegion').value,'경기 수원시');
  assert.equal(a.el('postingDeadline').value,'2026-12-05');
  assert.match(status(a),/채운 항목: .*공고명.*회사명.*마감일/);
  assert.equal(a.el('postingFetch').disabled,false,'button is usable again');
});

test('auto-fill never overwrites what the user already typed',async()=>{
  const a=createApp(undefined,{fetch:reply({ok:true,title:'다른 제목',company:'다른 회사',deadline:'2099-01-01',description:''})});
  a.el('postingUrl').value='https://example.com/job/1';a.el('postingCompany').value='내가 쓴 회사';a.el('postingDeadline').value='2099-05-05';
  await a.run('fillPostingFromUrl()');
  assert.equal(a.el('postingCompany').value,'내가 쓴 회사');
  assert.equal(a.el('postingDeadline').value,'2099-05-05');
  assert.equal(a.el('postingTitle').value,'다른 제목');
});

test('a page without a company says so instead of guessing, and a past deadline is not filled',async()=>{
  const a=createApp(undefined,{now:Date.parse('2026-11-16T03:00:00Z'),fetch:reply({ok:true,title:'정비 신입',siteName:'원티드',company:'',deadline:'2026-10-01',description:''})});
  a.el('postingUrl').value='https://example.com/job/2';
  await a.run('fillPostingFromUrl()');
  assert.equal(a.el('postingCompany').value,'');
  assert.equal(a.el('postingDeadline').value,'');
  assert.match(status(a),/원티드 페이지라서 회사명은 직접 입력/);
  assert.match(status(a),/이미 지났어요/);
});

test('the deadline is found in the page description when the page has no structured deadline',async()=>{
  const a=createApp(undefined,{now:Date.parse('2026-11-16T03:00:00Z'),fetch:reply({ok:true,title:'안전관리',description:'모집 안내. 지원 마감 12월 5일 (금) 18시까지'})});
  a.el('postingUrl').value='https://example.com/job/3';
  await a.run('fillPostingFromUrl()');
  assert.equal(a.el('postingDeadline').value,'2026-12-05');
});

test('unreadable links, blocked sites and no network give friendly messages and keep the form',async()=>{
  const blocked=createApp(undefined,{fetch:reply({ok:false,message:'이 사이트는 자동으로 읽을 수 없게 막혀 있어요. 직접 입력해 주세요.'},false)});
  blocked.el('postingUrl').value='https://example.com/x';blocked.el('postingTitle').value='내 제목';
  await blocked.run('fillPostingFromUrl()');
  assert.match(status(blocked),/막혀 있어요/);assert.equal(blocked.el('postingTitle').value,'내 제목');
  const offline=createApp(undefined,{fetch:async()=>{throw new TypeError('Failed to fetch');}});
  offline.el('postingUrl').value='https://example.com/x';
  await offline.run('fillPostingFromUrl()');
  assert.match(status(offline),/지금은 링크를 읽을 수 없어요/);
  assert.equal(offline.el('postingFetch').disabled,false);
  const empty=createApp(undefined,{fetch:async()=>{throw new Error('should not be called');}});
  await empty.run('fillPostingFromUrl()');
  assert.match(status(empty),/먼저 올바른 공고 링크/);
  empty.el('postingUrl').value='javascript:alert(1)';
  await empty.run('fillPostingFromUrl()');
  assert.match(status(empty),/먼저 올바른 공고 링크/);
});

test('pasting the posting text finds the deadline and the link',()=>{
  const a=createApp(undefined,{now:Date.parse('2026-11-16T03:00:00Z')});
  a.el('postingPaste').value='도시가스 시설관리 신입\n접수기간 2026.11.10(월) ~ 2026.11.30(일) 18:00\n자세히 https://example.com/job/7';
  a.run('fillPostingFromPaste()');
  assert.equal(a.el('postingDeadline').value,'2026-11-30');
  assert.equal(a.el('postingUrl').value,'https://example.com/job/7');
  assert.match(status(a),/마감일/);
  const none=createApp();
  none.el('postingPaste').value='채용시 마감, 많은 지원 바랍니다';
  none.run('fillPostingFromPaste()');
  assert.match(status(none),/찾지 못했어요/);
  assert.equal(none.el('postingDeadline').value,'');
});

test('a link shared from the phone opens the job screen with the form filled and read automatically',async()=>{
  const urls=[];
  const a=createApp(undefined,{now:Date.parse('2026-11-16T03:00:00Z'),search:'?title='+encodeURIComponent('삼천리 시설관리')+'&text='+encodeURIComponent('보세요 https://example.com/job/9'),
    fetch:async url=>{urls.push(url);return {ok:true,json:async()=>({ok:true,title:'삼천리 시설관리 신입',company:'삼천리',deadline:'2026-12-20',description:''})};}});
  await new Promise(r=>setImmediate(r));
  assert.equal(a.el('postingUrl').value,'https://example.com/job/9');
  assert.equal(a.el('postingTitle').value,'삼천리 시설관리','shared title is kept, page title only fills empty fields');
  assert.equal(a.el('postingCompany').value,'삼천리');
  assert.equal(a.el('postingDeadline').value,'2026-12-20');
  assert.equal(urls.length,1);
  assert.equal(a.historyCalls.length,1,'share parameters are removed so a reload does not repeat it');
  assert.equal(a.el('postingEditor').open,true);
});

test('sharing a link that is already saved does not create a second form',async()=>{
  const saved=JSON.stringify({mainGoal:'x',jobPostings:[{id:'p1',company:'삼천리',title:'시설',url:'https://example.com/job/9',stage:'관심',tasks:[false,false,false,false]}]});
  let fetched=0;
  const a=createApp(saved,{search:'?url='+encodeURIComponent('https://example.com/job/9'),fetch:async()=>{fetched++;return {ok:true,json:async()=>({ok:false})};}});
  await new Promise(r=>setImmediate(r));
  assert.equal(fetched,0);
  assert.match(a.el('toast').textContent,/이미 저장한 공고/,'startup toast is shown through the real toast element');
  assert.equal(a.el('postingUrl').value,'');
});

test('ordinary startup is not affected by the share handler',()=>{
  const a=createApp(undefined,{search:'?screen=calendar'});
  assert.equal(a.historyCalls.length,0);
  assert.equal(a.el('postingUrl').value,'');
  const b=createApp(undefined,{search:'?text=hello'});
  assert.equal(b.historyCalls.length,0);
});

test('an inferred company name is flagged to the user as a guess',async()=>{
  const a=createApp(undefined,{fetch:reply({ok:true,title:'26.11 현대제철 포항공장 기술직(계약) 채용',siteName:'현대제철 채용',company:'현대제철',companyInferred:true,description:''})});
  a.el('postingUrl').value='https://hyundai-steel.recruiter.co.kr/career/jobs/133809';
  await a.run('fillPostingFromUrl()');
  assert.equal(a.el('postingCompany').value,'현대제철');
  assert.match(status(a),/회사명은 페이지 정보로 추정한 값/);
  assert.equal(a.el('postingDeadline').value,'');
});

test('pasting the real Hyundai Steel posting text fills the deadline 2026-11-22',()=>{
  const a=createApp(undefined,{now:Date.parse('2026-11-16T03:00:00Z')});
  a.el('postingPaste').value='4. 모집기간 및 지원방법\n- 모집기간 : 26.11.11(수) 15:00  ~ 26.11.22(일) 23:59 까지\n- 지원방법 : 당사 홈페이지 (hyundai-steel.recruiter.co.kr) 內 채용공고 메뉴 접속 후 지원서 작성';
  a.run('fillPostingFromPaste()');
  assert.equal(a.el('postingDeadline').value,'2026-11-22');
  assert.match(status(a),/마감일/);
});

test('MY shows when the last backup was made',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',lastBackupAt:'2026-05-01T01:00:00.000Z'}));
  a.run('renderMy()');
  assert.ok(a.el('myContent').innerHTML.includes('마지막 백업:</strong> 2026-05-01'));
  const b=createApp();b.run('renderMy()');
  assert.ok(b.el('myContent').innerHTML.includes('마지막 백업:</strong> 아직 없음'));
});

test('pasting into the posting text box searches automatically',()=>{
  const {html}=require('./helpers/app-harness.js');
  assert.ok(html.includes('id="postingPaste" onpaste="setTimeout(fillPostingFromPaste,0)"'));
});

test('when the link gives no deadline the user is pointed to the paste box and it is opened',async()=>{
  const a=createApp(undefined,{fetch:reply({ok:true,title:'정비 신입',company:'현대제철',companyInferred:true,description:''})});
  let opened=false;
  a.el('postingPaste').closest=()=>({set open(v){opened=v;}});
  a.el('postingUrl').value='https://example.com/job/5';
  await a.run('fillPostingFromUrl()');
  assert.match(status(a),/마감일은 링크에서 찾지 못했어요/);
  assert.equal(opened,true);
  const b=createApp(undefined,{fetch:reply({ok:true,title:'정비 신입',deadline:'2099-01-01',description:''})});
  let bOpened=false;b.el('postingPaste').closest=()=>({set open(v){bOpened=v;}});
  b.el('postingUrl').value='https://example.com/job/6';
  await b.run('fillPostingFromUrl()');
  assert.doesNotMatch(status(b),/찾지 못했어요/);assert.equal(bOpened,false);
});

test('setup text boxes run their "next" action on Enter and show a matching keyboard key',()=>{
  const {html}=require('./helpers/app-harness.js');
  const expected={nickname:["go('goalChoice')",'next'],companyInput:['selectCompany()','go'],jobInput:["selectJob(this.value||'관심 직무')",'go'],
    certInput:["quickGoal((this.value||'자격증')+' 준비')",'go'],customGoalInput:['createCustomGoal()','go']};
  for(const [id,[action,hint]] of Object.entries(expected)){
    const tag=html.match(new RegExp('<input id="'+id+'"[^>]*>'))[0];
    assert.ok(tag.includes('enterkeyhint="'+hint+'"'),id+' keyboard hint');
    assert.ok(tag.includes("event.key==='Enter'")&&tag.includes(action),id+' Enter action');
  }
});

test('editing or adding a planner item scrolls to the form and focuses the title',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',plannerEntries:[{id:'p',title:'a',date:'2026-05-10'}]}));
  const calls=[];
  a.el('plannerEditor').scrollIntoView=o=>calls.push(['scroll',o.block]);
  a.el('plannerTitle').focus=()=>calls.push(['focus']);
  a.run("plannerEdit('p','2026-05-10')");
  assert.deepEqual(calls,[['scroll','center'],['focus']]);
  calls.length=0;
  a.run('plannerOpenForm()');
  assert.deepEqual(calls,[['scroll','center'],['focus']]);
});

test('restoring a backup keeps the previous data under beforeRestore',async()=>{
  const old=JSON.stringify({mainGoal:'예전 목표',goalType:'cert',nickname:'a'});
  const a=createApp(old,{search:''});
  a.run('location.reload=()=>{}');
  const backup={format:'life-ai-backup',version:1,state:{mainGoal:'백업 목표',nickname:'b',activity:[],completedTasks:[]}};
  const input={files:[{size:100,text:async()=>JSON.stringify(backup)}]};
  a.context.__input=input;
  await a.run('importLifeAIBackup(__input)');
  assert.equal(a.storage.get('lifeAIPrototypeV5.beforeRestore'),old);
  assert.equal(a.saved().mainGoal,'백업 목표');
  assert.match(a.dialogs.find(d=>d.kind==='alert').message,/beforeRestore/);
});

test('habit checkbox uses the date at click time, and a new day redraws the planner',()=>{
  const a=createApp(JSON.stringify({mainGoal:'전기기사 준비',goalType:'cert',habits:[{id:'h',name:'공부',checks:[]}]}));
  a.run('renderCalendar()');
  assert.match(a.el('calendarContent').innerHTML,/habitToggle\('h',koreaToday\(\)\)/);
  assert.equal(a.run('plannerSelected'),'2026-05-10');
  a.clock.now+=24*3600*1000;
  a.run('plannerDayRollover()');
  assert.equal(a.run('plannerSelected'),'2026-05-11');
  a.run("habitToggle('h',koreaToday())");
  assert.deepEqual(a.saved().habits[0].checks,['2026-05-11']);
});

test('a saved interview date shows in the planner for that day, except for finished postings',()=>{
  const a=createApp();
  const row=(id,company,stage)=>({id,company,title:'공고',stage,interviewDate:'2026-06-01',tasks:[false,false,false,false]});
  a.run('state.jobPostings='+JSON.stringify([row('a','삼천리','준비 중'),row('b','다른곳','불합격'),row('c','또다른곳','지원 취소')]));
  assert.deepEqual(titles(a,'2026-06-01'),['삼천리 · 공고 면접']);
  assert.deepEqual(titles(a,'2026-06-02'),[]);
});
