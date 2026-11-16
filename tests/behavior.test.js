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
  const a=createApp(JSON.stringify({mainGoal:'전기기사 준비',goalType:'cert'}));
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
  const a=createApp(JSON.stringify({mainGoal:'x',lastBackupAt:new Date(Date.parse('2026-05-10T03:00:00Z')-86400000).toISOString(),focusHistory:history}));
  assert.match(a.run('backupNudgeHTML()'),/460\/500/);
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
