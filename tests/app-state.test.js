const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const script=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function app(saved){
 const elements=new Map(),storage=new Map(saved?[['lifeAIPrototypeV5',saved]]:[]);
 const el=id=>{if(!elements.has(id)) elements.set(id,{value:'',dataset:{},innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}}});return elements.get(id);};
 const context=vm.createContext({document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[]},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout:()=>0,clearTimeout(){},requestAnimationFrame(){},Intl,Date,URL,AbortController,console,confirm:()=>true});
 vm.runInContext(script,context);
 return {run:code=>vm.runInContext(code,context),el,storage};
}
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
