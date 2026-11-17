const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp,html}=require('./helpers/app-harness');

test('#28 finished focus session stays visible on the timer card until the next action',async()=>{
  const a=createApp();
  a.run('focusStartPause()');
  a.clock.now+=25*60*1000+500;
  a.tick();
  assert.equal(a.run('focusHistory().length'),1,'recording still works');
  assert.equal(a.run('focusDoneText()'),'✅ 25분 집중을 마쳤어요');
  assert.equal(a.el('focusDoneNote').textContent,'✅ 25분 집중을 마쳤어요');
  assert.match(a.run('focusPanelHTML()'),/id="focusDoneNote" role="status" aria-live="polite">✅ 25분 집중을 마쳤어요</);
  assert.match(a.run('document.title'),/끝났어요/);
  // the message must survive later re-renders (toast is gone after 1.8s)
  a.run('renderCalendar()');
  assert.match(a.el('calendarContent').innerHTML,/25분 집중을 마쳤어요/);
  // starting again clears it
  a.run('focusStartPause()');
  assert.equal(a.el('focusDoneNote').textContent,'');
  assert.doesNotMatch(a.run('document.title'),/끝났어요/);
  // reset clears it too
  a.clock.now+=25*60*1000+500;a.tick();
  assert.equal(a.run('focusDoneText()'),'✅ 25분 집중을 마쳤어요');
  await a.run('focusReset()');
  assert.equal(a.el('focusDoneNote').textContent,'');
});

test('#29 opportunity cards no longer have a "둘러보기" button that only shows a toast',()=>{
  const a=createApp();
  for(const goalType of ['cert','policy','other']){
    a.run(`state.goalType='${goalType}';state.mainGoal='전기기사 준비'`);
    const out=a.run('opportunityCards()');
    assert.doesNotMatch(out,/둘러보기/,goalType);
    assert.doesNotMatch(out,/onclick="toast\(/,goalType);
  }
  a.run("state.goalType='cert'");
  assert.match(a.run('opportunityCards()'),/onclick="go\('jobHub'\)"/);
  a.run("state.goalType='policy'");
  assert.match(a.run('opportunityCards()'),/준비 중이에요/);
  a.run("state.goalType='other'");
  assert.match(a.run('opportunityCards()'),/준비 중이에요/);
});

test('#30 every back button has a name and a touch-sized area; cert screen returns to where it came from',()=>{
  const buttons=[...html.matchAll(/<button class="back"[^>]*>/g)].map(m=>m[0]);
  assert.ok(buttons.length>=14,'found '+buttons.length);
  for(const b of buttons)assert.match(b,/aria-label="뒤로"/,b);
  assert.doesNotMatch(html,/<button class="back" onclick=/);
  const css=html.match(/\.back\{([^}]*)\}/)[1];
  assert.match(css,/min-width:44px/);
  assert.match(css,/min-height:44px/);
  const a=createApp();
  a.run('initCertSearch=()=>{}');// the fake DOM has no cert search widgets
  a.run("go('jobHub')");a.run("go('cert')");a.run('historyBack()');
  assert.equal(a.run('currentScreen'),'jobHub');
  a.run("go('home')");a.run("go('cert')");a.run('historyBack()');
  assert.equal(a.run('currentScreen'),'home');
  // staying on the cert screen (e.g. re-opening it) must not make ← point at itself
  a.run("go('goals')");a.run("go('cert')");a.run("go('cert')");a.run('historyBack()');
  assert.equal(a.run('currentScreen'),'goals');
});

test('#83 home shows unapplied postings that close within 3 days',()=>{
  // fake clock: 2026-05-10 12:00 Korea time
  const a=createApp();
  const day=n=>a.run(`plannerDateOffset(koreaToday(),${n})`);
  const jobs=[
    {id:'a',company:'오늘회사',title:'공고A',url:'https://e.com/a',deadline:day(0),stage:'관심'},
    {id:'b',company:'사흘회사',title:'공고B',url:'https://e.com/b',deadline:day(3),stage:'준비 중'},
    {id:'c',company:'나흘회사',title:'공고C',url:'https://e.com/c',deadline:day(4),stage:'관심'},
    {id:'d',company:'지원한회사',title:'공고D',url:'https://e.com/d',deadline:day(1),stage:'지원 완료'},
    {id:'e',company:'지난회사',title:'공고E',url:'https://e.com/e',deadline:day(-1),stage:'관심'},
    {id:'f',company:'미정회사',title:'공고F',url:'https://e.com/f',deadline:'',stage:'관심'}
  ];
  a.run(`state.jobPostings=${JSON.stringify(jobs)};state.mainGoal='전기기사 준비';state.goalType='cert'`);
  assert.equal(a.run('urgentPostings().map(p=>p.id).join()'),'a,b');
  a.run('renderHome()');
  const out=a.el('homeContent').innerHTML;
  assert.match(out,/마감 임박 공고 2건/);
  assert.match(out,/오늘회사/);assert.match(out,/오늘 마감/);
  assert.match(out,/사흘회사/);assert.match(out,/D-3/);
  for(const hidden of ['나흘회사','지원한회사','지난회사','미정회사'])assert.ok(!out.includes(hidden),hidden);
  assert.match(out,/class="card urgent-postings"[\s\S]*onclick="go\('jobHub'\)"/);
  assert.ok(out.indexOf('soft-overview')<out.indexOf('urgent-postings'),'card sits below the summary rows');
  // nothing urgent -> no card
  a.run("state.jobPostings=[]");
  a.run('renderHome()');
  assert.doesNotMatch(a.el('homeContent').innerHTML,/urgent-postings/);
  // more than 3: list shows 3 and the rest as a count
  a.run(`state.jobPostings=${JSON.stringify([1,2,3,4].map(i=>({id:'x'+i,company:'회사'+i,title:'t',url:'https://e.com/'+i,deadline:day(i%2),stage:'관심'})))}`);
  a.run('renderHome()');
  assert.match(a.el('homeContent').innerHTML,/마감 임박 공고 4건/);
  assert.match(a.el('homeContent').innerHTML,/외 1건/);
});

test('#27 planner row buttons say what they do and name the event',()=>{
  const a=createApp();
  a.run("state.plannerEntries=[{id:'d',title:'운동 \"가기\"',date:'2026-05-10'}]");
  a.run("plannerSelected='2026-05-10'");
  a.run('renderCalendar()');
  const out=a.el('calendarContent').innerHTML;
  assert.ok(out.includes('aria-label="완료 표시: 운동 &quot;가기&quot;"'));
  assert.ok(out.includes('aria-label="수정: 운동 &quot;가기&quot;"'));
  assert.ok(out.includes('aria-label="삭제: 운동 &quot;가기&quot;"'));
  assert.match(out,/>완료<\/button>/);
  assert.doesNotMatch(out,/>✓<\/button>/);
  a.run("plannerToggle('d','2026-05-10')");
  a.run('renderCalendar()');
  const done=a.el('calendarContent').innerHTML;
  assert.ok(done.includes('aria-label="완료 취소: 운동'));
  assert.match(done,/>완료 취소<\/button>/);
  assert.match(html,/\.planner-item-actions\{[^}]*gap:10px/);
});
