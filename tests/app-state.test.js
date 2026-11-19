const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');
const app=(saved,answer)=>createApp(saved,{answer});
test('goal checklist shows the right steps for each goal kind, job goals go to the posting hub',()=>{
 const a=app();
 const show=type=>{a.run(`state.goalType=${JSON.stringify(type)};state.completedTasks=[true,false,false,false,false];renderTasks()`);return {html:a.el('taskList').innerHTML,stage:a.el('stageText').textContent};};
 const count=(html,re)=>(html.match(re)||[]).length;
 const cert=show('cert');assert.equal(cert.stage,'응시 준비');assert.match(cert.html,/응시 일정 확인/);assert.match(cert.html,/시험 응시/);assert.equal(count(cert.html,/type="checkbox"/g),5);assert.equal(count(cert.html,/checked/g),1);
 const policy=show('policy');assert.equal(policy.stage,'조건 확인');assert.match(policy.html,/신청 완료 기록/);
 for(const t of ['custom',null,'something-else']){const r=show(t);assert.equal(r.stage,'실행 준비');assert.match(r.html,/목표 구체화/);assert.equal(count(r.html,/type="checkbox"/g),5);}
 const job=show('job');assert.equal(job.stage,'공고별 지원 관리');assert.match(job.html,/jobHub/);
});
test('qualification names create certificate goals and reset previous progress',()=>{
 const a=app();a.run("state.completedTasks=[true,true,true,true,true];state.jobSubmitted=true;quickGoal('위험물산업기사 준비')");
 assert.equal(a.run('state.goalType'),'cert');assert.equal(a.run('state.jobSubmitted'),false);assert.equal(a.run('state.completedTasks.some(Boolean)'),false);
});
test('all four goal-creation paths reset progress, save the nickname and log the goal',()=>{
 const dirty="state.completedTasks=[true,true,true,true,true];state.jobSubmitted=true;state.certSchedule={items:[]};";
 const paths=[
  {name:'ai',go:a=>{a.run("const orig=document.getElementById;document.getElementById=id=>id==='aiFirstGoal'?{value:'전기기사 올해 취득'}:orig(id);createAIFirstGoal();document.getElementById=orig");},goal:'전기기사 올해 취득',type:'cert',activity:'AI에게 새 목표를 말했어요'},
  {name:'custom',go:a=>{a.el('customGoalInput').value='광양 시설관리 취업';a.run('createCustomGoal()');},goal:'광양 시설관리 취업',type:'job',activity:'목표를 만들었어요'},
  {name:'company',go:a=>{a.run("state.selectedCompany='삼천리';state.selectedJob='시설관리';createGoal()");},goal:'삼천리 시설관리 취업',type:'job',activity:'취업 목표를 만들었어요'},
  {name:'quick',go:a=>{a.run("quickGoal('위험물산업기사 준비')");},goal:'위험물산업기사 준비',type:'cert',activity:'목표를 만들었어요'}
 ];
 for(const p of paths){
  const a=app();a.run(dirty);a.el('nickname').value='지훈';p.go(a);
  assert.equal(a.run('state.mainGoal'),p.goal,p.name);assert.equal(a.run('state.goalType'),p.type,p.name);
  assert.equal(a.run('state.nickname'),'지훈',p.name);assert.equal(a.run('state.jobSubmitted'),false,p.name);
  assert.equal(a.run('state.completedTasks.some(Boolean)'),false,p.name);assert.equal(a.run('state.certSchedule'),null,p.name);
  assert.equal(a.run('state.activity[0]'),p.activity,p.name);assert.equal(a.saved().mainGoal,p.goal,p.name);
  assert.match(a.el('goalCreatedTitle').textContent,new RegExp(p.goal),p.name);
 }
 const c=app();c.run("state.selectedCompany='삼천리';createGoal()");assert.equal(c.run('JSON.stringify(state.parsedGoal)'),'{}');
});
test('certificate checklist persists after reload without job submission semantics',()=>{
 const a=app();a.run("quickGoal('설비보전산업기사 준비');toggleTask(0);toggleTask(4)");
 assert.equal(a.run('state.jobSubmitted'),false);
 const b=app(a.storage.get('lifeAIPrototypeV5'));b.run('renderTasks()');
 assert.equal((b.el('taskList').innerHTML.match(/checked/g)||[]).length,2);
});
test('picking a company and job does not change the goal until the goal is created',()=>{
 const a=app(JSON.stringify({mainGoal:'전기기사 준비',goalType:'cert'}));
 a.run("selectCompany('포스코');selectJob('정비')");
 assert.equal(a.run('state.goalType'),'cert','leaving halfway keeps the old goal type');
 assert.equal(a.run('state.mainGoal'),'전기기사 준비');
 assert.equal(a.run('state.selectedCompany'),'');assert.equal(a.run('state.selectedJob'),'');
 a.run('createGoal()');
 assert.equal(a.run('state.goalType'),'job');
 assert.equal(a.run('state.mainGoal'),'포스코 정비 취업');
 assert.equal(a.run('state.selectedCompany'),'포스코');assert.equal(a.run('state.selectedJob'),'정비');
});
test('job goal home shows the posting-management card and reason',()=>{
 const a=app(JSON.stringify({goalType:'job',mainGoal:'취업 준비',jobSubmitted:true,jobPreparationStarted:true}));
 const cards=a.run('opportunityCards()');
 assert.match(cards,/관심 회사·공고 관리/);assert.match(cards,/취업 관리 열기/);assert.match(cards,/고용24 공고 조회/);assert.doesNotMatch(cards,/채용 예시/);
 assert.equal(a.run('currentAction().title'),'관심 회사와 공고를 관리해보세요');
 assert.equal(a.run('currentAction().cta'),'공고 관리 열기');
});
test('policy input remains editable and does not assert eligibility',()=>{
 const a=app();a.run('saveIncome()');assert.equal(a.run('state.policyIncomeAdded'),false);
 a.el('incomeSelect').value='150% 초과';a.run('saveIncome()');
 assert.match(a.el('incomeResult').textContent,/판단할 수 없어요/);
 assert.equal(a.el('incomeSelect').value,'150% 초과');
});
test('favorite qualification requires selection, deduplicates and survives goal change',()=>{
 const a=app();a.run('saveFavoriteCert()');assert.equal(a.run('(state.favoriteCerts||[]).length'),0);
 a.el('certSearchInput').value='전기기사';a.el('certSearchInput').dataset.code='1150';
 a.run("saveFavoriteCert();saveFavoriteCert();quickGoal('위험물산업기사 준비')");
 assert.equal(a.run('state.favoriteCerts.length'),1);assert.match(a.run('favoriteCertHTML()'),/전기기사/);
});
test('a text-only favorite certificate from an old file is kept with its name and can be removed',async()=>{
 const raw=JSON.stringify({mainGoal:'x',favoriteCerts:['전기기사',{name:'소방설비기사',code:'2290'},{name:'코드 없음'},42]});
 const a=createApp(raw,{search:''});
 assert.equal(JSON.stringify(a.run('state.favoriteCerts')),JSON.stringify([{name:'전기기사',code:''},{name:'소방설비기사',code:'2290'}]));
 assert.match(a.run('favoriteCertHTML()'),/data-name="전기기사"/);
 await a.run("removeFavoriteCert('','전기기사')");
 assert.equal(JSON.stringify(a.run('state.favoriteCerts')),JSON.stringify([{name:'소방설비기사',code:'2290'}]));
 await a.run("removeFavoriteCert('2290','소방설비기사')");
 assert.equal(a.run('state.favoriteCerts.length'),0);
});
test('calendar separates past events and highlights next registration',()=>{
 const a=app();const html=a.run("certCalendarHTML({qualification:{name:'전기기사'},year:2026,items:[{label:'지난 시험',type:'시험',round:'1회',startDate:'2000-01-01',endDate:'2000-01-01'},{label:'접수',type:'필기원서접수',round:'2회',startDate:'2099-01-01',endDate:'2099-01-05'}]})");
 assert.match(html,/다음 접수/);assert.match(html,/<details><summary>지난 일정 1개/);
});

test('saved jobs persist separately with independent stages and deadlines',()=>{
 const a=app();a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='https://example.com/jobs/1';a.el('postingDeadline').value='2099-01-01';a.run('savePosting()');
 a.el('postingCompany').value='다른 회사';a.el('postingTitle').value='정비';a.el('postingUrl').value='https://example.com/jobs/2';a.run('savePosting()');
 a.run("setPostingTask(state.jobPostings[1].id,0,true);setPostingStage(state.jobPostings[1].id,'지원 완료')");
 const b=app(a.storage.get('lifeAIPrototypeV5'));
 assert.equal(b.run('state.jobPostings.length'),2);assert.equal(b.run('state.jobPostings[1].tasks[0]'),true);assert.equal(b.run('state.jobPostings[0].tasks[0]'),false);
 assert.equal(b.run('state.jobPostings[1].stage'),'지원 완료');assert.equal(b.run('state.jobPostings[0].deadline'),'');
 b.run("quickGoal('전기기사 준비')");assert.equal(b.run('state.jobPostings.length'),2);
});
test('posting prep checklist size comes from one list for new postings, saving checks and drawing boxes',()=>{
 const a=app();a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='https://example.com/jobs/1';a.run('savePosting()');
 const n=a.run('POSTING_TASKS.length');
 assert.equal(a.run('state.jobPostings[0].tasks.length'),n);
 assert.equal((a.el('savedPostings').innerHTML.match(/type="checkbox"/g)||[]).length,n);
 a.run(`setPostingTask(state.jobPostings[0].id,${n-1},true)`);assert.equal(a.run(`state.jobPostings[0].tasks[${n-1}]`),true);
 a.run(`setPostingTask(state.jobPostings[0].id,${n},true)`);assert.equal(a.run('state.jobPostings[0].tasks.length'),n);
});
test('posting validation rejects unsafe links and invalid dates',()=>{
 const a=app();a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='javascript:alert(1)';a.run('savePosting()');assert.equal(a.run('state.jobPostings.length'),0);
 a.el('postingUrl').value='https://example.com';a.el('postingDeadline').value='2026-02-30';a.run('savePosting()');assert.equal(a.run('state.jobPostings.length'),0);
});
test('editing a saved job cannot reuse another job\'s link, but may keep its own',()=>{
 const a=app();
 a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='https://example.com/jobs/1';a.run('savePosting()');
 a.el('postingCompany').value='다른 회사';a.el('postingTitle').value='정비';a.el('postingUrl').value='https://example.com/jobs/2';a.run('savePosting()');
 const second=a.run('state.jobPostings[0].id');
 a.el('postingId').value=second;a.el('postingCompany').value='다른 회사';a.el('postingTitle').value='정비';a.el('postingUrl').value='https://example.com/jobs/1';a.run('savePosting()');
 assert.equal(a.run('state.jobPostings.length'),2);
 assert.equal(a.run('state.jobPostings[0].url'),'https://example.com/jobs/2');
 a.el('postingId').value=second;a.el('postingTitle').value='정비 수정';a.el('postingUrl').value='https://example.com/jobs/2';a.run('savePosting()');
 assert.equal(a.run('state.jobPostings[0].title'),'정비 수정');
});
test('fetched exam schedule is saved with rounds only, and the calendar is built from it',async()=>{
 const events=[{type:'필기원서접수',label:'필기원서접수',startDate:'2026-09-01',endDate:'2026-09-05',raw:'2026-09-01 ~ 2026-09-05'},{type:'필기시험',label:'필기시험',startDate:'2026-10-01',endDate:'2026-10-01',raw:'2026-10-01'}];
 const rounds=[{round:'정기 1회',events}];
 const items=events.map(e=>({qualificationName:'전기기사',qualificationCode:'1150',round:'정기 1회',...e}));
 const server={qualification:{code:'1150',name:'전기기사'},year:2026,totalCount:2,rounds,items,source:'Q-Net'};
 const goal=JSON.stringify({mainGoal:'전기기사 준비',goalType:'cert',parsedGoal:{subject:'전기기사'}}); // the schedule of the goal certificate is the one that gets saved (#5)
 const a=createApp(goal,{fetch:async()=>({ok:true,json:async()=>server})});
 a.el('certSearchInput').value='전기기사';a.el('certSearchInput').dataset.code='1150';a.el('certYear').value='2026';
 await a.run('loadLiveCertSchedule()');
 const saved=a.saved().certSchedule;
 assert.ok(saved,'schedule saved');
 assert.equal('items' in saved,false,'flat list is not stored');
 assert.deepEqual(saved.rounds,rounds);
 const html=a.run('certCalendarHTML(state.certSchedule)');
 assert.match(html,/다음 접수/);assert.match(html,/필기시험/);assert.match(html,/정기 1회/);
});
test('schedules saved by older versions (rounds and items, or items only) still show in the calendar',()=>{
 const L=require('../logic.js');
 const events=[{type:'필기시험',label:'필기시험',startDate:'2099-02-01',endDate:'2099-02-01',raw:'2099-02-01'}];
 const item={qualificationName:'전기기사',qualificationCode:'1150',round:'정기 1회',...events[0]};
 const rebuilt=L.scheduleItems({qualification:{name:'전기기사',code:'1150'},rounds:[{round:'정기 1회',events}]});
 assert.deepEqual(rebuilt,[item],'items built from rounds match what the server used to send');
 assert.deepEqual(L.scheduleItems({items:[item]}),[item]);
 assert.deepEqual(L.scheduleItems(null),[]);
 for(const old of [{qualification:{name:'전기기사',code:'1150'},year:2099,rounds:[{round:'정기 1회',events}],items:[item]},{qualification:{name:'전기기사'},year:2099,items:[item]}]){
  const a=app(JSON.stringify({mainGoal:'전기기사 준비',goalType:'cert',certSchedule:old}));
  assert.match(a.run('certCalendarHTML(state.certSchedule)'),/필기시험/);
 }
});

test('script-like text in postings and goals is shown as plain text on every screen',()=>{
 const evil='<img src=x onerror=alert(1)>';
 const noRaw=(html,where)=>{assert.doesNotMatch(html,/<img/,where);assert.match(html,/&lt;img/,where);};
 const a=app();
 a.el('postingCompany').value=evil+'회사';a.el('postingTitle').value=evil+'공고';a.el('postingUrl').value='https://example.com/jobs/evil';
 a.el('postingRegion').value=evil+'지역';a.el('postingNotes').value=evil+'메모';a.el('postingDeadline').value='2026-05-10';
 a.run('savePosting()');assert.equal(a.run('state.jobPostings.length'),1);
 // Reload from storage, the same path a restored backup takes.
 const b=app(a.storage.get('lifeAIPrototypeV5'));
 assert.equal(b.run('state.jobPostings.length'),1);
 b.run('renderJobHub()');noRaw(b.el('savedPostings').innerHTML,'job list');
 b.run("plannerSelected='2026-05-10';plannerView='day';renderCalendar()");noRaw(b.el('calendarContent').innerHTML,'planner');
 const c=app(JSON.stringify({mainGoal:evil+' 준비',goalType:'cert'}));
 noRaw(c.run('opportunityCards()'),'opportunities');
});
test('very long goal text is refused so it cannot vanish on the next launch',()=>{
 const {html}=require('./helpers/app-harness.js');
 for(const id of ['customGoalInput','companyInput','jobInput','certInput','careerInput','certOwnedInput'])
  assert.match(html,new RegExp(`<input id="${id}"[^>]*maxlength="\\d+"`),id);
 const a=app();
 a.el('customGoalInput').value='가'.repeat(121);a.run('createCustomGoal()');
 assert.equal(a.run('state.mainGoal'),'');assert.match(a.toasts.at(-1),/120자/);
 a.el('customGoalInput').value='가'.repeat(120);a.run('createCustomGoal()');
 assert.equal(a.run('state.mainGoal.length'),120);
});
test('interested companies deduplicate and save a manual official link',()=>{
 const a=app();a.el('watchCompany').value='삼천리';a.el('watchUrl').value='https://example.com/careers';a.run('addWatchCompany();addWatchCompany()');assert.equal(a.run('state.watchCompanies.length'),1);
 assert.match(a.el('watchCompanies').innerHTML,/등록한 공식 채용 페이지/);
});

test('interested companies list shows a guide when empty and drops it once one is added',async()=>{
 const a=app(undefined,true);a.run('renderJobHub()');
 assert.match(a.el('watchCompanies').innerHTML,/아직 관심 회사가 없어요/);
 a.el('watchCompany').value='삼천리';a.run('addWatchCompany()');
 assert.doesNotMatch(a.el('watchCompanies').innerHTML,/아직 관심 회사가 없어요/);
 await a.run('removeWatchCompany(state.watchCompanies[0].id)');
 assert.match(a.el('watchCompanies').innerHTML,/아직 관심 회사가 없어요/);
});

test('returning-user initialization uses existing HTML ids',()=>{
 const a=app(JSON.stringify({mainGoal:'전기기사 준비',goalType:'cert'}));
 assert.equal(a.el('startBtn'),null);assert.match(a.el('homeContent').innerHTML,/전기기사/);
});
test('deadline today is shown as today, not D-1',()=>{
 const a=app();assert.equal(a.run('daysUntil(koreaToday())'),'오늘 마감');assert.equal(a.run("daysUntil('2026-02-30')"),'');
});
test('interview date survives reload and appears in calendar',()=>{
 const a=app();a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='https://example.com/jobs';a.run('savePosting();setInterviewDate(state.jobPostings[0].id,"2099-03-04")');
 const b=app(a.storage.get('lifeAIPrototypeV5'));
 const day=JSON.parse(b.run("JSON.stringify(plannerForDate('2099-03-04'))"));
 assert.equal(day.length,1);assert.match(day[0].title,/삼천리 · 시설관리 면접/);
 assert.equal(JSON.parse(b.run("JSON.stringify(plannerForDate('2099-03-05'))")).length,0);
 b.run("state.jobPostings[0].stage='불합격'");
 assert.equal(JSON.parse(b.run("JSON.stringify(plannerForDate('2099-03-04'))")).length,0,'finished postings do not show interviews');
});

test('date fields: blank deadline and interview date are allowed, wrong dates are rejected, planner date is required',async()=>{
 const a=app();
 a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='https://example.com/jobs/9';a.el('postingDeadline').value='';
 a.run('savePosting()');assert.equal(a.run('state.jobPostings.length'),1);
 const id=a.run('state.jobPostings[0].id');
 a.run(`setInterviewDate(${JSON.stringify(id)},"2099-03-04")`);assert.equal(a.run('state.jobPostings[0].interviewDate'),'2099-03-04');
 a.run(`setInterviewDate(${JSON.stringify(id)},"2099-02-30")`);assert.equal(a.run('state.jobPostings[0].interviewDate'),'2099-03-04');
 a.run(`setInterviewDate(${JSON.stringify(id)},"")`);assert.equal(a.run('state.jobPostings[0].interviewDate'),'');
 const p=app();
 const form=(title,date,until)=>{p.el('plannerTitle').value=title;p.el('plannerDate').value=date;p.el('plannerTime').value='';p.el('plannerCategory').value='personal';p.el('plannerRepeat').value='none';p.el('plannerUntil').value=until||'';p.el('plannerPriority').value='normal';};
 const count=()=>p.run('(state.plannerEntries||[]).length');
 form('병원','');await p.run('plannerSave()');assert.equal(count(),0);
 form('병원','2026-02-30');await p.run('plannerSave()');assert.equal(count(),0);
 form('병원','2026-05-12');await p.run('plannerSave()');assert.equal(count(),1);
 assert.equal(p.run('typeof validDeadline'),'undefined');
});
test('saved posting without a checklist (old backup) still renders and can be checked',()=>{
 const saved={mainGoal:'전기기사 준비',goalType:'cert',jobPostings:[{id:'x1',company:'백업회사',title:'정비',url:'https://example.com/j',stage:'관심'}]};
 const a=app(JSON.stringify(saved));
 a.run('renderJobHub()');
 assert.match(a.el('savedPostings').innerHTML,/백업회사/);
 a.run("setPostingTask('x1',1,true)");
 assert.equal(a.run('state.jobPostings[0].tasks[1]'),true);assert.equal(a.run('state.jobPostings[0].tasks.length'),4);
});

test('applied or rejected postings leave the calendar and the 7-day agenda',()=>{
 const a=app();a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='https://example.com/jobs/1';
 a.el('postingDeadline').value=a.run('plannerDateOffset(koreaToday(),2)');a.run('savePosting()');
 const date=a.run('state.jobPostings[0].deadline');
 const inDay=()=>a.run(`JSON.stringify(plannerForDate('${date}'))`),inAgenda=()=>a.run('JSON.stringify(plannerAgenda())');
 assert.match(inDay(),/삼천리/);assert.match(inAgenda(),/삼천리/);
 for(const stage of ['지원 완료','불합격','지원 취소']){
  a.run(`setPostingStage(state.jobPostings[0].id,'${stage}')`);
  assert.doesNotMatch(inDay(),/삼천리/,stage);assert.doesNotMatch(inAgenda(),/삼천리/,stage);
 }
 a.run("setPostingStage(state.jobPostings[0].id,'준비 중')");assert.match(inAgenda(),/삼천리/);
});

test('live qualification schedule escapes dates from the server before showing them',async()=>{
 const evil='<img src=x onerror=alert(1)>';
 const a=createApp(undefined,{fetch:async()=>({ok:true,json:async()=>({qualification:{name:'전기기사',code:'1150'},items:[{}],rounds:[{round:'1회',events:[{label:'필기',startDate:evil,endDate:evil+'2'}]}]})})});
 a.el('certSearchInput').value='전기기사';
 await a.run('loadLiveCertSchedule()');
 const html=a.el('liveCertResults').innerHTML;
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});

test('renaming preserves checklist and saved qualification schedule',async()=>{
 const saved={mainGoal:'전기기사 준비',goalType:'cert',completedTasks:[true,false,false,false,false],certSchedule:{qualification:{name:'전기기사'},items:[]}};
 const a=app(JSON.stringify(saved),'전기기사 올해 취득');await a.run('editCurrentGoal()');
 assert.equal(a.run('state.completedTasks[0]'),true);assert.equal(a.run('state.certSchedule.qualification.name'),'전기기사');assert.equal(a.run('state.mainGoal'),'전기기사 올해 취득');
});

const homeWith=events=>{
 const schedule={qualification:{name:'전기기사'},rounds:[{round:'1회',events}]};
 const a=app();a.run('state.certSchedule='+JSON.stringify(schedule));a.run('renderHome()');
 return a.el('homeContent').innerHTML;
};
test('home next exam keeps an application period that already started but has not ended',()=>{
 // fake clock is 2026-05-10
 const html=homeWith([
  {label:'필기원서접수',startDate:'2026-05-05',endDate:'2026-05-12'},
  {label:'지난 시험',startDate:'2026-04-01',endDate:'2026-04-01'},
  {label:'필기시험',startDate:'2026-06-01',endDate:'2026-06-01'}]);
 assert.match(html,/1회 · 필기원서접수/);
 assert.doesNotMatch(html,/지난 시험/);
 assert.doesNotMatch(html,/다가오는 시험 확인/);
});
test('home next exam shows nothing once every period has ended',()=>{
 const html=homeWith([{label:'필기원서접수',startDate:'2026-05-01',endDate:'2026-05-09'}]);
 assert.match(html,/다가오는 시험 확인/);
});

// #5: looking up another certificate (or an old year) must not replace the goal's saved schedule.
const certData=(name,date)=>({qualification:{name,code:'1'},items:[{label:'필기시험'}],rounds:[{round:'1회',events:[{label:'필기시험',startDate:date,endDate:date}]}]});
const certApp=(saved,data)=>createApp(saved,{fetch:async url=>({ok:true,json:async()=>data(url)})});
test('looking up another certificate does not overwrite the goal schedule',async()=>{
 const saved=JSON.stringify({mainGoal:'위험물산업기사 준비',goalType:'cert',parsedGoal:{subject:'위험물산업기사'},certSchedule:certData('위험물산업기사','2026-06-20')});
 const a=certApp(saved,()=>certData('전기기사','2026-07-01'));
 a.el('certYear').value='2026';a.el('certSearchInput').value='전기기사';
 await a.run('loadLiveCertSchedule()');
 assert.equal(a.run('state.certSchedule.qualification.name'),'위험물산업기사');
 assert.match(a.el('liveCertResults').innerHTML,/1회/);
});
test('goal certificate: older/later year keeps saved schedule, current year replaces it',async()=>{
 const saved=JSON.stringify({mainGoal:'위험물산업기사 준비',goalType:'cert',parsedGoal:{subject:'위험물산업기사'},certSchedule:certData('위험물산업기사','2026-06-20')});
 const a=certApp(saved,url=>certData('위험물산업기사',/year=2025/.test(url)?'2025-06-20':/year=2027/.test(url)?'2027-06-20':'2026-08-01'));
 a.el('certSearchInput').value='위험물산업기사';
 a.el('certYear').value='2025';await a.run('loadLiveCertSchedule()');
 assert.equal(a.run('state.certSchedule.rounds[0].events[0].startDate'),'2026-06-20');
 a.el('certYear').value='2027';await a.run('loadLiveCertSchedule()');
 assert.equal(a.run('state.certSchedule.rounds[0].events[0].startDate'),'2026-06-20');
 a.el('certYear').value='2026';await a.run('loadLiveCertSchedule()');
 assert.equal(a.run('state.certSchedule.rounds[0].events[0].startDate'),'2026-08-01');
 assert.equal(a.saved().certSchedule.rounds[0].events[0].startDate,'2026-08-01');
});
test('starting a certificate goal saves the schedule that was looked up for it',async()=>{
 const a=certApp(JSON.stringify({mainGoal:'위험물산업기사 준비',goalType:'cert',parsedGoal:{subject:'위험물산업기사'}}),()=>certData('전기기사','2026-07-01'));
 a.el('certYear').value='2026';a.el('certSearchInput').value='전기기사';
 await a.run('loadLiveCertSchedule()');
 assert.equal(a.run('Boolean(state.certSchedule)'),false);
 a.run('startCertGoal()');
 assert.equal(a.run('state.mainGoal'),'전기기사 준비');
 assert.equal(a.run('state.certSchedule.qualification.name'),'전기기사');
});

// #44: entering the certificate screen shows what is already known instead of asking the server again.
test('certificate screen shows the saved schedule with its lookup date and does not ask the server',()=>{
 let calls=0;
 const saved=JSON.stringify({mainGoal:'위험물산업기사 준비',goalType:'cert',parsedGoal:{subject:'위험물산업기사'},
  certSchedule:{...certData('위험물산업기사','2026-06-20'),year:2026,fetchedAt:'2026-05-01T01:00:00.000Z'}});
 const a=createApp(saved,{fetch:async()=>{calls++;throw new Error('offline');}});
 a.el('certYear').options=[{value:'2025'},{value:'2026'}];
 a.run('initCertSearch()');
 assert.equal(calls,0);
 assert.equal(a.el('certSearchInput').value,'위험물산업기사');
 assert.match(a.el('liveCertStatus').innerHTML,/저장된 일정 · 조회일 2026-05-01/);
 assert.match(a.el('liveCertResults').innerHTML,/1회/);
 assert.equal(a.el('certYear').value,'2026');
});
test('certificate screen keeps the chosen item and result when you come back, and searches only when nothing is known',async()=>{
 const a=certApp(JSON.stringify({}),()=>certData('전기기사','2026-07-01'));
 a.el('certYear').options=[{value:'2026'}];
 a.el('certYear').value='2026';a.el('certSearchInput').value='전기기사';a.el('certSearchInput').dataset.code='1150';
 await a.run('loadLiveCertSchedule()');
 a.el('liveCertResults').innerHTML='';a.el('liveCertStatus').innerHTML='';
 a.run('initCertSearch()');
 assert.equal(a.el('certSearchInput').dataset.code,'1150');
 assert.match(a.el('liveCertStatus').innerHTML,/저장된 일정/);
 assert.match(a.el('liveCertResults').innerHTML,/1회/);
 const b=certApp(JSON.stringify({}),()=>certData('전기기사','2026-07-01'));
 b.el('certYear').options=[{value:'2026'}];b.el('certSearchInput').value='전기기사';
 b.run('initCertSearch()');
 assert.match(b.el('certSearchMatches').innerHTML,/종목 검색 중/);
});

test('after a backup restore, a late timer save cannot overwrite the restored data',async()=>{
 const a=createApp(JSON.stringify({mainGoal:'옛 목표',goalType:'custom',nickname:'나'}),{search:''});
 const backupState=JSON.parse(JSON.stringify(a.run('state')));backupState.mainGoal='복원한 목표';
 const file={size:100,text:async()=>JSON.stringify({format:'life-ai-backup',version:1,state:backupState})};
 a.run('var __reloaded=0;var __release;location.reload=()=>{__reloaded++};uiAlert=()=>new Promise(r=>{__release=r})');
 const pending=a.run('importLifeAIBackup')({files:[file]});
 for(let i=0;i<20&&a.saved().mainGoal!=='복원한 목표';i++)await new Promise(r=>setImmediate(r));
 assert.equal(a.saved().mainGoal,'복원한 목표');
 a.run('persistState()');// the old in-memory state must not be written while the notice is open
 assert.equal(a.saved().mainGoal,'복원한 목표');
 a.run('__release()');await pending;
 assert.equal(a.run('__reloaded'),1);assert.equal(a.saved().mainGoal,'복원한 목표');
});

test('Home still draws when saved certSchedule rounds are malformed',()=>{
 const a=app(JSON.stringify({mainGoal:'전기기사 준비',goalType:'cert',certSchedule:{qualification:{name:'전기기사'},rounds:[null,{round:'1회'},{round:'2회',events:[null]}]}}));
 assert.doesNotThrow(()=>a.run('renderHome()'));assert.match(a.el('homeContent').innerHTML,/전기기사/);
 assert.equal(a.run('state.certSchedule.rounds.length'),0);
 assert.doesNotThrow(()=>a.run('state.certSchedule.rounds=[null,{round:"x"},{round:"y",events:[null]}];renderHome()'));
});

test('calendar day buttons announce date, weekday, event count, today and selection',()=>{
 const a=app();
 assert.equal(a.run("plannerDayLabel('2026-11-18',2,true)"),'11월 18일 수요일, 일정 2개, 오늘');
 assert.equal(a.run("plannerDayLabel('2026-11-19',0,false)"),'11월 19일 목요일, 일정 없음');
 a.run('renderCalendar()');
 const html=a.el('calendarContent').innerHTML;
 assert.match(html,/aria-label="\d+월 \d+일 [가-힣]요일, 일정 (없음|\d+개)(, 오늘)?" aria-pressed="(true|false)"/);
 assert.match(html,/aria-pressed="true"/);assert.doesNotMatch(html,/일정 보기"/);
});

const fakeDialogDom=a=>{
 const made=[];
 const mk=tag=>{const e={tag,attrs:{},children:[],listeners:{},id:'',textContent:'',className:'',
  setAttribute(k,v){this.attrs[k]=v;},appendChild(c){this.children.push(c);return c;},addEventListener(t,f){this.listeners[t]=f;},
  remove(){},focus(){a.context.document.activeElement=this;}};made.push(e);return e;};
 const d=a.context.document;
 d.createElement=mk;d.addEventListener=()=>{};d.removeEventListener=()=>{};d.activeElement=null;d.body={appendChild(){}};
 return made;
};
test('dialogs link the title (labelledby) and the message (describedby)',async()=>{
 const a=app();const made=fakeDialogDom(a);
 a.run("uiAsk({title:'백업 복원',message:'정말 복원할까요?',cancelValue:false,buttons:[{label:'취소',value:false},{label:'확인',value:true}]})");
 await new Promise(r=>setImmediate(r));
 const box=made.find(e=>e.attrs.role==='dialog');
 const h=made.find(e=>e.tag==='h3'),p=made.find(e=>e.tag==='p');
 assert.equal(box.attrs['aria-labelledby'],h.id);assert.equal(box.attrs['aria-describedby'],p.id);
 assert.ok(h.id&&p.id&&h.id!==p.id);assert.equal(box.attrs['aria-label'],undefined);
});
test('a dialog without a title is still named and described',async()=>{
 const a=app();const made=fakeDialogDom(a);
 a.run("uiAsk({message:'이 일정을 삭제할까요?',cancelValue:false,buttons:[{label:'확인',value:true}]})");
 await new Promise(r=>setImmediate(r));
 const box=made.find(e=>e.attrs.role==='dialog');
 assert.equal(box.attrs['aria-label'],'확인');assert.equal(box.attrs['aria-describedby'],made.find(e=>e.tag==='p').id);
});

test('go() moves focus to the new screen heading and never throws when focus is unavailable',()=>{
 const a=app();
 const calls=[];
 a.el('my').querySelector=sel=>({setAttribute:(k,v)=>calls.push([k,v,sel]),focus:o=>calls.push(['focus',o])});
 a.run("go('my')");
 assert.deepEqual(calls.map(c=>c[0]),['tabindex','focus']);assert.equal(calls[0][1],'-1');assert.equal(calls[1][1].preventScroll,true);
 a.el('my').querySelector=()=>{throw new Error('no dom');};
 assert.doesNotThrow(()=>a.run("go('my')"));
 a.el('my').querySelector=()=>null;
 assert.doesNotThrow(()=>a.run("go('my')"));});

test('goal type is not guessed from a lone 기사 or 회사',()=>{
 const a=app();const type=t=>a.run(`inferGoal(${JSON.stringify(t)}).type`);
 for(const t of ['뉴스 기사 매일 읽기','택시기사 일 시작','회사 끝나고 운동하기']) assert.equal(type(t),'custom',t);
 for(const t of ['전기기사 준비','전기기사 올해 취득','위험물산업기사','정보처리기사를 따기','기사 자격증 따기']) assert.equal(type(t),'cert',t);
 for(const t of ['회사 취업 준비','삼천리 입사','회사 지원하기','이직 준비']) assert.equal(type(t),'job',t);
});

test('renaming a goal refreshes the certificate search name, region and timing but keeps the goal type',async()=>{
 const saved={mainGoal:'정보처리기사 준비',goalType:'cert',parsedGoal:{raw:'정보처리기사 준비',type:'cert',intent:'자격 취득',region:'서울',timing:'올해 안',subject:'정보처리기사',confidence:'high'}};
 const a=app(JSON.stringify(saved),'전기기사 준비');await a.run('editCurrentGoal()');
 assert.equal(a.run('certQueryName()'),'전기기사');assert.equal(a.run('state.parsedGoal.region'),'');assert.equal(a.run('state.parsedGoal.timing'),'');
 assert.equal(a.run('state.goalType'),'cert');assert.equal(a.run('state.parsedGoal.type'),'cert');
});
