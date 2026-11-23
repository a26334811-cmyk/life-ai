const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

const add=(a,e)=>a.run(`plannerEntries().push(${JSON.stringify({category:'personal',repeat:'none',until:'',priority:'normal',time:'',...e})})`);

/* ---------- "오늘 할 일" card on the today tab (candidate 335) ---------- */
test('the today card lists today\'s items with check boxes and an x/y counter',()=>{
  const a=createApp();
  add(a,{id:'a1',title:'영어 공부',date:'2026-05-10',time:'09:00'});
  add(a,{id:'a2',title:'이력서 쓰기',date:'2026-05-10',done:true});
  add(a,{id:'a3',title:'내일 일정',date:'2026-05-11'});
  const html=a.run('todayTasksHTML()');
  assert.match(html,/오늘 1\/2개 완료/);
  assert.match(html,/plannerToggle\('a1','2026-05-10'\)/);
  assert.match(html,/plannerToggle\('a2','2026-05-10'\)/);
  assert.doesNotMatch(html,/내일 일정/);
  assert.match(html,/<input type="checkbox" checked onchange="plannerToggle\('a2'/); // finished items stay visible
});

test('checking the box uses plannerToggle for today and updates the counter',()=>{
  const a=createApp();
  a.run('renderCalendar=()=>{}');
  add(a,{id:'a1',title:'영어 공부',date:'2026-05-10'});
  a.run("plannerToggle('a1','2026-05-10')");
  assert.equal(a.saved().plannerEntries[0].done,true);
  assert.match(a.run('todayTasksHTML()'),/오늘 1\/1개 완료/);
  a.run("plannerToggle('a1','2026-05-10')");
  assert.match(a.run('todayTasksHTML()'),/오늘 0\/1개 완료/);
});

test('a repeating item is checked for today only',()=>{
  const a=createApp();
  a.run('renderCalendar=()=>{}');
  add(a,{id:'r1',title:'운동',date:'2026-05-01',repeat:'daily'});
  assert.match(a.run('todayTasksHTML()'),/오늘 0\/1개 완료/);
  a.run("plannerToggle('r1','2026-05-10')");
  assert.match(a.run('todayTasksHTML()'),/오늘 1\/1개 완료/);
  assert.equal(a.run("plannerForDate('2026-05-09')[0].done"),false);
});

test('a saved job deadline is shown without a check box and is not counted; empty day says so',()=>{
  const a=createApp();
  assert.match(a.run('todayTasksHTML()'),/오늘 등록된 일정이 없어요/);
  a.run("state.jobPostings=[{company:'가스공사',title:'신입',deadline:'2026-05-10'}]");
  const html=a.run('todayTasksHTML()');
  assert.match(html,/💼 가스공사 · 신입 마감/);
  assert.doesNotMatch(html,/type="checkbox"/);
  assert.match(html,/오늘 등록된 일정이 없어요/);
});

test('titles are escaped in the today card',()=>{
  const a=createApp();
  add(a,{id:'x1',title:'<img src=x onerror=alert(1)>',date:'2026-05-10'});
  assert.doesNotMatch(a.run('todayTasksHTML()'),/<img/);
});

test('the today tab renders the card',()=>{
  const {script}=require('./helpers/app-harness.js');
  assert.match(script,/\$\{recoveryPanelHTML\(\)\}\s*\$\{todayTasksHTML\(\)\}/);
});
