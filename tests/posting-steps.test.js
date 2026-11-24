const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../logic.js');
const {createApp}=require('./helpers/app-harness.js');

/* Several steps per posting: 서류 발표, 인적성, 1차·2차 면접 ... (idea 4 of the job-seeker review). */
const NOW=Date.parse('2026-11-16T03:00:00Z'); // 2026-11-16 12:00 Korea time
const base=(extra={})=>({id:'p1',company:'삼천리',title:'시설관리',url:'https://e.com/1',deadline:'2026-11-20',stage:'지원 완료',tasks:[false,false,false,false],...extra});
// The fake page only knows the ids of the fixed HTML, so the input boxes drawn inside a card are made up on demand.
const appWith=(posting)=>{
  const a=createApp(JSON.stringify({mainGoal:'x',goalType:'job',jobPostings:[posting]}),{now:NOW});
  const doc=a.context.document,real=doc.getElementById,made={};
  doc.getElementById=id=>real(id)||(/^step(Label|Date|Time)-/.test(id)?(made[id]=made[id]||{value:''}):null);
  a.made=made;
  return a;
};
const addStep=(a,label,date,time='',id='p1')=>{
  a.made['stepLabel-'+id]={value:label};a.made['stepDate-'+id]={value:date};a.made['stepTime-'+id]={value:time};
  a.run(`addPostingEvent('${id}')`);
};
const steps=a=>a.saved().jobPostings[0].events||[];

test('adding steps saves them in date order and the card lists them',()=>{
  const a=appWith(base());
  addStep(a,'1차 면접','2026-11-28','14:00');
  addStep(a,'서류 발표','2026-11-22');
  assert.equal(steps(a).length,2);
  assert.deepEqual(steps(a).map(e=>[e.label,e.date,e.time]),[['1차 면접','2026-11-28','14:00'],['서류 발표','2026-11-22','']]);
  assert.match(a.toasts.at(-1),/전형 일정을 추가했어요/);
  a.run('renderJobHub()');
  const card=a.el('savedPostings').innerHTML;
  assert.ok(card.indexOf('서류 발표')<card.indexOf('1차 면접'),'listed by date');
  assert.match(card,/전형 이름/);
});

test('bad input is refused: empty name, no date, wrong time, duplicate, and more than the limit',()=>{
  const a=appWith(base());
  addStep(a,'  ','2026-11-22');assert.match(a.toasts.at(-1),/전형 이름/);
  addStep(a,'서류 발표','');assert.match(a.toasts.at(-1),/날짜/);
  addStep(a,'서류 발표','2026-02-30');assert.match(a.toasts.at(-1),/날짜/);
  addStep(a,'서류 발표','2026-11-22','25:00');assert.match(a.toasts.at(-1),/시각/);
  addStep(a,'가'.repeat(41),'2026-11-22');assert.match(a.toasts.at(-1),/전형 이름/);
  assert.equal(a.run('state.jobPostings[0].events?.length||0'),0);
  addStep(a,'서류 발표','2026-11-22');
  addStep(a,'서류 발표','2026-11-22');assert.match(a.toasts.at(-1),/이미 있어요/);
  assert.equal(steps(a).length,1);
  for(let i=0;i<19;i++)addStep(a,'면접 '+i,'2026-12-'+String(i+1).padStart(2,'0'));
  assert.equal(steps(a).length,20);
  addStep(a,'하나 더','2026-12-30');assert.match(a.toasts.at(-1),/20개까지/);
  assert.equal(steps(a).length,20);
});

test('a step can be removed',()=>{
  const a=appWith(base());
  addStep(a,'서류 발표','2026-11-22');addStep(a,'1차 면접','2026-11-28');
  const first=steps(a)[0].id;
  a.run(`removePostingEvent('p1','${first}')`);
  assert.deepEqual(steps(a).map(e=>e.label),['1차 면접']);
  a.run("removePostingEvent('p1','nope')");a.run("removePostingEvent('missing','x')");
  assert.equal(steps(a).length,1);
});

test('steps appear on the planner day (with the time), in the banner and in the alert list',()=>{
  const a=appWith(base({events:[{id:'s1',label:'1차 면접',date:'2026-11-17',time:'14:00'},{id:'s2',label:'서류 발표',date:'2026-11-30',time:''}]}));
  const day=JSON.parse(a.run("JSON.stringify(plannerForDate('2026-11-17'))"));
  const step=day.find(e=>e.postingId==='p1');
  assert.equal(step.time,'14:00');assert.match(step.title,/삼천리 · 시설관리 1차 면접$/);
  assert.equal(JSON.parse(a.run("JSON.stringify(plannerForDate('2026-11-30'))")).length,1);
  const alerts=L.upcomingAlerts(a.saved(),'2026-11-16',3);
  const hit=alerts.find(x=>x.kind==='step');
  assert.ok(hit);assert.equal(hit.label,'1차 면접 14:00');assert.equal(hit.go,'jobHub');
  assert.equal(alerts.some(x=>x.label==='서류 발표'),false,'outside the 3-day window');
  assert.match(a.run('upcomingBannerHTML()'),/1차 면접 14:00/);
});

test('a rejected or cancelled posting stops showing its steps, but keeps them',()=>{
  for(const stage of ['불합격','지원 취소']){
    const a=appWith(base({stage,events:[{id:'s1',label:'최종 발표',date:'2026-11-17',time:''}]}));
    assert.equal(JSON.parse(a.run("JSON.stringify(plannerForDate('2026-11-17'))")).length,0,stage);
    assert.equal(L.upcomingAlerts(a.saved(),'2026-11-16',3).some(x=>x.kind==='step'),false,stage);
    assert.equal(steps(a).length,1,'still saved');
  }
  const passed=appWith(base({stage:'합격',events:[{id:'s1',label:'입사 안내',date:'2026-11-17',time:''}]}));
  assert.equal(JSON.parse(passed.run("JSON.stringify(plannerForDate('2026-11-17'))")).length,1,'a passed posting still shows what comes next');
});

test('broken saved steps are dropped one by one and never stop the backup check or the screens',()=>{
  const bad=[null,5,{id:'a',label:'',date:'2026-11-20'},{id:'b',label:'면접',date:'nope'},{id:"x');alert(1);('",label:'면접',date:'2026-11-20'},
    {id:'ok',label:'  1차 면접 ',date:'2026-11-20',time:'bad'}];
  const state={nickname:'a',mainGoal:'b',activity:[],completedTasks:[false,false,false,false,false],jobPostings:[base({events:bad})]};
  assert.equal(L.validateBackupState(state),true,'broken steps do not make a backup unreadable');
  const {state:clean,dropped}=L.sanitizeState(state);
  assert.deepEqual(clean.jobPostings[0].events,[{id:'ok',label:'1차 면접',date:'2026-11-20',time:''}]);
  assert.deepEqual(dropped,[]);
  const a=createApp(JSON.stringify(state),{now:NOV_OK()});
  a.run('renderJobHub()');a.run('renderHome()');a.run("plannerForDate('2026-11-20')");
  assert.equal(L.cleanPostingEvents('x').length,0);
  const many=Array.from({length:30},(_,i)=>({id:'e'+i,label:'면접',date:'2026-11-20'}));
  assert.equal(L.cleanPostingEvents(many).length,L.MAX_POSTING_EVENTS);
});
function NOV_OK(){return NOW;}
