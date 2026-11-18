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

test('focus panel lists every duration and category from the shared lists, and settings are repaired once',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',focusSettings:{minutes:25,alarm:'vibrate',category:'bogus'}}));
  assert.equal(a.run('focusSettings().category'),'study');
  const html=a.run('focusPanelHTML()');
  for(const n of JSON.parse(a.run('JSON.stringify(LifeLogic.FOCUS_MINUTES)')))assert.ok(html.includes(`<option value="${n}"`),'minutes '+n);
  for(const c of JSON.parse(a.run('JSON.stringify(LifeLogic.FOCUS_CATEGORIES)')))assert.ok(html.includes(`<option value="${c.name}"`)&&html.includes(c.label),'category '+c.name);
  assert.equal((html.match(/<option value="study" selected>/g)||[]).length,1);
  a.run("focusChangeCategory('job')");assert.equal(a.run('focusSettings().category'),'job');
  a.run("focusChangeCategory('hacker')");assert.equal(a.run('focusSettings().category'),'job');
  a.run("focusRecordCompletion({minutes:25})");
  assert.equal(a.run('state.focusHistory[0].category'),'job');
  a.run("focusRecordCompletion({minutes:30,category:'personal',completedAt:'2026-05-10T04:00:00.000Z'})");
  const history=a.run('focusHistoryHTML()');
  assert.ok(history.includes('💼 취업 준비: 0시간 25분'));
  assert.ok(history.includes('🌿 개인 목표: 0시간 30분'));
  assert.ok(history.includes('📚 자격증·공부: 0시간 0분'));
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

test('a timer that ends does not redraw the planner, so typed text survives; only the record cards refresh',()=>{
  const a=createApp();
  a.el('calendarContent').innerHTML='typing…';
  a.el('progressInsights').outerHTML='old-report';a.el('focusHistoryCard').outerHTML='old-records';
  // planner screen closed: nothing is redrawn at all
  a.run("focusRecordCompletion({minutes:25,category:'study',completedAt:'2026-05-10T03:25:00.000Z',date:'2026-05-10'})");
  assert.equal(a.el('calendarContent').innerHTML,'typing…');
  assert.equal(a.el('progressInsights').outerHTML,'old-report');
  // planner screen open: the whole planner is still left alone, the two record cards are refreshed
  a.el('calendar').classList.contains=name=>name==='active';
  a.run("focusRecordCompletion({minutes:25,category:'study',completedAt:'2026-05-10T04:25:00.000Z',date:'2026-05-10'})");
  assert.equal(a.el('calendarContent').innerHTML,'typing…');
  assert.match(a.el('progressInsights').outerHTML,/id="progressInsights"/);
  assert.match(a.el('focusHistoryCard').outerHTML,/id="focusHistoryCard"/);
  assert.match(a.el('focusHistoryCard').outerHTML,/50분/);
});

test('an app kept open across midnight redraws the open screen when it becomes visible and checks habits on the new day',()=>{
  const a=createApp();
  a.run("state.habits=[{id:'h1',name:'공부',createdAt:'2026-05-01',checks:[]}];renderCalendar=()=>{globalThis.drawn=(globalThis.drawn||0)+1;}");
  a.context.document.querySelector=()=>({id:'calendar'});
  a.fire('visibilitychange');
  assert.equal(a.run('globalThis.drawn||0'),0,'same day: nothing is redrawn');
  a.clock.now=Date.parse('2026-05-11T01:00:00Z'); // 10:00 KST on the next day; the app was drawn on 2026-05-10
  a.fire('visibilitychange');
  assert.equal(a.run('globalThis.drawn'),1,'new day: the open screen is drawn again');
  a.fire('visibilitychange');
  assert.equal(a.run('globalThis.drawn'),1,'only once per new day');
  a.run("habitToggle('h1')");
  assert.equal(a.run('JSON.stringify(state.habits[0].checks)'),'["2026-05-11"]','the check is recorded on the day it is tapped');
});

test('an open app asks the service worker for a new version when it becomes visible and offers a reload button',()=>{
  const a=createApp();
  let updates=0;
  a.run('swRegistration=null');
  a.fire('visibilitychange'); // no registration yet: must not fail
  a.context.__reg={update:()=>{updates++;return Promise.resolve();}};
  a.run('swRegistration=__reg');
  a.fire('visibilitychange');
  assert.equal(updates,1);
  a.context.document.hidden=true;
  a.fire('visibilitychange');
  assert.equal(updates,1,'hidden: no check');
  // an app that already had a service worker shows the button when a new one takes over; the first install does not
  const makeContainer=controller=>{const handlers={};return {controller,addEventListener:(t,f)=>{handlers[t]=f;},fire:()=>handlers.controllerchange()};};
  const fresh=makeContainer(null);a.context.__c=fresh;a.run('watchAppUpdates(__c)');fresh.fire();
  assert.equal(a.el('updateBanner').hidden,undefined,'first install: no banner');
  const updated=makeContainer({});a.context.__c=updated;a.run('watchAppUpdates(__c)');updated.fire();
  assert.equal(a.el('updateBanner').hidden,false,'new version: banner shown');
  assert.match(require('./helpers/app-harness.js').html,/id="updateBanner"[^>]*hidden[^>]*>새 버전이 있어요\. 눌러서 새로고침/);
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

test('resetting a timer that ran 20 minutes can record those 20 minutes, discard them, or cancel',async()=>{
  const ran=async(choice)=>{
    const a=createApp(undefined,{choice});
    a.run('focusStartPause()');
    a.clock.now+=20*60*1000+10*1000;
    await a.run('focusReset()');
    return a;
  };
  const rec=await ran('record');
  assert.equal(rec.run('focusHistory().length'),1);
  assert.equal(rec.run('focusHistory()[0].minutes'),20,'elapsed whole minutes are saved');
  assert.equal(rec.run('focusHistory()[0].category'),'study');
  assert.equal(rec.run('focusRunning'),false);
  assert.equal(rec.run('focusRemaining'),25*60,'timer is back to the start');
  assert.equal('focusRun' in rec.saved(),false);
  assert.equal(rec.saved().focusHistory[0].minutes,20,'and it is saved to storage');
  assert.match(rec.dialogs[0].message,/20분/,'the dialog says how many minutes will be recorded');

  const drop=await ran('discard');
  assert.equal(drop.run('focusHistory().length'),0);
  assert.equal(drop.run('focusRunning'),false);
  assert.equal(drop.run('focusRemaining'),25*60);

  const cancel=await ran(null);
  assert.equal(cancel.run('focusHistory().length'),0);
  assert.equal(cancel.run('focusRunning'),true,'cancel keeps the timer going');
  assert.equal(cancel.saved().focusRun.status,'running');
});

test('under one minute there is nothing to record, so reset keeps the old confirm',async()=>{
  const a=createApp(undefined,{confirm:true,choice:'record'});
  a.run('focusStartPause()');
  a.clock.now+=40*1000;
  await a.run('focusReset()');
  assert.equal(a.dialogs[0].kind,'confirm');
  assert.equal(a.run('focusHistory().length'),0);
  assert.equal(a.run('focusRunning'),false);
});

test('a paused timer can also record its elapsed minutes on reset',async()=>{
  const a=createApp(undefined,{choice:'record'});
  a.run('focusStartPause()');
  a.clock.now+=7*60*1000+5000;
  a.run('focusStartPause()');
  assert.equal(a.run('focusRunning'),false);
  await a.run('focusReset()');
  assert.equal(a.run('focusHistory()[0].minutes'),7);
});

test('finishing the timer records it using the deadline time and clears the saved run',()=>{
  const a=createApp();
  a.run('focusStartPause()');
  a.clock.now+=25*60*1000+500;
  a.tick();
  assert.equal(a.run('focusRunning'),false);
  assert.equal(a.run('focusHistory().length'),1);
  assert.equal('focusRun' in a.saved(),false);
  // The clock goes back to the full length, so Reset / changing minutes does not warn about a "running" timer.
  assert.equal(a.run('focusRemaining'),25*60);
});

test('after a finished timer, reset and duration change do not ask for confirmation',async()=>{
  const a=createApp(undefined,{confirm:false});
  a.run('focusStartPause()');
  a.clock.now+=25*60*1000+500;
  a.tick();
  await a.run('focusReset()');
  await a.run('focusChangeMinutes(30)');
  assert.equal(a.dialogs.filter(d=>d.kind==='confirm').length,0);
  assert.equal(a.run('focusRemaining'),30*60);
  // same after reopening an app whose timer ended while it was closed
  const b=createApp(undefined,{confirm:false});
  b.run('focusStartPause()');
  const reopened=createApp(JSON.stringify(b.saved()),{now:b.saved().focusRun.deadline+60000,confirm:false});
  assert.equal(reopened.run('focusRemaining'),25*60);
  await reopened.run('focusReset()');
  assert.equal(reopened.dialogs.filter(d=>d.kind==='confirm').length,0);
});

test('the timer wakes once per shown second plus once at the end time, not twice a second',()=>{
  const a=createApp();
  const before=a.pending().length;
  a.run('focusStartPause()');
  const ids=a.pending().slice(before);
  assert.equal(ids.length,2,'one next-second timeout and one end-time timeout');
  assert.deepEqual(ids.map(id=>a.delays[id]).sort((x,y)=>x-y),[1005,25*60*1000+5]);
  assert.ok(ids.every(id=>a.delays[id]!==undefined),'both are one-shot timeouts, no repeating interval');
  // 400 ms later the shown second has not changed: the screen text stays, the next wake-up is re-aimed at the next second change.
  a.clock.now+=400;
  a.tick();
  assert.equal(a.el('focusClock').textContent,'25:00');
  const after=a.pending().slice(before);
  assert.equal(after.length,2,'old timeouts are replaced, not piled up');
  assert.deepEqual(after.map(id=>a.delays[id]).sort((x,y)=>x-y),[605,25*60*1000-400+5]);
  a.clock.now+=700;
  a.tick();
  assert.equal(a.el('focusClock').textContent,'24:59');
});

test('the end-time timeout finishes the session and leaves no timer running',()=>{
  const a=createApp();
  const before=a.pending().length;
  a.run('focusStartPause()');
  a.clock.now+=25*60*1000+5;
  a.tick();
  assert.equal(a.run('focusRunning'),false);
  assert.equal(a.run('focusHistory().length'),1);
  assert.equal(a.pending().length,before,'both timeouts are cleared after the finish');
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

test('calendar views show weekday names in Sunday-first order and the right weekday',()=>{
  const a=createApp();
  a.run("plannerSelected='2026-05-05';plannerView='month';renderCalendar()");
  assert.match(a.el('calendarContent').innerHTML,/>일<\/div><div class="planner-weekday">월<\/div><div class="planner-weekday">화<\/div>.*>토<\/div>/);
  a.run("plannerView='day';renderCalendar()");
  assert.match(a.el('calendarContent').innerHTML,/2026-05-05 · 화요일의 일정/);
  assert.match(a.el('calendarContent').innerHTML,/05-05 \(화\)/);
  assert.equal(a.run("weekdayOf('2026-05-03')"),0);
  assert.equal(a.run("weekdayOf('2026-05-09')"),6);
});

test('resetting goal progress cancels a pending certificate search and clears the box',()=>{
  const a=createApp();
  const versions=()=>a.run('[certSearchVersion,certScheduleVersion]').join(',');
  a.el('certSearchInput').value='전기기사';a.el('certSearchInput').dataset.code='1150';
  a.run("certSearchController=new AbortController();certScheduleController=new AbortController();globalThis.__s=certSearchController.signal;globalThis.__c=certScheduleController.signal;");
  const before=versions();
  a.run("state.certSchedule={items:[]};resetGoalProgress()");
  assert.notEqual(versions(),before);
  assert.equal(a.run('__s.aborted'),true);
  assert.equal(a.run('__c.aborted'),true);
  assert.equal(a.el('certSearchInput').value,'');
  assert.equal(a.el('certSearchInput').dataset.code,'');
  assert.equal(a.run('state.certSchedule'),null);
});

test('the storage names are unchanged and written only through the constants',()=>{
  const a=createApp();
  assert.equal(a.run('STORAGE_KEY'),'lifeAIPrototypeV5');
  assert.equal(a.run('DAMAGED_KEY'),'lifeAIPrototypeV5.damaged');
  const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
  assert.equal(html.split('lifeAIPrototypeV5').length-1,1,'the key text must appear only in the constant');
});

test('koreaToday follows the clock and uses the shared Korea date rule',()=>{
  const a=createApp(undefined,{now:Date.parse('2026-05-10T14:59:00Z')});
  assert.equal(a.run('koreaToday()'),'2026-05-10');
  a.clock.now=Date.parse('2026-05-10T15:01:00Z');
  assert.equal(a.run('koreaToday()'),'2026-05-11');
  assert.equal(a.run('koreaToday()'),a.run('LifeLogic.koreaDate(Date.now())'));
});

test('go() sends the old job screens to the job hub',()=>{
  const a=createApp();
  a.run("globalThis.__hub=0;renderJobHub=()=>{globalThis.__hub++;}");
  a.run("go('jobDetail')");
  a.run("go('prepare')");
  assert.equal(a.run('globalThis.__hub'),2);
  a.run("go('jobHub')");
  assert.equal(a.run('globalThis.__hub'),3);
  a.run("go('home')");
  assert.equal(a.run('globalThis.__hub'),3);
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

test('editing one occurrence with a repeat chosen saves it as one-off and says so',async()=>{
  const a=createApp(undefined,{choice:'one'});
  a.run("state.plannerEntries=[{id:'d',title:'운동',date:'2026-05-01',repeat:'daily'}]");
  a.run("plannerEdit('d','2026-05-05')");
  fillForm(a,{title:'병원',date:'2026-05-05',repeat:'weekly',until:'2026-06-01'});
  await a.run('plannerSave()');
  const created=JSON.parse(a.run("JSON.stringify(state.plannerEntries.find(e=>e.title==='병원'))"));
  assert.equal(created.repeat,'none');
  assert.equal(created.until,'');
  assert.match(a.toasts.at(-1),/반복은 적용되지 않아요/);
  assert.deepEqual(titles(a,'2026-05-12'),['운동']);
  const plain=createApp(undefined,{choice:'one'});
  plain.run("state.plannerEntries=[{id:'d',title:'운동',date:'2026-05-01',repeat:'daily'}]");
  plain.run("plannerEdit('d','2026-05-05')");
  fillForm(plain,{title:'병원',date:'2026-05-05',repeat:'none'});
  await plain.run('plannerSave()');
  assert.doesNotMatch(plain.toasts.at(-1),/반복은 적용되지 않아요/);
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

const dateInForm=a=>a.el('calendarContent').innerHTML.match(/id="plannerDate"[^>]*value="([^"]*)"/)[1];

test('editing a repeating item shows the tapped day in the date field, not the series start',()=>{
  const a=createApp();
  a.run("state.plannerEntries=[{id:'w',title:'스터디',date:'2026-10-02',repeat:'weekly'}]");
  a.run("plannerEdit('w','2026-11-20')");
  assert.equal(dateInForm(a),'2026-11-20');
  // a one-off item still shows its own date
  a.run("state.plannerEntries.push({id:'o',title:'치과',date:'2026-11-25',repeat:'none'});plannerEdit('o','2026-11-25')");
  assert.equal(dateInForm(a),'2026-11-25');
});

test('saving "this one only" on a repeating item moves just that day, not a past day',async()=>{
  const a=createApp(undefined,{choice:'one'});
  a.run("state.plannerEntries=[{id:'w',title:'스터디',date:'2026-10-02',repeat:'weekly'}]");
  a.run("plannerEdit('w','2026-11-20')");
  fillForm(a,{title:'스터디(변경)',date:dateInForm(a),time:'19:00',repeat:'weekly'});
  a.el('plannerRepeat').value='none';
  await a.run('plannerSave()');
  assert.deepEqual(titles(a,'2026-11-20'),['스터디(변경)']);
  assert.deepEqual(titles(a,'2026-10-02'),['스터디']);
  assert.deepEqual(titles(a,'2026-11-13'),['스터디']);
});

test('saving "all" with the date field untouched keeps the series start date',async()=>{
  const a=createApp(undefined,{choice:'all'});
  a.run("state.plannerEntries=[{id:'w',title:'스터디',date:'2026-10-02',repeat:'weekly'}]");
  a.run("plannerEdit('w','2026-11-20')");
  fillForm(a,{title:'스터디2',date:dateInForm(a),repeat:'weekly'});
  await a.run('plannerSave()');
  assert.equal(a.run('state.plannerEntries.length'),1);
  assert.equal(a.run('state.plannerEntries[0].date'),'2026-10-02');
  assert.deepEqual(titles(a,'2026-10-09'),['스터디2']);
});

test('only interested/preparing job postings show their deadline in the planner',()=>{
  const a=createApp();
  const mk=(id,stage)=>({id,company:'회사'+id,title:'공고',deadline:'2026-05-12',...(stage?{stage}:{})});
  a.run(`state.jobPostings=${JSON.stringify([mk('a','관심'),mk('b','준비 중'),mk('c',''),mk('d','지원 완료'),mk('e','불합격'),mk('f','지원 취소'),mk('g','면접')])}`);
  const got=titles(a,'2026-05-12');
  assert.deepEqual(got.map(t=>t.slice(0,3)).sort(),['회사a','회사b','회사c']);
});

/* ---------- adding a new item and input checks (#54) ---------- */
test('a new one-off item is added with the form values and a saved notice',async()=>{
  const a=createApp();
  fillForm(a,{title:'치과',date:'2026-05-12',time:'09:30',category:'personal',priority:'high'});
  await a.run('plannerSave()');
  assert.equal(a.run('state.plannerEntries.length'),1);
  const item=a.saved().plannerEntries[0];
  assert.equal(item.title,'치과');assert.equal(item.date,'2026-05-12');assert.equal(item.time,'09:30');
  assert.equal(item.repeat,'none');assert.equal(item.priority,'high');assert.equal(item.done,false);
  assert.ok(item.id);
  assert.deepEqual(titles(a,'2026-05-12'),['치과']);
  assert.deepEqual(titles(a,'2026-05-13'),[]);
  assert.match(a.toasts.at(-1),/일정을 저장했어요/);
});

test('new daily, weekly and monthly items are saved and show on the right days',async()=>{
  const a=createApp();
  fillForm(a,{title:'매일 운동',date:'2026-05-04',repeat:'daily'});await a.run('plannerSave()');
  fillForm(a,{title:'주간 회의',date:'2026-05-04',repeat:'weekly'});await a.run('plannerSave()');
  fillForm(a,{title:'월세',date:'2026-05-04',repeat:'monthly'});await a.run('plannerSave()');
  assert.equal(a.run('state.plannerEntries.length'),3);
  assert.deepEqual(a.saved().plannerEntries.map(e=>e.repeat),['daily','weekly','monthly']);
  assert.deepEqual(titles(a,'2026-05-05'),['매일 운동']);
  assert.deepEqual(titles(a,'2026-05-11').sort(),['매일 운동','주간 회의'].sort());
  assert.deepEqual(titles(a,'2026-06-04').sort(),['매일 운동','월세'].sort());
  assert.deepEqual(titles(a,'2026-05-04').sort(),['매일 운동','월세','주간 회의'].sort());
});

test('a repeat end date stops the repeat after that day',async()=>{
  const a=createApp();
  fillForm(a,{title:'스터디',date:'2026-05-01',repeat:'daily',until:'2026-05-03'});
  await a.run('plannerSave()');
  assert.equal(a.run('state.plannerEntries.length'),1);
  assert.equal(a.saved().plannerEntries[0].until,'2026-05-03');
  assert.deepEqual(titles(a,'2026-05-03'),['스터디']);
  assert.deepEqual(titles(a,'2026-05-04'),[]);
});

test('a title of exactly 120 characters is accepted',async()=>{
  const a=createApp();
  fillForm(a,{title:'가'.repeat(120),date:'2026-05-12'});
  await a.run('plannerSave()');
  assert.equal(a.run('state.plannerEntries.length'),1);
  assert.equal(a.run('state.plannerEntries[0].title.length'),120);
});

test('invalid input is refused: nothing is saved and the user is told why',async()=>{
  const bad=[
    ['empty title',{title:'',date:'2026-05-12'},/제목\(120자 이하\)과 날짜/],
    ['blank title',{title:'   ',date:'2026-05-12'},/제목\(120자 이하\)과 날짜/],
    ['121 character title',{title:'가'.repeat(121),date:'2026-05-12'},/제목\(120자 이하\)과 날짜/],
    ['missing date',{title:'치과',date:''},/제목\(120자 이하\)과 날짜/],
    ['date that does not exist',{title:'치과',date:'2026-02-30'},/제목\(120자 이하\)과 날짜/],
    ['date in the wrong format',{title:'치과',date:'2026/05/12'},/제목\(120자 이하\)과 날짜/],
    ['end date before the start date',{title:'치과',date:'2026-05-12',repeat:'daily',until:'2026-05-11'},/반복 종료일을 확인/],
    ['end date that does not exist',{title:'치과',date:'2026-05-12',repeat:'daily',until:'2026-02-30'},/반복 종료일을 확인/]
  ];
  for(const [name,form,message] of bad){
    const a=createApp();
    fillForm(a,form);
    await a.run('plannerSave()');
    assert.equal(a.run('plannerEntries().length'),0,name+': no item added');
    assert.equal(a.storage.has('lifeAIPrototypeV5')&&(a.saved().plannerEntries||[]).length>0,false,name+': nothing stored');
    assert.equal(a.toasts.length,1,name+': one notice');
    assert.match(a.toasts[0],message,name);
  }
});

test('a refused edit leaves the existing item unchanged',async()=>{
  const a=createApp();
  a.run("state.plannerEntries=[{id:'x',title:'치과',date:'2026-05-12',repeat:'none'}]");
  a.run("plannerEdit('x','2026-05-12')");
  fillForm(a,{title:'',date:'2026-05-12'});
  await a.run('plannerSave()');
  assert.equal(a.run('state.plannerEntries[0].title'),'치과');
  assert.match(a.toasts.at(-1),/확인해 주세요/);
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
  assert.equal(a.storage.get('lifeAIPrototypeV5.damaged.2026-05-10'),raw);
  assert.match(a.run('startupNotice'),/남겨 두었어요/);
});

test('unreadable saved data starts fresh but is preserved',()=>{
  const a=createApp('{not json');
  assert.equal(a.run('state.mainGoal'),'');
  assert.equal(a.storage.get('lifeAIPrototypeV5.damaged.2026-05-10'),'{not json');
});

test('damaged original: honest notice when keeping fails, never overwrites an earlier original, can be downloaded',()=>{
  // storage full: the original cannot be kept, so the notice must not claim it was
  const full=createApp('{not json',{failSave:true});
  assert.doesNotMatch(full.run('startupNotice'),/남겨 두었어요/);
  assert.match(full.run('startupNotice'),/보관하지 못했어요/);
  // a second damage event on the same day keeps both originals
  const b=createApp('{first bad');
  b.run("archiveDamagedState('{second bad');archiveDamagedState('{third bad')");
  const raws=Array.from(b.run('damagedArchives()').map(x=>x.raw)).sort();
  assert.deepEqual(raws,['{first bad','{second bad','{third bad']);
  // the same original is not stored twice
  b.run("archiveDamagedState('{third bad')");
  assert.equal(b.run('damagedArchives().length'),3);
  // MY screen offers the download only when there is something to download, and the file holds the raw text
  assert.match(b.run('(renderMy(),document.getElementById("myContent").innerHTML)'),/손상된 원본 내려받기/);
  let blobText='';
  b.context.Blob=class{constructor(parts){blobText=parts.join('');}};
  b.context.URL={createObjectURL:()=>'blob:x',revokeObjectURL(){}};
  const link={click(){this.clicked=true;},remove(){}};
  b.context.document.createElement=()=>link;b.context.document.body={appendChild(){}};
  b.run('downloadDamagedState()');
  assert.equal(link.clicked,true);assert.match(link.download,/^life-ai-damaged-.*\.json$/);
  assert.deepEqual(JSON.parse(blobText).archives.map(x=>x.raw).sort(),raws);
  const clean=createApp(JSON.stringify({mainGoal:'x'}));
  assert.doesNotMatch(clean.run('(renderMy(),document.getElementById("myContent").innerHTML)'),/손상된 원본 내려받기/);
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
  assert.doesNotMatch(status(a),/찾지 못했어요/,'a deadline that was found but is past must not also be reported as not found');
});

test('a past deadline does not open the paste box, a missing deadline still does',async()=>{
  const run=async body=>{
    let opened=false;
    const a=createApp(undefined,{now:Date.parse('2026-11-16T03:00:00Z'),fetch:reply({ok:true,title:'정비 신입',company:'현대제철',...body})});
    a.el('postingPaste').closest=()=>({set open(v){opened=v;}});
    a.el('postingUrl').value='https://example.com/job/7';
    await a.run('fillPostingFromUrl()');
    return {opened,text:status(a),deadline:a.el('postingDeadline').value};
  };
  const past=await run({deadline:'2026-10-01',description:''});
  assert.equal(past.opened,false);assert.match(past.text,/이미 지났어요/);assert.equal(past.deadline,'');
  const pastInText=await run({description:'접수 마감 2026.10.20'});
  assert.equal(pastInText.opened,false);assert.doesNotMatch(pastInText.text,/찾지 못했어요/);
  const none=await run({description:''});
  assert.equal(none.opened,true);assert.match(none.text,/마감일은 링크에서 찾지 못했어요/);
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

test('a code error while reading a link is not shown as an internet problem',async()=>{
  const a=createApp(undefined,{fetch:async()=>({ok:true,json:async()=>null})});
  a.el('postingUrl').value='https://example.com/x';
  await a.run('fillPostingFromUrl()');
  assert.doesNotMatch(status(a),/인터넷/);
  assert.match(status(a),/링크를 읽지 못했어요/);
  assert.equal(a.el('postingFetch').disabled,false);
});

test('reading a link works in browsers without AbortSignal.timeout and aborts a hung request',async()=>{
  let signal;
  const a=createApp(undefined,{fetch:async(url,opts)=>{signal=opts.signal;return {ok:true,json:async()=>({ok:true,title:'안전관리',deadline:'2026-12-05'})};}});
  a.run('AbortSignal={}');
  a.el('postingUrl').value='https://example.com/x';
  await a.run('fillPostingFromUrl()');
  assert.equal(a.el('postingDeadline').value,'2026-12-05');
  assert.ok(signal&&typeof signal.aborted==='boolean');
  const hung=createApp(undefined,{fetch:(url,opts)=>new Promise((resolve,reject)=>{opts.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));})});
  hung.run('setTimeout=(fn)=>{Promise.resolve().then(fn);return 1;}');
  hung.el('postingUrl').value='https://example.com/x';
  await hung.run('fillPostingFromUrl()');
  assert.match(status(hung),/인터넷 연결을 확인/);
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

test('a link shared from the phone fills the form but only contacts the server after the button is pressed',async()=>{
  const urls=[];
  const a=createApp(undefined,{now:Date.parse('2026-11-16T03:00:00Z'),search:'?title='+encodeURIComponent('삼천리 시설관리')+'&text='+encodeURIComponent('보세요 https://example.com/job/9'),
    fetch:async url=>{urls.push(url);return {ok:true,json:async()=>({ok:true,title:'삼천리 시설관리 신입',company:'삼천리',deadline:'2026-12-20',description:''})};}});
  await new Promise(r=>setImmediate(r));
  assert.equal(a.el('postingUrl').value,'https://example.com/job/9');
  assert.equal(a.el('postingTitle').value,'삼천리 시설관리');
  assert.equal(urls.length,0,'opening the app from a link never contacts the server by itself');
  assert.equal(a.el('postingCompany').value,'');
  assert.equal(a.el('postingDeadline').value,'');
  assert.match(a.el('postingFetchStatus').textContent,/링크에서 정보 가져오기/);
  assert.equal(a.historyCalls.length,1,'share parameters are removed so a reload does not repeat it');
  assert.equal(a.el('postingEditor').open,true);
  await a.run('fillPostingFromUrl()');
  assert.equal(urls.length,1,'the button sends the request');
  assert.equal(a.el('postingTitle').value,'삼천리 시설관리 신입','the real page title replaces the text that came with the share');
  assert.equal(a.el('postingCompany').value,'삼천리');
  assert.equal(a.el('postingDeadline').value,'2026-12-20');
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

test('MY shows the goal type in Korean, never the internal code',()=>{
  const names={job:'취업',cert:'자격증',policy:'지원사업',custom:'직접 입력'};
  for(const [code,name] of Object.entries(names)){
    const a=createApp(JSON.stringify({mainGoal:'x',goalType:code}));a.run('renderMy()');
    assert.ok(a.el('myContent').innerHTML.includes('<strong>목표 유형</strong><p class="meta">'+name+'</p>'),code);
    assert.ok(!a.el('myContent').innerHTML.includes('<p class="meta">'+code+'</p>'),code);
  }
  const none=createApp();none.run('renderMy()');
  assert.ok(none.el('myContent').innerHTML.includes('<strong>목표 유형</strong><p class="meta">미설정</p>'));
  const odd=createApp(JSON.stringify({mainGoal:'x',goalType:'constructor'}));odd.run('renderMy()');
  assert.ok(odd.el('myContent').innerHTML.includes('<strong>목표 유형</strong><p class="meta">미설정</p>'));
});

test('MY no longer shows the leftover demo test questions',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',goalType:'cert'}));a.run('renderMy()');
  const html=a.el('myContent').innerHTML;
  assert.ok(!html.includes('테스트하면서 생각해볼 것'));
  assert.ok(!html.includes('무슨 앱인지 알겠나요'));
  assert.ok(html.includes('처음부터 다시 시작'),'the rest of MY is still rendered');
});

test('MY shows when the last backup was made',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',lastBackupAt:'2026-05-01T01:00:00.000Z'}));
  a.run('renderMy()');
  assert.ok(a.el('myContent').innerHTML.includes('마지막 백업:</strong> 2026-05-01'));
  const b=createApp();b.run('renderMy()');
  assert.ok(b.el('myContent').innerHTML.includes('마지막 백업:</strong> 아직 없음'));
});

/* A fake fetch whose answers are released by hand, so a test can finish the second request before the first. */
function manualFetch(){
  const pending=[];
  const fetchImpl=url=>new Promise(resolve=>pending.push({url,release:body=>resolve({ok:true,json:async()=>body})}));
  return {fetchImpl,pending};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('a slow, older Work24 answer does not overwrite the newer search result',async()=>{
  const {fetchImpl,pending}=manualFetch();
  const a=createApp(JSON.stringify({mainGoal:'삼천리 정비 취업'}),{fetch:fetchImpl});
  a.run('loadLiveJobs()');
  a.run("state.mainGoal='포스코 설비 취업';loadLiveJobs()");
  assert.equal(pending.length,2);
  pending[1].release({source:'고용24',items:[{company:'포스코',title:'새 검색 결과',closeDt:'2099-01-01'}]});
  await settle();
  pending[0].release({source:'고용24',items:[{company:'삼천리',title:'늦게 온 이전 결과',closeDt:'2099-01-01'}]});
  await settle();
  const shown=a.el('liveJobResults').innerHTML;
  assert.ok(shown.includes('새 검색 결과'),'the newer result is on screen');
  assert.ok(!shown.includes('늦게 온 이전 결과'),'the late older answer is dropped');
});

test('a slow, older Q-Net schedule answer does not replace the schedule of the chosen certificate',async()=>{
  const {fetchImpl,pending}=manualFetch();
  const a=createApp(JSON.stringify({mainGoal:'위험물산업기사 준비',goalType:'cert',parsedGoal:{subject:'위험물산업기사'}}),{fetch:fetchImpl});
  a.el('certSearchInput').value='전기기사';
  a.run('loadLiveCertSchedule()');
  a.el('certSearchInput').value='위험물산업기사';
  a.run('loadLiveCertSchedule()');
  assert.equal(pending.length,2);
  const answer=name=>({qualification:{name,code:'1'},items:[{label:'시험'}],rounds:[{round:'1회',events:[{label:name+' 시험',startDate:'2026-05-01'}]}]});
  pending[1].release(answer('위험물산업기사'));
  await settle();
  pending[0].release(answer('전기기사'));
  await settle();
  assert.equal(a.run('state.certSchedule.qualification.name'),'위험물산업기사','saved schedule is the newer one');
  assert.ok(a.el('liveCertResults').innerHTML.includes('위험물산업기사 시험'));
  assert.ok(!a.el('liveCertResults').innerHTML.includes('전기기사 시험'),'the late older answer is not drawn');
});

const postingsApp=postings=>createApp(JSON.stringify({mainGoal:'x',jobPostings:postings}));
const posting=(id,extra={})=>({id,company:'회사'+id,title:'공고'+id,url:'https://example.com/'+id,stage:'관심',tasks:[false,false,false,false],deadline:'2099-01-01',...extra});

test('a saved posting card shows its apply status and how many prep items are done',()=>{
  const a=postingsApp([posting('a',{stage:'면접',tasks:[true,true,false,true]}),posting('b')]);
  a.run('renderJobHub()');
  const html=a.el('savedPostings').innerHTML;
  assert.ok(html.includes('>면접 · 준비 3/4<'),'interview, 3 of 4 checked');
  assert.ok(html.includes('>관심 · 준비 0/4<'),'a fresh posting starts at 0/4');
});

test('ticking a prep checkbox updates the card text without redrawing the list',()=>{
  const a=postingsApp([posting('a')]);
  a.run('renderJobHub()');
  const span={dataset:{id:'a'},innerHTML:''};
  a.context.document.querySelectorAll=sel=>sel==='.posting-progress'?[span]:[];
  a.run("setPostingTask('a',1,true);setPostingTask('a',2,true)");
  assert.equal(span.innerHTML,'관심 · 준비 2/4');
});

test('finished postings are folded away so the postings to act on stay on top, and no data changes',()=>{
  const list=[
    posting('live'),
    posting('applied',{stage:'지원 완료',deadline:'2020-01-01'}),
    posting('interview',{stage:'면접',deadline:'2020-01-01'}),
    posting('nodate',{deadline:''}),
    posting('rejected',{stage:'불합격'}),
    posting('cancelled',{stage:'지원 취소'}),
    posting('passed',{stage:'합격'}),
    posting('expired',{stage:'준비 중',deadline:'2020-01-01'})
  ];
  const a=postingsApp(list);
  a.run('renderJobHub()');
  const html=a.el('savedPostings').innerHTML;
  const split=html.search(/<details\s+ontoggle/);
  assert.ok(split>0,'a folded area exists');
  const top=html.slice(0,split),folded=html.slice(split);
  for(const name of ['live','applied','interview','nodate'])assert.ok(top.includes('회사'+name+' '),name+' stays on top (still in progress)');
  for(const name of ['rejected','cancelled','passed','expired'])assert.ok(folded.includes('회사'+name+' ')&&!top.includes('회사'+name+' '),name+' is folded');
  assert.match(folded,/끝난 공고 4개/);
  assert.equal(a.run('state.jobPostings.length'),8,'the saved data is untouched');
  assert.equal(a.run("state.jobPostings.find(x=>x.id==='rejected').stage"),'불합격');

  const none=postingsApp([posting('live')]);none.run('renderJobHub()');
  assert.ok(!none.el('savedPostings').innerHTML.includes('끝난 공고'),'no folded area when nothing has ended');
  const onlyEnded=postingsApp([posting('x',{stage:'불합격'})]);onlyEnded.run('renderJobHub()');
  assert.ok(onlyEnded.el('savedPostings').innerHTML.includes('끝난 공고 1개'));
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

/* ---------- phone Back gesture keeps the app open ---------- */
test('screen changes leave history entries; bottom menu and the first screen only replace',()=>{
  const a=createApp(undefined,{trackHistory:true});
  const log=()=>JSON.parse(JSON.stringify(a.historyLog));
  assert.deepEqual(log(),[{type:'replace',state:{screen:'start'}}],'first screen is recorded without adding an entry');
  a.run("go('calendar')");
  a.run("go('jobHub')");
  assert.deepEqual(log().slice(1),[{type:'push',state:{screen:'calendar'}},{type:'push',state:{screen:'jobHub'}}]);
  a.run("go('my','replace')");
  assert.deepEqual(log().at(-1),{type:'replace',state:{screen:'my'}});
  const before=a.historyLog.length;
  a.run("go('my')");
  assert.equal(a.historyLog.at(-1).type,'replace','showing the same screen again does not stack entries');
  assert.equal(a.historyLog.length,before+1);
});

test('the browser Back (popstate) shows the earlier screen without adding history',()=>{
  const a=createApp(undefined,{trackHistory:true});
  a.run("go('calendar')");a.run("go('jobHub')");
  const count=a.historyLog.length;
  a.run("onScreenPopState({state:{screen:'calendar'}})");
  assert.equal(a.run('currentScreen'),'calendar');
  assert.equal(a.historyLog.length,count,'going back must not push or replace');
  // entries without a screen name (or an unknown one) are ignored
  a.run("onScreenPopState({state:null});onScreenPopState({state:{screen:'nope'}})");
  assert.equal(a.run('currentScreen'),'calendar');
});

test('bottom menu buttons switch tabs without stacking history',()=>{
  const {html}=require('./helpers/app-harness.js');
  for(const id of ['home','opportunities','goals','calendar','my'])assert.ok(html.includes(`onclick="go('${id}','replace')"`),id);
});

/* ---------- two tabs open at once ---------- */
test('when another tab saves new records, this tab re-reads them instead of overwriting later',()=>{
  const a=createApp(undefined,{search:''});
  a.flushTimeouts();
  a.run("onStateStorageEvent({key:'lifeAIPrototypeV5.damaged',newValue:'x',oldValue:null})");
  a.run("onStateStorageEvent({key:'lifeAIPrototypeV5',newValue:'same',oldValue:'same'})");
  a.flushTimeouts();
  assert.equal(a.reloads,0,'unrelated keys and unchanged values are ignored');
  a.run("onStateStorageEvent({key:'lifeAIPrototypeV5',newValue:'{\"habits\":[]}',oldValue:'{}'})");
  assert.match(a.toasts.at(-1),/다른 창에서 기록이 바뀌었어요/);
  a.run("onStateStorageEvent({key:'lifeAIPrototypeV5',newValue:'{\"habits\":[1]}',oldValue:'{\"habits\":[]}'})");
  a.flushTimeouts();
  assert.equal(a.reloads,1,'reloads once even if several changes arrive together');
  // storage cleared in another tab
  const b=createApp(undefined,{search:''});
  b.run('onStateStorageEvent({key:null,newValue:null,oldValue:null})');b.flushTimeouts();
  assert.equal(b.reloads,1);
});

test('the app listens for the storage event',()=>{
  const {script}=require('./helpers/app-harness.js');
  assert.match(script,/window\.addEventListener\('storage',onStateStorageEvent\)/);
});

/* ---------- save failure must not look like success ---------- */
const saveFourThings=async a=>{
  a.run('plannerOpenForm()');
  fillForm(a,{title:'치과',date:'2026-05-12'});
  await a.run('plannerSave()');
  a.el('habitName').value='물 마시기';a.run('habitAdd()');
  a.el('watchCompany').value='삼천리';a.run('addWatchCompany()');
  a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='https://example.com/jobs/1';
  a.run('savePosting()');
};

test('a failed save never shows a "saved" message for planner, habit, posting or watched company',async()=>{
  const a=createApp(undefined,{failSave:true});
  await saveFourThings(a);
  assert.equal(a.toasts.filter(t=>/저장했어요|추가했어요/.test(t)).length,0,a.toasts.join('|'));
  assert.ok(a.toasts.some(t=>/저장하지 못했어요/.test(t)),'the failure notice is shown');
});

test('a failed save shows a lasting banner with a backup button, and the next good save hides it',()=>{
  const {html}=require('./helpers/app-harness.js');
  assert.match(html,/id="saveFailBanner"[^>]*hidden[\s\S]*?exportLifeAIBackup\(\)">지금 백업/);
  const opts={failSave:true};
  const a=createApp(undefined,opts);
  a.run('persistState()');
  assert.equal(a.el('saveFailBanner').hidden,false);
  // the banner does not depend on the one-time toast: a second failure keeps it visible
  a.run('persistState()');
  assert.equal(a.el('saveFailBanner').hidden,false);
  opts.failSave=false;
  assert.equal(a.run('persistState()'),true);
  assert.equal(a.el('saveFailBanner').hidden,true);
});

test('a successful save still shows the confirmation',async()=>{
  const a=createApp();
  await saveFourThings(a);
  for(const word of ['일정을 저장했어요.','습관을 추가했어요.','관심 회사를 저장했어요.','공고와 마감일을 저장했어요.'])assert.ok(a.toasts.includes(word),word);
});

/* ---------- goal text is escaped in opportunity cards (#32) ---------- */
test('goal text with HTML characters is shown as plain text in opportunity cards and the goal summary',()=>{
  const evil='<img src=x onerror=alert(1)>';
  for(const goalType of ['policy','other']){
    const a=createApp(JSON.stringify({mainGoal:evil,goalType}));
    const html=a.run('opportunityCards()');
    assert.ok(!html.includes('<img'),goalType+' card must not contain a raw tag');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'),goalType+' card shows the text');
  }
  const b=createApp(JSON.stringify({mainGoal:'<b>test</b>',goalType:'other'}));
  b.run('state.parsedGoal=null');
  const u=b.run('understandingHTML()');
  assert.ok(!u.includes('<b>test'));
  assert.ok(u.includes('&lt;b&gt;test&lt;/b&gt;'));
});

/* ---------- phone calendar: count instead of tiny titles (#31) ---------- */
test('month calendar cells show an event count, and the phone CSS hides the 9px titles',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',plannerEntries:[
    {id:'a',title:'첫째',date:'2026-05-12'},{id:'b',title:'둘째',date:'2026-05-12'},{id:'c',title:'셋째',date:'2026-05-12'},
    {id:'d',title:'하나',date:'2026-05-13'}]}));
  a.run('plannerView="month";renderCalendar()');
  const h=a.el('calendarContent').innerHTML;
  assert.ok(h.includes('aria-hidden="true">●3<'),'3 events on the 12th, even though only 2 titles fit');
  assert.ok(h.includes('aria-hidden="true">●1<'));
  assert.ok(h.includes('일정 3개')&&h.includes('일정 1개'),'the day button itself says how many events (read by screen readers)');
  assert.equal((h.match(/class="dot-count"/g)||[]).length,2,'days without events get no count');
  const {html}=require('./helpers/app-harness.js');
  const phone=html.match(/@media\(max-width:520px\)\{[^\n]*planner-day[^\n]*/)[0];
  assert.match(phone,/\.planner-day \.dot\{display:none\}/);
  assert.match(phone,/\.planner-day \.dot-count\{display:block\}/);
  assert.match(html,/\.bottomnav button\{[^}]*font-size:1[2-3]px/);
});

/* ---------- slow connections give up after 15 seconds (#45) ---------- */
// A fake fetch that never answers on its own but obeys the abort signal, like the real one.
const hangingFetch=(seen)=>(url,options)=>new Promise((_,reject)=>{
  seen.push(options.signal);
  if(options.signal.aborted)return reject(options.signal.reason);
  options.signal.addEventListener('abort',()=>reject(options.signal.reason));
});
// Make the 15-second timer fire at once so the test does not wait.
const expireTimeoutNow=a=>{a.context.AbortSignal={timeout:()=>AbortSignal.abort(new DOMException('timed out','TimeoutError')),any:s=>AbortSignal.any(s)};};

test('job search that never answers shows a slow-connection notice with a retry button',async()=>{
  const seen=[];
  const a=createApp(undefined,{fetch:hangingFetch(seen)});
  a.run("state.mainGoal='시설관리 신입'");
  expireTimeoutNow(a);
  await a.run('loadLiveJobs()');
  assert.equal(seen.length,1);
  assert.match(a.el('liveJobStatus').innerHTML,/연결이 느려요/);
  assert.match(a.el('liveJobStatus').innerHTML,/loadLiveJobs\(\)/,'retry button is shown');
  assert.doesNotMatch(a.el('liveJobStatus').innerHTML,/WORK24_AUTH_KEY/);
});

test('job search request has a 15 second limit that a newer search can still cancel',async()=>{
  const seen=[];
  const a=createApp(undefined,{fetch:hangingFetch(seen)});
  a.run("state.mainGoal='시설관리 신입'");
  const first=a.run('loadLiveJobs()');
  a.run('loadLiveJobs()'); // the second search cancels the first one
  await first;
  assert.equal(seen[0].aborted,true);
  assert.equal(seen[0].reason.name,'AbortError');
  assert.equal(seen[1].aborted,false,'the newer search keeps waiting');
  assert.doesNotMatch(a.el('liveJobStatus').innerHTML,/연결이 느려요/,'a cancelled search shows no error');
});

test('cert schedule and cert name search also give up with a retry button',async()=>{
  const seen=[];
  const a=createApp(undefined,{fetch:hangingFetch(seen)});
  expireTimeoutNow(a);
  a.el('certSearchInput').value='전기기사';
  await a.run('loadLiveCertSchedule()');
  assert.match(a.el('liveCertStatus').innerHTML,/연결이 느려요/);
  assert.match(a.el('liveCertStatus').innerHTML,/loadLiveCertSchedule\(\)/);
  a.context.setTimeout=fn=>{fn();return 0;};
  a.run('searchCertNames()');
  await new Promise(r=>setImmediate(r));
  assert.match(a.el('certSearchMatches').innerHTML,/연결이 느려요/);
  assert.match(a.el('certSearchMatches').innerHTML,/searchCertNames\(\)/);
});

test('a server error message still shows as before, not the slow notice',async()=>{
  const a=createApp(undefined,{fetch:reply({message:'인증키 문제'},false)});
  a.el('certSearchInput').value='전기기사';
  await a.run('loadLiveCertSchedule()');
  assert.match(a.el('liveCertStatus').innerHTML,/인증키 문제/);
  assert.doesNotMatch(a.el('liveCertStatus').innerHTML,/연결이 느려요/);
});

/* ---------- #33: typed company/job/career/cert text must not become HTML ---------- */
test('company, job, career, education and certificate text is escaped on the goal-created and MY screens',()=>{
  const evil='<img src=x onerror=alert(1)>';
  const a=createApp(JSON.stringify({mainGoal:'x',goalType:'job',selectedCompany:evil,selectedJob:'<script>x</script>',employmentStatus:'<b>',career:'<i>c</i>',education:'<u>e</u>',ownedCert:'<svg onload=1>'}));
  a.run('renderMy()');
  const my=a.el('myContent').innerHTML;
  assert.ok(!/<(img|script|b|i|u|svg)\b/.test(my),my);
  assert.ok(my.includes('&lt;img src=x onerror=alert(1)&gt;')&&my.includes('&lt;script&gt;x&lt;/script&gt;')&&my.includes('&lt;svg onload=1&gt;'));
  const understanding=a.run('understandingHTML()');
  assert.ok(!/<(img|script)\b/.test(understanding),understanding);
  assert.ok(understanding.includes('&lt;script&gt;x&lt;/script&gt;'));
  a.run('finishGoalCreation()');
  const plan=a.el('goalPlanPreview').innerHTML;
  assert.ok(!/<(img|script)\b/.test(plan),plan);
  assert.ok(plan.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

/* ---------- backup file contents ---------- */
// Fakes the browser pieces exportLifeAIBackup needs and returns the JSON text of the backup file it "downloads".
function captureBackup(a,failBlob){
  const out={text:null};
  a.context.Blob=class{constructor(parts){if(failBlob)throw new Error('blob');out.text=parts.join('');}};
  a.context.URL={createObjectURL:()=>'blob:x',revokeObjectURL(){}};
  a.context.document.createElement=()=>({click(){},remove(){}});
  a.context.document.body={appendChild(){}};
  return out;
}

test('the backup file holds the date of this very backup, even the first one',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',lastBackupAt:'2026-04-01T00:00:00.000Z'}));
  const out=captureBackup(a);
  a.run('exportLifeAIBackup()');
  const file=JSON.parse(out.text);
  assert.equal(file.state.lastBackupAt,file.exportedAt);
  assert.equal(a.saved().lastBackupAt,file.exportedAt);
  const first=createApp();const firstOut=captureBackup(first);
  first.run('exportLifeAIBackup()');
  const firstFile=JSON.parse(firstOut.text);
  assert.equal(firstFile.state.lastBackupAt,firstFile.exportedAt,'first backup has a date too');
  // restoring that file must not trigger the "never backed up" reminder
  const restored=createApp(JSON.stringify(firstFile.state));
  assert.equal(restored.run('LifeLogic.backupNudge(state,Date.now())'),null);
});

test('a backup made while the timer runs has no timer, and restoring it later records no fake focus',async()=>{
  const a=createApp();
  a.run('focusStartPause()');
  assert.equal(a.saved().focusRun.status,'running');
  const out=captureBackup(a);
  a.run('exportLifeAIBackup()');
  const file=JSON.parse(out.text);
  assert.equal('focusRun' in file.state,false);
  assert.equal(a.saved().focusRun.status,'running','the live timer itself keeps running');
  // an older file that still contains a finished-looking timer is cleaned on restore
  const old=JSON.parse(out.text);
  old.state.focusRun={status:'running',deadline:Date.parse('2026-05-10T03:25:00Z'),minutes:25,category:'study'};
  const b=createApp(undefined,{search:'',now:Date.parse('2026-06-20T03:00:00Z')});
  b.context.location.reload=()=>{};
  const text=JSON.stringify(old);
  await b.run('importLifeAIBackup')({files:[{size:text.length,text:async()=>text}]});
  assert.equal('focusRun' in b.saved(),false);
  const c=createApp(JSON.stringify(b.saved()),{now:Date.parse('2026-06-20T03:00:00Z')});
  assert.equal(c.run('focusHistory().length'),0,'no focus record was invented');
});

test('a failed backup puts the previous last-backup date back',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',lastBackupAt:'2026-04-01T00:00:00.000Z'}));
  captureBackup(a,true);
  a.run('exportLifeAIBackup()');
  assert.equal(a.run('state.lastBackupAt'),'2026-04-01T00:00:00.000Z');
  assert.match(a.toasts[a.toasts.length-1],/만들지 못했어요/);
  const b=createApp();captureBackup(b,true);
  b.run('exportLifeAIBackup()');
  assert.equal(b.run("'lastBackupAt' in state"),false);
});

/* ---------- reset also removes the kept damaged original ---------- */
test('reset removes the main save and the kept damaged original, and the prompt says so',async()=>{
  const a=createApp('{not json',{search:''});
  a.context.location.reload=()=>{};
  // damaged originals are kept under dated names (lifeAIPrototypeV5.damaged.YYYY-MM-DD)
  const damagedKeys=s=>[...s.keys()].filter(k=>k.startsWith('lifeAIPrototypeV5.damaged'));
  assert.equal(damagedKeys(a.storage).length,1);
  assert.equal(a.storage.get(damagedKeys(a.storage)[0]),'{not json');
  await a.run('resetPrototype()');
  assert.equal(a.storage.has('lifeAIPrototypeV5'),false);
  assert.deepEqual(damagedKeys(a.storage),[]);
  assert.match(a.dialogs[a.dialogs.length-1].message,/손상 원본도 함께 지워져요/);
  const b=createApp('{not json',{search:'',confirm:false});
  b.context.location.reload=()=>{};
  await b.run('resetPrototype()');
  assert.equal(b.storage.get(damagedKeys(b.storage)[0]),'{not json','cancelled reset keeps everything');
});

test('offline errors are shown in plain Korean; the env-variable hint only appears when the server key is missing',async()=>{
  const offline=async()=>{throw new TypeError('Failed to fetch');};
  const a=createApp(JSON.stringify({mainGoal:'전기기사',goalType:'job'}),{fetch:offline});
  await a.run('loadLiveJobs()');
  const jobs=a.el('liveJobStatus').innerHTML;
  assert.match(jobs,/인터넷 연결을 확인하고 다시 시도해 주세요/);
  assert.doesNotMatch(jobs,/Failed to fetch|WORK24_AUTH_KEY/);
  const noKey=createApp(JSON.stringify({mainGoal:'전기기사',goalType:'job'}),{fetch:async()=>({ok:false,status:503,json:async()=>({message:'고용24 인증키가 아직 설정되지 않았어요.'})})});
  await noKey.run('loadLiveJobs()');
  assert.match(noKey.el('liveJobStatus').innerHTML,/인증키가 아직 설정되지 않았어요/);
  assert.match(noKey.el('liveJobStatus').innerHTML,/WORK24_AUTH_KEY/);
  const english=createApp(JSON.stringify({mainGoal:'전기기사',goalType:'job'}),{fetch:async()=>({ok:false,status:500,json:async()=>({message:'upstream exploded'})})});
  await english.run('loadLiveJobs()');
  assert.doesNotMatch(english.el('liveJobStatus').innerHTML,/upstream exploded|WORK24_AUTH_KEY/);
  const c=createApp(undefined,{fetch:offline});
  c.el('certYear').value='2026';c.el('certSearchInput').value='전기기사';
  await c.run('loadLiveCertSchedule()');
  assert.match(c.el('liveCertStatus').innerHTML,/인터넷 연결을 확인하고/);
  assert.doesNotMatch(c.el('liveCertStatus').innerHTML,/Failed to fetch/);
  assert.equal(c.run("friendlyErrorMessage(new Error('서버가 준 한국어'),'x')"),'서버가 준 한국어');
  assert.equal(c.run("friendlyErrorMessage(new Error('Load failed'),'대체 문구')"),'대체 문구');
});

test('changing a posting stage keeps open cards open and says it was saved',()=>{
  const a=createApp();
  const row=id=>({id,company:'회사'+id,title:'공고',stage:'관심',url:'https://example.com/'+id,tasks:[false,false,false,false]});
  a.run('state.jobPostings='+JSON.stringify([row('a'),row('b')]));
  const cards=[{dataset:{posting:'a'},open:true},{dataset:{posting:'b'},open:false}];
  let drawn=0;
  a.context.document.querySelectorAll=sel=>{
    if(sel.includes('[open]'))return cards.filter(c=>c.open);
    return cards;
  };
  // A redraw replaces the cards: all closed again until the app reopens them.
  a.context.renderJobHub=()=>{drawn++;cards.forEach(c=>{c.open=false;});};
  a.run("setPostingStage('b','지원 완료')");
  assert.equal(drawn,1);
  assert.equal(a.run("state.jobPostings[1].stage"),'지원 완료');
  assert.deepEqual(cards.map(c=>c.open),[true,true]);
  assert.ok(a.toasts.includes('저장했어요.'));
  a.run("setInterviewDate('a','2099-03-04')");
  assert.equal(a.toasts.filter(t=>t==='저장했어요.').length,2);
});

test('saved posting cards carry their id so they can be reopened after a redraw',()=>{
  const a=createApp();
  a.run("state.jobPostings=[{id:'x1',company:'회사',title:'공고',stage:'관심',url:'https://example.com/1',tasks:[false,false,false,false]}]");
  a.run('renderJobHub()');
  assert.match(a.el('savedPostings').innerHTML,/<details data-posting="x1">/);
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
  assert.match(a.el('calendarContent').innerHTML,/data-id="h" onchange="habitToggle\(this\.dataset\.id,koreaToday\(\)\)"/);
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

test('habit and schedule buttons read ids from data-id, not from inline script text',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',habits:[{id:'h-1',name:'공부',checks:[]}],plannerEntries:[{id:'p-1',title:'치과',date:'2026-05-02',repeat:'none'}]}));
  a.run("plannerSelected='2026-05-02';plannerActiveTab='calendar';renderCalendar()");
  const html=a.el('calendarContent').innerHTML;
  assert.match(html,/data-id="p-1" onclick="plannerToggle\(this\.dataset\.id/);
  assert.match(html,/data-id="p-1" onclick="plannerEdit\(this\.dataset\.id/);
  assert.match(html,/data-id="p-1" onclick="plannerRemove\(this\.dataset\.id/);
  a.run("plannerActiveTab='habits';renderCalendar()");
  const habits=a.el('calendarContent').innerHTML;
  assert.match(habits,/data-id="h-1" onchange="habitToggle\(this\.dataset\.id/);
  assert.match(habits,/data-id="h-1" onclick="habitRemove\(this\.dataset\.id\)"/);
  assert.equal(/habit(Toggle|Remove)\('|planner(Toggle|Edit|Remove)\('/.test(habits+html),false);
});

/* ---------- server answers: friendly Korean errors ---------- */
test('job and exam lookups show Korean messages for HTML answers and a lost connection',async()=>{
  const html=async()=>({ok:false,status:502,json:async()=>{throw new SyntaxError("Unexpected token '<'");}});
  const offline=async()=>{throw new TypeError('Failed to fetch');};
  for(const [fetch,expected] of [[html,/서버 응답을 읽지 못했어요/],[offline,/인터넷 연결을 확인하고 다시 시도해 주세요/]]){
    const jobs=createApp(JSON.stringify({mainGoal:'정비 취업',goalType:'job'}),{fetch});
    await jobs.run('loadLiveJobs()');
    assert.match(jobs.el('liveJobStatus').innerHTML,expected);assert.doesNotMatch(jobs.el('liveJobStatus').innerHTML,/Unexpected|Failed to fetch/);
    const exam=createApp(undefined,{fetch});
    exam.el('certSearchInput').value='전기기사';
    await exam.run('loadLiveCertSchedule()');
    assert.match(exam.el('liveCertStatus').innerHTML,expected);assert.doesNotMatch(exam.el('liveCertStatus').innerHTML,/Unexpected|Failed to fetch/);
  }
});

test('job lookup still shows results and the server message for failures',async()=>{
  const ok=createApp(JSON.stringify({mainGoal:'정비 취업',goalType:'job'}),{fetch:async()=>({ok:true,json:async()=>({source:'고용24',items:[{company:'삼천리',title:'설비정비',url:'https://example.org/1'}]})})});
  await ok.run('loadLiveJobs()');
  assert.match(ok.el('liveJobResults').innerHTML,/설비정비/);
  const bad=createApp(JSON.stringify({mainGoal:'정비 취업',goalType:'job'}),{fetch:async()=>({ok:false,status:503,json:async()=>({message:'고용24 인증키가 아직 설정되지 않았어요.'})})});
  await bad.run('loadLiveJobs()');
  assert.match(bad.el('liveJobStatus').innerHTML,/인증키가 아직/);
});

test('fetchJson lets a cancelled request stay silent instead of showing the connection message',async()=>{
  const a=createApp(undefined,{fetch:async()=>{const e=new Error('aborted');e.name='AbortError';throw e;}});
  const name=await a.run("fetchJson('/x').then(()=>'', e=>e.name)");
  assert.equal(name,'AbortError');
});

/* ---------- habits ---------- */
test('habit add rejects empty, duplicate and 61-character names',()=>{
  const a=createApp();
  const add=name=>{a.el('habitName').value=name;a.run('habitAdd()');};
  add('');add('   ');assert.equal(a.run('habitEntries().length'),0);
  add('가'.repeat(61));assert.equal(a.run('habitEntries().length'),0);
  add('가'.repeat(60));assert.equal(a.run('habitEntries().length'),1);
  add('운동');add('운동');
  assert.equal(a.run('habitEntries().length'),2);
  assert.equal(a.toasts.at(-1),'같은 이름의 습관이 있어요.');
  assert.equal(a.saved().habits.length,2);
});

test('habit check toggles on and off for today and the streak follows',()=>{
  const a=createApp();
  a.el('habitName').value='운동';a.run('habitAdd()');
  const id=a.run('habitEntries()[0].id'),today=a.run('koreaToday()'),yesterday=a.run(`plannerDateOffset('${a.run('koreaToday()')}',-1)`);
  a.run(`habitToggle('${id}','${yesterday}')`);
  assert.equal(a.run('habitStreak(habitEntries()[0])'),1);
  a.run(`habitToggle('${id}','${today}')`);
  assert.deepEqual(a.saved().habits[0].checks,[yesterday,today]);
  assert.equal(a.run('habitStreak(habitEntries()[0])'),2);
  a.run(`habitToggle('${id}','${today}')`);
  assert.deepEqual(a.saved().habits[0].checks,[yesterday]);
  assert.equal(a.run('habitStreak(habitEntries()[0])'),1);
});

test('habit delete is kept when cancelled and removed when confirmed',async()=>{
  const a=createApp(undefined,{confirm:false});
  a.el('habitName').value='운동';a.run('habitAdd()');
  const id=a.run('habitEntries()[0].id');
  await a.run(`habitRemove('${id}')`);
  assert.equal(a.dialogs.at(-1).kind,'confirm');assert.equal(a.run('habitEntries().length'),1);
  const b=createApp(a.storage.get('lifeAIPrototypeV5'),{confirm:true});
  await b.run(`habitRemove('${id}')`);
  assert.equal(b.run('habitEntries().length'),0);assert.equal(b.saved().habits.length,0);
});

/* ---------- 글자만 있는 관심 회사가 있어도 회사 추가가 된다 (#106) ---------- */
test('a text-only watch company in saved data does not block adding a company',()=>{
  const a=createApp(JSON.stringify({watchCompanies:['삼천리']}));
  a.el('watchCompany').value='현대제철';a.el('watchUrl').value='';
  a.run('addWatchCompany()');
  const names=a.saved().watchCompanies.map(c=>c.name);
  assert.deepEqual(names,['삼천리','현대제철']);
  assert.ok(a.saved().watchCompanies.every(c=>c.id));
});

/* ---------- 새 버전 백업 파일은 따로 안내한다 (#110) ---------- */
test('a backup made by a newer version gets its own message, other bad files keep the old one',async()=>{
  const pick=(a,data)=>a.run('importLifeAIBackup')({files:[{size:100,text:async()=>JSON.stringify(data)}]});
  const a=createApp();
  const cur=a.run('LIFE_AI_BACKUP_VERSION');
  await pick(a,{format:'life-ai-backup',version:cur+1,state:{}});
  assert.match(a.toasts.at(-1),/더 새로운 버전/);
  await pick(a,{format:'other',version:cur+1,state:{}});
  assert.match(a.toasts.at(-1),/올바른 life-ai 백업 파일이 아니에요/);
  await pick(a,{format:'life-ai-backup',version:cur,state:{}});
  assert.doesNotMatch(a.toasts.at(-1),/더 새로운 버전/);
});

/* ---------- 새 버전 기록의 버전 표시를 낮추지 않는다 (#109) ---------- */
test('opening data saved by a newer version keeps its schemaVersion when saving',()=>{
  const newer=a=>a.run('LifeLogic.STATE_SCHEMA_VERSION')+1;
  const probe=createApp();
  const v=newer(probe);
  const a=createApp(JSON.stringify({schemaVersion:v,mainGoal:'전기기사'}));
  a.run('persistState()');
  assert.equal(a.saved().schemaVersion,v);
  const b=createApp();b.run('persistState()');
  assert.equal(b.saved().schemaVersion,b.run('LifeLogic.STATE_SCHEMA_VERSION'));
});

/* ---------- 조회일은 한국 날짜로 보여준다 (#99) ---------- */
test('cert schedule "조회일" shows the Korean date, not the UTC date',()=>{
  const a=createApp();
  const html=fetchedAt=>a.context.certCalendarHTML({qualification:{name:'전기기사'},year:2026,fetchedAt,items:[{type:'필기시험',startDate:'2099-01-01',endDate:'2099-01-01'}]});
  // 2026-11-17 23:30 UTC = 2026-11-18 08:30 KST
  assert.match(html('2026-11-17T23:30:00.000Z'),/조회일 2026\D*11\D*18/);
  assert.doesNotMatch(html('2026-11-17T23:30:00.000Z'),/조회일 2026\D*11\D*17/);
  // a broken value must not crash the card
  assert.match(html('not-a-date'),/조회일/);
});

/* ---------- #172: planner screen description matches its real tabs ---------- */
test('planner screen description names the real tabs and no longer says 7-day report',()=>{
  const {html}=require('./helpers/app-harness.js');
  const intro=/<div id="calendarContent">/.test(html)&&/<p class="meta">([^<]*)<\/p><div id="calendarContent"><\/div>/.exec(html);
  assert.ok(intro,'intro line above calendarContent exists');
  assert.ok(!html.includes('7일 리포트'));
  // every tab in the tab bar must be covered by a keyword in the intro sentence, so renaming a tab forces this line to be updated
  const tabs=[...html.matchAll(/\['(today|calendar|habits|stats)','([^']+)'\]/g)].map(m=>m[1]);
  assert.deepEqual(tabs,['today','calendar','habits','stats']);
  for(const word of ['캘린더','일정 추가','집중 타이머','습관','주간·월간 통계'])assert.ok(intro[1].includes(word),word);
  for(const label of [...html.matchAll(/\['(?:today|calendar|habits|stats)','([^']+)'\]/g)].map(m=>m[1]))assert.ok(['오늘·집중','캘린더','습관','통계'].includes(label),'tab label changed: update the intro line and this test: '+label);
});

/* ---------- #170: rule-based goal sorting is not called "AI" ---------- */
test('goal sorting screens do not claim an AI understood the goal',()=>{
  const {html}=require('./helpers/app-harness.js');
  for(const phrase of ['AI가 목표 정리하기','AI가 목표를 정리했어요','AI가 알고 있는 정보','AI가 이해한 내용','AI가 이렇게 이해했어요'])assert.ok(!html.includes(phrase),phrase);
  const a=createApp();
  a.run("state.parsedGoal=inferGoal('회사 가는 길 걷기');state.mainGoal='회사 가는 길 걷기'");
  const out=a.run('understandingHTML()');
  assert.ok(!out.includes('AI가'),out);
  assert.ok(out.includes('입력한 단어로 분류한 결과예요')||out.includes('우선 일반 목표'),out);
});

/* ---------- #168: empty exam schedule shows the server's reason ---------- */
test('an empty Q-Net schedule shows the server message and suggests another year',async()=>{
  const message='해당 연도의 종목별 시험일정을 찾지 못했어요. 상시검정 종목은 별도 일정 연동이 필요할 수 있어요.';
  const payload={qualification:{name:'지게차운전기능사',code:'7785'},items:[],rounds:[],message};
  const a=createApp(undefined,{fetch:async()=>({ok:true,status:200,json:async()=>payload})});
  a.el('certSearchInput').value='지게차운전기능사';
  a.el('certYear').value='2026';
  await a.run('loadLiveCertSchedule()');
  const box=a.el('liveCertResults').innerHTML;
  assert.ok(box.includes('상시검정 종목은 별도 일정 연동이 필요할 수 있어요'),box);
  assert.ok(box.includes('다른 연도를 골라 다시 확인해 보세요'),box);
});
