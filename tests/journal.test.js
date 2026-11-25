const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../logic.js');
const {createApp}=require('./helpers/app-harness.js');

/* 하루 기록 (daily journal): a mood and a few lines per day, drafts, calendar marks, report numbers and the reminder. */
const NOW=Date.parse('2026-11-25T12:30:00Z'); // 2026-11-25 (Wednesday) 21:30 Korea time
const TODAY='2026-11-25';
const flush=()=>new Promise(r=>setImmediate(r));
const later=(a,ms)=>{a.clock.now+=ms;a.advance(ms);}; // move the clock and run the waiting timers

const appWith=(state,opts={})=>createApp(state===undefined?undefined:JSON.stringify(state),{now:NOW,...opts});
const journal=a=>a.saved().journal||[];
const write=(a,text,mood)=>{
  a.run('journalOpen()');
  if(mood)a.run(`journalPickMood('${mood}')`);
  a.el('journalText').value=text;
  a.run('journalSave()');
};
const entry=(date,extra={})=>({date,mood:'good',text:'오늘은 괜찮았다',createdAt:'2026-11-20T00:00:00.000Z',updatedAt:'2026-11-20T00:00:00.000Z',...extra});

test('cleanJournalEntries keeps one good record per day, oldest first, and drops broken ones',()=>{
  const clean=L.cleanJournalEntries([
    entry('2026-11-24'),
    {date:'2026-11-22',mood:'zzz',text:''},                       // unknown mood and no text: nothing left
    {date:'2026-11-23',mood:'sad',text:''},                       // mood only is fine
    {date:'2026-11-21',text:'글만 있어요'},                       // text only is fine
    {date:'not-a-date',text:'x'},null,5,
    entry('2026-11-24',{text:'나중에 고친 글',updatedAt:'2026-11-24T10:00:00.000Z'}),
    entry('2026-11-20',{text:'가'.repeat(L.JOURNAL_TEXT_MAX+50)})
  ]);
  assert.deepEqual(clean.map(e=>e.date),['2026-11-20','2026-11-21','2026-11-23','2026-11-24']);
  assert.equal(clean[0].text.length,L.JOURNAL_TEXT_MAX,'cut to the limit');
  assert.equal(clean[1].mood,'');
  assert.equal(clean.at(-1).text,'나중에 고친 글','the most recently changed record of a day wins');
  assert.deepEqual(L.cleanJournalEntries('x'),[]);
});

test('journalStreak counts days in a row and does not break before the day is over',()=>{
  const list=['2026-11-22','2026-11-23','2026-11-24','2026-11-25'].map(d=>entry(d));
  assert.equal(L.journalStreak(list,'2026-11-25'),4);
  assert.equal(L.journalStreak(list.slice(0,3),'2026-11-25'),3,'today not written yet: yesterday still counts');
  assert.equal(L.journalStreak(list.slice(0,3),'2026-11-26'),0,'a whole day missed ends the row');
  assert.equal(L.journalStreak([entry('2026-11-20'),entry('2026-11-25')],'2026-11-25'),1,'a gap ends the row');
  assert.equal(L.journalStreak([],'2026-11-25'),0);assert.equal(L.journalStreak(null,'2026-11-25'),0);
});

test('journalStats counts days and moods in a period',()=>{
  const list=[entry('2026-11-23',{mood:'great'}),entry('2026-11-24',{mood:'good'}),entry('2026-11-25',{mood:'good'}),entry('2026-11-10',{mood:'sad'}),entry('2026-11-22',{mood:''})];
  const week=['2026-11-22','2026-11-23','2026-11-24','2026-11-25','2026-11-26'];
  const stats=L.journalStats(list,week);
  assert.equal(stats.days,4,'the day with only text counts as a record');
  assert.deepEqual(stats.moods,{great:1,good:2});
  assert.equal(stats.top,'good');
  assert.equal(stats.average,4.3);
  assert.deepEqual(L.journalStats([],week),{days:0,moods:{},top:'',average:0});
});

test('cleanJournalSettings forces every field into a safe shape',()=>{
  assert.deepEqual(L.cleanJournalSettings(undefined),{remind:false,time:'21:00',days:[0,1,2,3,4,5,6],lastNotified:'',message:'',push:false});
  const s=L.cleanJournalSettings({remind:true,time:'7:5',days:[6,1,1,9,'x',-1],lastNotified:'2026-13-01',message:'  잠깐 쉬어요  '});
  assert.deepEqual(s,{remind:true,time:'21:00',days:[1,6],lastNotified:'',message:'잠깐 쉬어요',push:false});
  assert.equal(L.cleanJournalSettings({remind:'yes'}).remind,false);
});

test('journalReminderDue: on, right weekday, time reached, nothing written, not shown yet today',()=>{
  const on={remind:true,time:'21:00',days:[3]};              // Wednesdays at 21:00
  assert.equal(L.journalReminderDue(on,[],NOW),true);
  assert.equal(L.journalReminderDue({...on,remind:false},[],NOW),false,'switched off');
  assert.equal(L.journalReminderDue({...on,days:[1,2]},[],NOW),false,'not a chosen weekday');
  assert.equal(L.journalReminderDue({...on,time:'22:00'},[],NOW),false,'the time has not come');
  assert.equal(L.journalReminderDue({...on,time:'21:30'},[],NOW),true,'exactly on time');
  assert.equal(L.journalReminderDue({...on,lastNotified:TODAY},[],NOW),false,'already shown today');
  assert.equal(L.journalReminderDue({...on,lastNotified:'2026-11-24'},[],NOW),true,'yesterday does not count');
  assert.equal(L.journalReminderDue(on,[entry(TODAY)],NOW),false,'already written today: no reminder');
  assert.equal(L.journalReminderDue(on,[entry('2026-11-24')],NOW),true,'yesterday\'s record does not count');
  // 15:30 UTC is already the next day in Korea (Thursday 00:30)
  assert.equal(L.journalReminderDue({remind:true,time:'00:10',days:[4]},[],Date.parse('2026-11-25T15:30:00Z')),true);
});

test('saved records are checked on load and in a backup; broken ones are dropped one by one',()=>{
  const state={nickname:'a',mainGoal:'b',activity:[],completedTasks:[false,false,false,false,false],
    journal:[entry('2026-11-24'),{date:'bad',text:'x'},'text',entry('2026-11-25',{mood:'nope'})],
    journalSettings:{remind:true,time:'20:30',days:[1,2]},journalDraft:{date:TODAY,mood:'good',text:'쓰다 만 글'}};
  assert.equal(L.validateBackupState({...state,journal:[entry('2026-11-24'),entry(TODAY,{mood:''})]}),true);
  const {state:clean,dropped}=L.sanitizeState(state);
  assert.deepEqual(clean.journal.map(e=>e.date),['2026-11-24','2026-11-25']);
  assert.equal(clean.journal[1].mood,'','an unknown mood is cleared, the text stays');
  assert.ok(dropped.includes('journal'));
  assert.equal(clean.journalSettings.time,'20:30');
  assert.equal(L.sanitizeState({journalSettings:'x',journalDraft:5}).state.journalSettings,undefined);
  assert.equal(L.hasUserData({journal:[entry(TODAY)]}),true);
  assert.equal(L.recordCount({journal:[entry(TODAY),entry('2026-11-24')]}),2);
});

test('writing today: a mood and a few lines are saved with today\'s date, and the record can be changed',()=>{
  const a=appWith();
  write(a,'오늘은 면접 준비를 했다','good');
  assert.equal(journal(a).length,1);
  assert.equal(journal(a)[0].date,TODAY);assert.equal(journal(a)[0].mood,'good');assert.equal(journal(a)[0].text,'오늘은 면접 준비를 했다');
  assert.match(a.toasts.at(-1),/기록했어요/);
  assert.match(a.el('journalContent').innerHTML,/기록 고치기/,'the same screen now offers to change it');
  assert.match(a.el('journalContent').innerHTML,/오늘은 면접 준비를 했다/);
  a.el('journalText').value='오늘은 면접 준비를 하고 산책도 했다';
  a.run('journalSave()');
  assert.equal(journal(a).length,1,'still one record for the day');
  assert.equal(journal(a)[0].text,'오늘은 면접 준비를 하고 산책도 했다');
  assert.match(a.toasts.at(-1),/고쳤어요/);
});

test('a one-line note without a mood, or only a mood, is a record too; an empty one is refused',()=>{
  const a=appWith();
  write(a,'한 줄만');
  assert.equal(journal(a)[0].mood,'');
  const b=appWith();
  write(b,'   ','sad');
  assert.equal(journal(b)[0].mood,'sad');
  const c=appWith();
  write(c,'  ');
  assert.equal(c.run('state.journal.length'),0);assert.match(c.toasts.at(-1),/기분을 고르거나 한 줄/);
});

test('tapping the chosen mood again clears it, and text is cut to the limit',()=>{
  const a=appWith();
  a.run('journalOpen()');
  a.run("journalPickMood('okay')");assert.equal(a.run('journalMoodChoice'),'okay');
  a.run("journalPickMood('okay')");assert.equal(a.run('journalMoodChoice'),'');
  a.run("journalPickMood('not-a-mood')");assert.equal(a.run('journalMoodChoice'),'');
  a.el('journalText').value='가'.repeat(L.JOURNAL_TEXT_MAX+100);
  a.run('journalSave()');
  assert.equal(journal(a)[0].text.length,L.JOURNAL_TEXT_MAX);
});

test('a past day can be written, a future day cannot, and the date box switches days',()=>{
  const a=appWith();
  a.run('journalOpen()');
  a.run("journalSetDate('2026-11-20')");
  a.el('journalText').value='그날의 기록';a.run("journalPickMood('tired')");a.el('journalText').value='그날의 기록';a.run('journalSave()');
  assert.equal(journal(a)[0].date,'2026-11-20');
  a.run("journalSetDate('2026-11-30')");
  assert.match(a.toasts.at(-1),/오늘까지의 날짜/);
  assert.equal(a.run('journalDate'),'2026-11-20','the day did not change');
  a.run("journalSetDate('nonsense')");
  assert.equal(a.run('journalDate'),'2026-11-20');
  a.run("journalOpen('2026-12-24')");
  assert.equal(a.run('journalDate'),TODAY,'a future day given to journalOpen falls back to today');
  a.run("journalOpen('2026-11-20')");
  assert.match(a.el('journalContent').innerHTML,/그날의 기록/);
});

test('deleting asks first, removes the record and its draft, and can be cancelled',async()=>{
  const keep=appWith({journal:[entry(TODAY)]},{confirm:false});
  keep.run('journalOpen()');
  await keep.run('journalDelete()');
  assert.equal(journal(keep).length,1,'cancelled: nothing is removed');
  const a=appWith({journal:[entry(TODAY),entry('2026-11-24')],journalDraft:{date:TODAY,mood:'sad',text:'고치던 글'}});
  a.run('journalOpen()');
  await a.run('journalDelete()');
  assert.deepEqual(journal(a).map(e=>e.date),['2026-11-24']);
  assert.equal(a.saved().journalDraft,undefined);
  assert.match(a.toasts.at(-1),/지웠어요/);
  assert.match(a.el('journalContent').innerHTML,/기록 저장/,'the form is empty and offers to save a new one');
});

test('what is typed is kept as a draft, comes back when the screen is opened again, and is dropped once saved',()=>{
  const a=appWith();
  a.run('journalOpen()');
  a.el('journalText').value='쓰다가 만 글';
  a.run('journalOnInput()');
  a.flushTimeouts();
  assert.equal(a.saved().journalDraft.text,'쓰다가 만 글');
  assert.equal(a.saved().journalDraft.date,TODAY);
  assert.equal(journal(a).length,0,'a draft is not a record');
  // the screen is left and opened again (a fresh page too)
  const b=appWith(a.saved());
  b.run('journalOpen()');
  assert.match(b.el('journalContent').innerHTML,/쓰다가 만 글/);
  assert.match(b.el('journalContent').innerHTML,/임시 글을 불러왔어요/);
  b.el('journalText').value='쓰다가 만 글, 이제 끝';
  b.run('journalSave()');
  assert.equal(b.saved().journalDraft,undefined);
  assert.equal(journal(b)[0].text,'쓰다가 만 글, 이제 끝');
  // typing exactly what is saved leaves no draft behind
  b.run('journalAutosave()');
  assert.equal(b.saved().journalDraft,undefined);
});

test('a draft of an earlier day opens on that day, so nothing typed is lost',()=>{
  const a=appWith({journalDraft:{date:'2026-11-23',mood:'good',text:'그저께 쓰던 글'}});
  a.run('journalOpen()');
  assert.equal(a.run('journalDate'),'2026-11-23');
  assert.match(a.el('journalContent').innerHTML,/그저께 쓰던 글/);
});

test('when the phone cannot save, the typed text stays and no record is claimed',()=>{
  const a=appWith(undefined,{failSave:true});
  a.run('journalOpen()');
  a.run("journalPickMood('good')");
  a.el('journalText').value='저장 공간이 꽉 찼어요';
  a.run('journalSave()');
  assert.equal(a.run('state.journal.length'),0,'the change is undone in memory too');
  assert.match(a.toasts.at(-1),/저장하지 못했어요/);
  assert.doesNotMatch(a.toasts.at(-1),/기록했어요/);
});

test('text from the journal is shown as plain text everywhere',()=>{
  const evil='<img src=x onerror=alert(1)><script>alert(2)</script>';
  const a=appWith({journal:[entry(TODAY,{text:evil}),entry('2026-11-24',{text:evil})]});
  a.run('journalOpen()');
  const screen=a.el('journalContent').innerHTML;
  assert.doesNotMatch(screen,/<img src=x|<script>alert/);
  a.run('renderHome()');assert.doesNotMatch(a.el('homeContent').innerHTML,/<img src=x|<script>alert/);
  a.run("plannerSelected='2026-11-24'");a.run('renderCalendar()');
  assert.doesNotMatch(a.el('calendarContent').innerHTML,/<img src=x|<script>alert/);
});

test('the calendar marks days with a record and shows the record of the chosen day',()=>{
  const a=appWith({journal:[entry('2026-11-24',{mood:'great',text:'어제는 좋았다\n둘째 줄'})]});
  a.run("plannerSelected='2026-11-24'");a.run('renderCalendar()');
  const html=a.el('calendarContent').innerHTML;
  assert.match(html,/class="journal-mark"[^>]*>😄</);
  assert.match(html,/하루 기록 있음/);
  assert.match(html,/id="journalDayCard"[\s\S]*어제는 좋았다/);
  assert.match(html,/journalOpen\('2026-11-24'\)/);
  a.run("plannerSelected='2026-11-23'");a.run('renderCalendar()');
  assert.match(a.el('calendarContent').innerHTML,/이 날의 기록이 아직 없어요/);
  a.run("plannerSelected='2026-11-28'");a.run('renderCalendar()');
  assert.doesNotMatch(a.el('calendarContent').innerHTML,/id="journalDayCard"/,'no record card for a day that has not come');
});

test('Home asks how the day was, then shows the streak once it is written',()=>{
  const a=appWith({mainGoal:'x',journal:[entry('2026-11-23'),entry('2026-11-24')]});
  a.run('renderHome()');
  assert.match(a.el('homeContent').innerHTML,/오늘 하루는 어땠나요\?/);
  assert.match(a.el('homeContent').innerHTML,/2일 연속/);
  write(a,'오늘도 한 줄','okay');
  a.run('renderHome()');
  assert.match(a.el('homeContent').innerHTML,/오늘 하루를 기록했어요/);
  assert.match(a.el('homeContent').innerHTML,/3일 연속/);
  assert.equal(L.journalStreak(journal(a),TODAY),3);
});

test('the weekly and monthly report shows the number of records, the common mood and the streak',()=>{
  const a=appWith({journal:[entry('2026-11-23',{mood:'good'}),entry('2026-11-24',{mood:'good'}),entry('2026-11-25',{mood:'tired'}),entry('2026-10-01',{mood:'sad'})]});
  const html=a.run('progressInsightsHTML()');
  assert.match(html,/class="journal-report"/);
  assert.match(html,/📝 3일/);
  assert.match(html,/🙂 좋아요/);
  assert.match(html,/🔥 3일/);
  a.run("insightsSetPeriod('month')");
  assert.match(a.run('progressInsightsHTML()'),/📝 3일/,'the October record is outside this month');
  const empty=appWith();
  assert.match(empty.run('progressInsightsHTML()'),/📝 0일/);
});

test('settings: switching the reminder on asks for permission once and does not fire for a time already gone',async()=>{
  const a=appWith();
  let asked=0;
  a.context.Notification={permission:'default',requestPermission:async()=>{asked++;a.context.Notification.permission='granted';return 'granted';}};
  await a.run('journalChangeRemind(true)');
  assert.equal(asked,1);
  const s=a.saved().journalSettings;
  assert.equal(s.remind,true);assert.equal(s.time,'21:00');
  assert.equal(s.lastNotified,TODAY,'21:00 is already over at 21:30, so the first reminder is the next valid day');
  assert.match(a.toasts.at(-1),/알려 드릴게요/);
  assert.equal(await a.run('journalReminderCheck()'),false);
  a.run("journalChangeTime('22:00')");
  assert.equal(a.saved().journalSettings.lastNotified,'','a later time can still fire today');
  a.run("journalChangeTime('9:00')");
  assert.match(a.toasts.at(-1),/알림 시간을 확인/);
  a.run('journalChangeDay(3,false)');a.run('journalChangeDay(0,false)');
  assert.deepEqual(a.saved().journalSettings.days,[1,2,4,5,6]);
  a.run('journalChangeDay(3,true)');
  assert.ok(a.saved().journalSettings.days.includes(3));
  a.run("journalChangeMessage('  오늘 한 줄만 써 볼까요?  ')");
  assert.equal(a.saved().journalSettings.message,'오늘 한 줄만 써 볼까요?');
  await a.run('journalChangeRemind(false)');
  assert.equal(a.saved().journalSettings.remind,false);
});

test('settings work without notification support and when notifications are blocked',async()=>{
  const none=appWith();
  none.context.Notification=undefined;
  await none.run('journalChangeRemind(true)');
  assert.equal(none.saved().journalSettings.remind,true,'the reminder still works inside the app');
  assert.match(none.toasts.at(-1),/지원하지 않아요|홈에서 알려/);
  const blocked=appWith();
  blocked.context.Notification={permission:'default',requestPermission:async()=>'denied'};
  await blocked.run('journalChangeRemind(true)');
  assert.match(blocked.toasts.at(-1),/막혀 있어요/);
  assert.equal(blocked.saved().journalSettings.remind,true);
});

test('the reminder shows once a day inside the app, from the repeating timer, with the chosen text',async()=>{
  const a=appWith({mainGoal:'x',journalSettings:{remind:true,time:'23:00',message:'오늘 한 줄만 써 볼까요?'}});
  await flush();
  assert.equal(a.toasts.length,0,'21:30 is before the chosen 23:00');
  later(a,2*3600*1000); // 23:30: the timer that checks every minute comes by
  await flush();
  assert.match(a.toasts.at(-1),/오늘 한 줄만 써 볼까요\?/);
  assert.equal(a.saved().journalSettings.lastNotified,TODAY);
  const count=a.toasts.length;
  assert.equal(await a.run('journalReminderCheck()'),false,'not shown twice in a day');
  assert.equal(a.toasts.length,count);
  later(a,24*3600*1000);
  await a.run('journalReminderCheck()');
  await flush();
  assert.equal(a.saved().journalSettings.lastNotified,'2026-11-26','shown again the next day');
});

test('a reminder that is already due when the app opens is shown at once (the app was closed at that time)',async()=>{
  const a=appWith({mainGoal:'x',journalSettings:{remind:true,time:'20:00'}});
  await flush();
  assert.match(a.toasts.at(-1),/오늘 하루는 어땠나요\?/);
  assert.equal(a.saved().journalSettings.lastNotified,TODAY);
});

test('no reminder once today is written, or when it is off',async()=>{
  const written=appWith({journal:[entry(TODAY)],journalSettings:{remind:true,time:'20:00'}});
  assert.equal(await written.run('journalReminderCheck()'),false);
  assert.equal(written.toasts.length,0);
  const off=appWith({journalSettings:{remind:false,time:'20:00'}});
  assert.equal(await off.run('journalReminderCheck()'),false);
  const early=appWith({journalSettings:{remind:true,time:'23:00'}});
  assert.equal(await early.run('journalReminderCheck()'),false);
});

test('with the app in the background and permission given, the reminder is a notification that opens the journal',async()=>{
  const a=appWith({journalSettings:{remind:true,time:'23:00'}},{hidden:true});
  const shown=[];
  a.context.Notification={permission:'granted',requestPermission:async()=>'granted'};
  a.context.navigator.serviceWorker={getRegistration:async()=>({showNotification:async(title,options)=>{shown.push({title,options});}})};
  later(a,2*3600*1000);
  await flush();
  assert.equal(shown.length,1);
  assert.equal(shown[0].title,'오늘 하루는 어땠나요?');
  assert.equal(shown[0].options.data.screen,'journal');
  assert.equal(shown[0].options.tag,'life-ai-journal','one tag, so a second one would replace the first');
  assert.equal(a.toasts.length,0,'no in-app toast on top of the notification');
  assert.equal(await a.run('journalReminderCheck()'),false);
  assert.equal(shown.length,1);
});

test('the screen opens from a link or a message, and the reminder timer is started',()=>{
  const a=appWith({mainGoal:'x'},{search:'?screen=journal'});
  assert.equal(a.run('currentScreen'),'journal');
  assert.match(a.el('journalContent').innerHTML,/기록 저장/);
  const other=appWith({mainGoal:'x'},{search:'?screen=hack'});
  assert.equal(other.run('currentScreen'),'home','an unknown screen name is ignored');
  assert.equal(JSON.stringify(a.run('LINK_SCREENS')),'["journal","calendar"]');
});

test('MY and the Home card lead to the journal',()=>{
  const a=appWith({mainGoal:'x'});
  a.run('renderMy()');
  assert.match(a.el('myContent').innerHTML,/journalOpen\(\)[^>]*>📝 하루 기록·알림 설정/);
  a.run('renderHome()');
  assert.match(a.el('homeContent').innerHTML,/journalOpen\(\)[^>]*>기록하기/);
  a.run('journalOpen()');
  assert.equal(a.run('currentScreen'),'journal');
});

test('journal text is never sent anywhere',async()=>{
  const calls=[];
  const a=appWith(undefined,{fetch:async(...args)=>{calls.push(args);return {ok:true,status:200,json:async()=>({})};}});
  write(a,'아주 사적인 이야기','sad');
  a.run('journalAutosave()');a.run('renderHome()');a.run('renderCalendar()');a.run('progressInsightsHTML()');
  await flush();
  assert.equal(calls.length,0);
});

test('a backup keeps the journal and a restore brings it back',async()=>{
  const a=appWith({journal:[entry(TODAY),entry('2026-11-24',{mood:''})],journalSettings:{remind:true,time:'20:00',days:[1]}});
  const made=JSON.parse(a.run('makeLifeAIBackup().text'));
  assert.equal(made.state.journal.length,2);
  assert.equal(made.state.journalSettings.time,'20:00');
  assert.equal(L.validateBackupState(made.state),true);
});

test('the journal screen has what a phone needs: big mood buttons, 16px text, a labelled textarea',()=>{
  const {html}=require('./helpers/app-harness.js');
  const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css,/\.journal-mood-btn\{[^}]*min-height:(6\d|[7-9]\d)px/);
  assert.match(css,/\.journal-text\{[^}]*font-size:16px/);
  assert.match(html,/<section id="journal" class="screen">/);
  const a=appWith();
  a.run('journalOpen()');
  const screen=a.el('journalContent').innerHTML;
  assert.match(screen,/<label class="wide">오늘의 기록<textarea id="journalText"/);
  assert.match(screen,/role="group" aria-label="오늘의 기분"/);
  assert.equal((screen.match(/class="journal-mood-btn/g)||[]).length,6);
  assert.ok(screen.includes('이 폰에만 저장되고 다른 곳으로 보내지지 않아요'));
});

/* ---------- reminder that arrives with the app closed (push) ---------- */
const PUBLIC_KEY='BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const SUBSCRIPTION={endpoint:'https://fcm.googleapis.com/fcm/send/abc-token',keys:{p256dh:'p256dh-key-value',auth:'auth-key-value'}};
// A phone with push support: fakes for the notification permission, the worker's push manager and the server.
function pushPhone(state,opts={}){
  const a=appWith(state,opts.app||{});
  const calls={subscribe:[],unsubscribe:0,posts:[],gets:0,permissionAsked:0};
  let subscription=null;
  const make=()=>({...SUBSCRIPTION,toJSON(){return {endpoint:this.endpoint,keys:this.keys};},unsubscribe:async()=>{calls.unsubscribe++;subscription=null;return true;}});
  if(opts.existing)subscription=make();
  const pushManager={
    getSubscription:async()=>subscription,
    subscribe:async options=>{
      calls.subscribe.push(options);
      if(opts.subscribeFails)throw new Error('blocked');
      subscription=make();
      return subscription;
    }
  };
  a.context.PushManager=function PushManager(){};
  a.context.atob=atob;
  a.context.Notification={permission:opts.permission||'default',requestPermission:async()=>{calls.permissionAsked++;a.context.Notification.permission=opts.answer||'granted';return a.context.Notification.permission;}};
  a.context.navigator.serviceWorker={ready:Promise.resolve({pushManager}),getRegistration:async()=>null};
  a.context.fetch=async(url,init)=>{
    if(!init||!init.method||init.method==='GET'){calls.gets++;return opts.keyStatus?{ok:false,status:opts.keyStatus,json:async()=>({})}:{ok:true,status:200,json:async()=>({publicKey:PUBLIC_KEY})};}
    calls.posts.push(JSON.parse(init.body));
    return opts.postFails?{ok:false,status:500,json:async()=>({})}:{ok:true,status:200,json:async()=>({ok:true})};
  };
  return {a,calls,current:()=>subscription};
}

test('turning on the closed-app reminder asks permission, subscribes with the server key and sends only settings',async()=>{
  const {a,calls}=pushPhone({journal:[entry('2026-11-24',{text:'아주 사적인 이야기'})],journalSettings:{remind:true,time:'23:00',days:[1,3],message:'한 줄만 써요'}});
  await a.run('journalPushToggle(true)');
  assert.equal(calls.permissionAsked,1);
  assert.equal(calls.subscribe.length,1);
  assert.equal(calls.subscribe[0].userVisibleOnly,true);
  assert.equal(calls.subscribe[0].applicationServerKey.length,65,'the 65-byte server key');
  assert.equal(a.saved().journalSettings.push,true);
  assert.equal(calls.posts.length,1);
  const sent=calls.posts[0];
  assert.equal(sent.action,'save');
  assert.deepEqual(sent.subscription,SUBSCRIPTION);
  assert.deepEqual(sent.settings,{remind:true,time:'23:00',days:[1,3],message:'한 줄만 써요',lastNotified:''});
  assert.equal(sent.doneDate,'','nothing written today');
  assert.doesNotMatch(JSON.stringify(calls.posts),/사적인/,'no record text leaves the phone');
  assert.match(a.toasts.at(-1),/꺼져 있어도/);
});

test('a time that already passed today does not fire at once when it is turned on',async()=>{
  const {a,calls}=pushPhone({journalSettings:{remind:true,time:'20:00'}});
  await a.run('journalPushToggle(true)');
  assert.equal(calls.posts[0].settings.lastNotified,TODAY,'today is settled, so the first reminder is the next valid day');
});

test('what the server is told stays current: writing today, deleting it, and changing the settings',async()=>{
  const {a,calls}=pushPhone({journalSettings:{remind:true,time:'23:00',push:true}},{existing:true});
  a.run('journalOpen()');
  a.el('journalText').value='오늘의 글';a.run("journalPickMood('good')");a.el('journalText').value='오늘의 글';
  a.run('journalSave()');
  a.flushTimeouts();await flush();await flush();
  assert.equal(calls.posts.at(-1).doneDate,TODAY,'the server learns that today is written, so no reminder comes');
  assert.doesNotMatch(JSON.stringify(calls.posts),/오늘의 글/);
  await a.run('journalDelete()');
  a.flushTimeouts();await flush();await flush();
  assert.equal(calls.posts.at(-1).doneDate,'','deleting makes the day open again');
  a.run("journalChangeTime('22:00')");
  a.flushTimeouts();await flush();await flush();
  assert.equal(calls.posts.at(-1).settings.time,'22:00');
  a.run('journalChangeDay(3,false)');
  a.flushTimeouts();await flush();await flush();
  assert.equal(calls.posts.at(-1).settings.days.includes(3),false);
});

test('while the server sends the reminder, the app does not also show its own',async()=>{
  const {a}=pushPhone({journalSettings:{remind:true,time:'20:00',push:true}},{existing:true});
  await flush();
  assert.equal(await a.run('journalReminderCheck()'),false);
  assert.equal(a.toasts.filter(t=>/오늘 하루는 어땠나요/.test(t)).length,0);
});

test('turning it off forgets the phone on the server and keeps the in-app reminder',async()=>{
  const {a,calls}=pushPhone({journalSettings:{remind:true,time:'23:00',push:true}},{existing:true});
  await a.run('journalPushToggle(false)');
  assert.equal(calls.unsubscribe,1);
  assert.deepEqual(calls.posts.at(-1),{action:'remove',endpoint:SUBSCRIPTION.endpoint});
  assert.equal(a.saved().journalSettings.push,false);
  assert.equal(a.saved().journalSettings.remind,true,'the in-app reminder stays on');
});

test('it is refused with a clear message when it cannot work: blocked, no server key, server error, unsupported, iPhone browser tab',async()=>{
  const denied=pushPhone({journalSettings:{remind:true}},{answer:'denied'});
  await denied.a.run('journalPushToggle(true)');
  assert.match(denied.a.toasts.at(-1),/허용되지 않았어요/);
  assert.equal(denied.calls.subscribe.length,0);
  assert.notEqual(denied.a.saved().journalSettings.push,true,'nothing was turned on');
  const notReady=pushPhone({journalSettings:{remind:true}},{keyStatus:503});
  await notReady.a.run('journalPushToggle(true)');
  assert.match(notReady.a.toasts.at(-1),/아직 준비되지 않았어요/);
  assert.equal(notReady.calls.subscribe.length,0);
  const down=pushPhone({journalSettings:{remind:true}},{postFails:true});
  await down.a.run('journalPushToggle(true)');
  assert.match(down.a.toasts.at(-1),/저장하지 못했어요/);
  assert.equal(down.a.saved().journalSettings.push,false,'not left half on');
  assert.equal(down.calls.unsubscribe,1,'the new subscription is dropped again');
  const refused=pushPhone({journalSettings:{remind:true}},{subscribeFails:true});
  await refused.a.run('journalPushToggle(true)');
  assert.match(refused.a.toasts.at(-1),/켜지 못했어요/);
  const none=appWith({journalSettings:{remind:true}});
  await none.run('journalPushToggle(true)');
  assert.ok(none.toasts.some(t=>/지원하지 않아요/.test(t)),'a browser without push says so');
  const iphone=pushPhone({journalSettings:{remind:true}},{app:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'}});
  await iphone.a.run('journalPushToggle(true)');
  assert.ok(iphone.a.toasts.some(t=>/홈 화면에 추가/.test(t)));
  assert.equal(iphone.calls.permissionAsked,0,'the permission box is not even shown');
  const installed=pushPhone({journalSettings:{remind:true}},{app:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',standalone:true}});
  await installed.a.run('journalPushToggle(true)');
  assert.equal(installed.a.saved().journalSettings.push,true,'an iPhone app added to the Home Screen can turn it on');
});

test('if the phone dropped its push subscription, the setting switches itself off instead of lying',async()=>{
  const {a}=pushPhone({journalSettings:{remind:true,push:true}},{existing:false});
  assert.equal(await a.run('journalPushSync()'),false);
  assert.equal(a.run('journalSettings().push'),false);
});

test('the settings screen explains the closed-app reminder, and it needs the reminder switched on first',()=>{
  const off=pushPhone({journalSettings:{remind:false}});
  off.a.run('journalOpen()');
  const html=off.a.el('journalContent').innerHTML;
  assert.match(html,/id="journalPush"[^>]*disabled/);
  assert.match(html,/위의 알림을 먼저 켜 주세요/);
  const on=pushPhone({journalSettings:{remind:true}});
  on.a.run('journalOpen()');
  assert.doesNotMatch(on.a.el('journalContent').innerHTML,/id="journalPush"[^>]*disabled/);
  assert.match(on.a.el('journalContent').innerHTML,/기록 내용은 보내지 않아요/);
  const plain=appWith({journalSettings:{remind:true}});
  plain.run('journalOpen()');
  assert.match(plain.el('journalContent').innerHTML,/앱이 열려 있을 때만 알려 드려요/,'a browser without push says so');
});
