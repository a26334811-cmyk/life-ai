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
test('certificate checklist persists after reload without job submission semantics',()=>{
 const a=app();a.run("quickGoal('설비보전산업기사 준비');toggleTask(0);toggleTask(4)");
 assert.equal(a.run('state.jobSubmitted'),false);
 const b=app(a.storage.get('lifeAIPrototypeV5'));b.run('renderTasks()');
 assert.equal((b.el('taskList').innerHTML.match(/checked/g)||[]).length,2);
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
test('interested companies deduplicate and save a manual official link',()=>{
 const a=app();a.el('watchCompany').value='삼천리';a.el('watchUrl').value='https://example.com/careers';a.run('addWatchCompany();addWatchCompany()');assert.equal(a.run('state.watchCompanies.length'),1);
 assert.match(a.el('watchCompanies').innerHTML,/등록한 공식 채용 페이지/);
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
 assert.doesNotMatch(html,/미등록/);
});
test('home next exam shows nothing once every period has ended',()=>{
 const html=homeWith([{label:'필기원서접수',startDate:'2026-05-01',endDate:'2026-05-09'}]);
 assert.match(html,/미등록/);
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

test('renaming a goal refreshes the certificate search name, region and timing but keeps the goal type',async()=>{
 const saved={mainGoal:'정보처리기사 준비',goalType:'cert',parsedGoal:{raw:'정보처리기사 준비',type:'cert',intent:'자격 취득',region:'서울',timing:'올해 안',subject:'정보처리기사',confidence:'high'}};
 const a=app(JSON.stringify(saved),'전기기사 준비');await a.run('editCurrentGoal()');
 assert.equal(a.run('certQueryName()'),'전기기사');assert.equal(a.run('state.parsedGoal.region'),'');assert.equal(a.run('state.parsedGoal.timing'),'');
 assert.equal(a.run('state.goalType'),'cert');assert.equal(a.run('state.parsedGoal.type'),'cert');
});
