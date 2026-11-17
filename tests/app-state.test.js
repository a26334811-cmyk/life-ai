const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');
const app=(saved,answer)=>createApp(saved,{answer});
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
 assert.doesNotMatch(b.run('jobCalendarHTML()'),/삼천리/);assert.match(b.run('jobCalendarHTML()'),/마감일 미정/);
 b.run("quickGoal('전기기사 준비')");assert.equal(b.run('state.jobPostings.length'),2);
});
test('posting validation rejects unsafe links and invalid dates',()=>{
 const a=app();a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='javascript:alert(1)';a.run('savePosting()');assert.equal(a.run('state.jobPostings.length'),0);
 a.el('postingUrl').value='https://example.com';a.el('postingDeadline').value='2026-02-30';a.run('savePosting()');assert.equal(a.run('state.jobPostings.length'),0);
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
 const b=app(a.storage.get('lifeAIPrototypeV5'));assert.match(b.run('jobCalendarHTML()'),/다가오는 면접/);assert.match(b.run('jobCalendarHTML()'),/2099.03.04/);
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
