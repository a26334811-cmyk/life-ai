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

/* ---------- #392 opportunity filter works from the card's own kind, also for a job goal ---------- */
function opportunityScreen(goalType,mainGoal,filter){
  const a=createApp(JSON.stringify({mainGoal,goalType,nickname:'a',activity:[],completedTasks:[false,false,false,false,false]}));
  const feed=a.el('opportunityFeed');
  // a tiny stand-in for the browser: finds every element carrying data-kind in the feed html
  feed.querySelectorAll=sel=>{
    assert.equal(sel,'[data-kind]');
    return [...feed.innerHTML.matchAll(/data-kind="(\w+)"/g)].map(m=>({dataset:{kind:m[1]},style:{}}));
  };
  a.run(`filterOpportunities('${filter}')`);
  return feed.innerHTML;
}
const EMPTY=/이 종류의 기회는 아직 없어요/;
test('a job goal shows its opportunity card under "all" and "job", and none under other filters',()=>{
  assert.doesNotMatch(opportunityScreen('job','삼천리 시설관리 지원','all'),EMPTY);
  assert.doesNotMatch(opportunityScreen('job','삼천리 시설관리 지원','job'),EMPTY);
  assert.match(opportunityScreen('job','삼천리 시설관리 지원','cert'),EMPTY);
  assert.match(opportunityScreen('job','삼천리 시설관리 지원','policy'),EMPTY);
});
test('cert, policy and general goals are counted by their own kind',()=>{
  assert.doesNotMatch(opportunityScreen('cert','전기기사 준비','cert'),EMPTY);
  assert.doesNotMatch(opportunityScreen('cert','전기기사 준비','job'),EMPTY);
  assert.match(opportunityScreen('cert','전기기사 준비','policy'),EMPTY);
  assert.doesNotMatch(opportunityScreen('policy','청년 월세 지원','policy'),EMPTY);
  assert.match(opportunityScreen('policy','청년 월세 지원','cert'),EMPTY);
  assert.doesNotMatch(opportunityScreen('other','건강 챙기기','all'),EMPTY);
  assert.match(opportunityScreen('other','건강 챙기기','job'),EMPTY);
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

/* ---------- #266 one-line add on the Today tab ---------- */
const entries=a=>a.saved().plannerEntries;
test('the Today tab has a title box and saves a plain one-off item for today',()=>{
  const a=createApp();
  a.run('renderCalendar()');
  assert.match(a.el('calendarContent').innerHTML,/id="plannerQuickTitle"/);
  a.el('plannerQuickTitle').value='  자기소개서 쓰기  ';
  a.run('plannerQuickAdd()');
  const saved=entries(a);
  assert.equal(saved.length,1);
  assert.equal(saved[0].title,'자기소개서 쓰기');
  assert.equal(saved[0].date,'2026-05-10');
  assert.equal(saved[0].repeat,'none');
  assert.equal(saved[0].priority,'normal');
  assert.equal(saved[0].category,'personal');
  assert.ok(saved[0].id);
  assert.equal(a.run("plannerForDate('2026-05-10').some(e=>e.title==='자기소개서 쓰기')"),true);
});
test('the quick add refuses an empty or over-long title and saves nothing',()=>{
  const a=createApp();
  a.el('plannerQuickTitle').value='   ';
  a.run('plannerQuickAdd()');
  a.el('plannerQuickTitle').value='가'.repeat(121);
  a.run('plannerQuickAdd()');
  assert.equal(a.run('plannerEntries().length'),0);
  assert.equal(a.toasts.length,2);
  a.el('plannerQuickTitle').value='가'.repeat(120);
  a.run('plannerQuickAdd()');
  assert.equal(entries(a).length,1);
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


// default fake clock: 2026-05-10 (Korea time)
const upcoming=a=>JSON.parse(a.run('JSON.stringify(plannerUpcomingPriority().map(e=>[e.title,e.date]))'));
const withEntries=entries=>createApp(JSON.stringify({mainGoal:'x',schemaVersion:2,plannerEntries:entries}));

/* ---------- #93 upcoming priority card for repeating items ---------- */
test('a high-priority daily item started in the past still shows with its next date',()=>{
  const a=withEntries([{id:'d',title:'매일 공부',date:'2026-05-01',repeat:'daily',priority:'high'}]);
  assert.deepEqual(upcoming(a),[['매일 공부','2026-05-10']]);
});

test('a repeating item moves to the next day once today is ticked',()=>{
  const a=withEntries([{id:'d',title:'매일 공부',date:'2026-05-01',repeat:'daily',priority:'high',doneDates:['2026-05-10']}]);
  assert.deepEqual(upcoming(a),[['매일 공부','2026-05-11']]);
});

test('a weekly item shows its next weekly date, and a skipped first date is not listed',()=>{
  const a=withEntries([{id:'w',title:'주간 복습',date:'2026-05-04',repeat:'weekly',priority:'high'}]);
  assert.deepEqual(upcoming(a),[['주간 복습','2026-05-11']]);
  const b=withEntries([{id:'s',title:'단축',date:'2026-05-10',repeat:'daily',priority:'high',skipDates:['2026-05-10']}]);
  assert.deepEqual(upcoming(b),[['단축','2026-05-11']]);
});

test('a monthly item shows on its next monthly date',()=>{
  const a=withEntries([{id:'m',title:'월말 정리',date:'2026-01-31',repeat:'monthly',priority:'high'}]);
  assert.deepEqual(upcoming(a),[['월말 정리','2026-05-31']]);
});

test('a repeating item that ended, normal-priority items and finished one-time items are left out',()=>{
  const a=withEntries([
    {id:'e',title:'끝난 반복',date:'2026-04-01',repeat:'daily',until:'2026-05-01',priority:'high'},
    {id:'n',title:'보통',date:'2026-05-12',priority:'normal'},
    {id:'f',title:'끝낸 일',date:'2026-05-12',priority:'high',done:true},
    {id:'o',title:'한 번 일정',date:'2026-05-20',priority:'high'},
    {id:'p',title:'지난 일정',date:'2026-05-01',priority:'high'}]);
  assert.deepEqual(upcoming(a),[['한 번 일정','2026-05-20']]);
});

/* ---------- #113 keyboard use of the planner tabs ---------- */
test('arrow keys, Home and End pick the next planner tab; other keys do nothing',()=>{
  const a=createApp();
  const go=(tab,key)=>a.run(`plannerTabTarget(${JSON.stringify(tab)},${JSON.stringify(key)})`);
  assert.equal(go('today','ArrowRight'),'calendar');
  assert.equal(go('stats','ArrowRight'),'today');
  assert.equal(go('today','ArrowLeft'),'stats');
  assert.equal(go('habits','Home'),'today');
  assert.equal(go('habits','End'),'stats');
  assert.equal(go('habits','a'),null);
  assert.equal(go('nope','ArrowRight'),null);
});

test('planner tabs and panels are linked by id, aria-controls and aria-labelledby, and only the chosen tab is tabbable',()=>{
  const {html}=require('./helpers/app-harness.js');
  assert.match(html,/id="plannerTab-\$\{tab\}"[^`]*aria-controls="plannerPanel-\$\{tab\}"[^`]*tabindex="\$\{plannerActiveTab===tab\?0:-1\}"[^`]*onkeydown="plannerTabKey\(event,'\$\{tab\}'\)"/);
  for(const tab of ['today','calendar','habits','stats']){
    assert.match(html,new RegExp(`id="plannerPanel-${tab}" data-tab="${tab}" role="tabpanel" aria-labelledby="plannerTab-${tab}"`));
  }
});

/* ---------- #114 bottom menu for screen readers ---------- */
test('bottom menu has a name, hides its symbols, and marks the current screen with aria-current',()=>{
  const {html}=require('./helpers/app-harness.js');
  assert.match(html,/<nav id="bottomnav" class="bottomnav" aria-label="주요 메뉴">/);
  assert.equal((html.match(/<span class="navicon" aria-hidden="true">/g)||[]).length,5);
  assert.equal(/<span class="navicon">/.test(html),false);
  const a=createApp();
  a.context.__buttons=['home','my'].map(target=>({target,active:false,attrs:{},
    classList:{add(){this.owner.active=true;},remove(){this.owner.active=false;}},
    setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}}));
  a.context.__buttons.forEach(b=>{b.classList.owner=b;});
  a.run(`document.querySelectorAll=sel=>{
    if(sel==='.bottomnav button')return __buttons;
    const m=sel.match(/data-target="(\\w+)"/);
    return m?__buttons.filter(b=>b.target===m[1]):[];
  }`);
  a.run("go('my')");
  const [home,my]=a.context.__buttons;
  assert.equal(my.attrs['aria-current'],'page');
  assert.equal(home.attrs['aria-current'],undefined);
  a.run("go('home')");
  assert.equal(home.attrs['aria-current'],'page');
  assert.equal(my.attrs['aria-current'],undefined);
});

/* ---------- #115 first-run inputs have names ---------- */
test('first-run input fields carry an accessible name, not just a placeholder',()=>{
  const {html}=require('./helpers/app-harness.js');
  for(const [id,name] of [['nickname','이름'],['companyInput','회사명'],['jobInput','직무'],['certInput','자격증'],['customGoalInput','내 목표']]){
    assert.match(html,new RegExp(`<input id="${id}" aria-label="${name}"`));
  }
});

/* ---------- #124 secrets stay out of git ---------- */
test('.gitignore keeps .env files out but still tracks .env.example',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const lines=fs.readFileSync(path.join(__dirname,'..','.gitignore'),'utf8').split(/\r?\n/).map(l=>l.trim());
  for(const rule of ['.env','.env.*','!.env.example','node_modules/','.netlify/']) assert.ok(lines.includes(rule),rule);
  assert.ok(lines.indexOf('!.env.example')>lines.indexOf('.env.*'),'the .env.example exception must come after .env.*');
});
