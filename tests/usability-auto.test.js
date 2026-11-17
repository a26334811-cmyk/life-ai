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

test('#83 home banner shows unapplied postings that close within 3 days',()=>{
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
  a.run('renderHome()');
  const out=a.el('homeContent').innerHTML;
  assert.match(out,/곧 다가오는 일정 2건/);
  assert.match(out,/오늘회사/);assert.match(out,/alert-when">오늘</);
  assert.match(out,/사흘회사/);assert.match(out,/alert-when">3일 뒤</);
  for(const hidden of ['나흘회사','지원한회사','지난회사','미정회사'])assert.ok(!out.includes(hidden),hidden);
  assert.match(out,/class="card urgent-postings"[\s\S]*onclick="go\('jobHub'\)"/);
  assert.ok(out.indexOf('urgent-postings')<out.indexOf('soft-overview'),'the banner is the first thing on the home screen');
  // nothing urgent -> no banner
  a.run("state.jobPostings=[]");
  a.run('renderHome()');
  assert.doesNotMatch(a.el('homeContent').innerHTML,/urgent-postings/);
  // more than 4: the banner lists 4 and the rest as a count
  a.run(`state.jobPostings=${JSON.stringify([1,2,3,4,5,6].map(i=>({id:'x'+i,company:'회사'+i,title:'t',url:'https://e.com/'+i,deadline:day(i%2),stage:'관심'})))}`);
  a.run('renderHome()');
  assert.match(a.el('homeContent').innerHTML,/곧 다가오는 일정 6건/);
  assert.match(a.el('homeContent').innerHTML,/외 2건/);
});

test('#87 deadline calendar (.ics) has one stable all-day event per unapplied upcoming posting',()=>{
  const a=createApp();
  const day=n=>a.run(`plannerDateOffset(koreaToday(),${n})`);
  const jobs=[
    {id:'job-1',company:'가나다, 주식회사',title:'신입;사원',url:'https://e.com/a?x=1',deadline:day(2),stage:'관심'},
    {id:'job-2',company:'두번째',title:'공고B',url:'https://e.com/b',deadline:day(0),stage:'준비 중'},
    {id:'job-3',company:'지원함',title:'C',url:'https://e.com/c',deadline:day(1),stage:'지원 완료'},
    {id:'job-4',company:'지남',title:'D',url:'https://e.com/d',deadline:day(-1),stage:'관심'},
    {id:'job-5',company:'미정',title:'E',url:'https://e.com/e',deadline:'',stage:'관심'}
  ];
  a.run(`state.jobPostings=${JSON.stringify(jobs)}`);
  assert.equal(a.run('deadlinePostingsForCalendar().map(p=>p.id).join()'),'job-1,job-2');
  const ics=a.run('buildDeadlineICS(deadlinePostingsForCalendar(),Date.now())');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,2);
  assert.ok(!/[^\r]\n/.test(ics),'all line breaks are CRLF');
  const unfolded=ics.replace(/\r\n /g,'');
  const d1=day(2).replace(/-/g,''),d1end=a.run(`plannerDateOffset('${day(2)}',1)`).replace(/-/g,'');
  assert.ok(unfolded.includes('UID:life-ai-posting-job-1@life-ai'));
  assert.ok(unfolded.includes('DTSTART;VALUE=DATE:'+d1));
  assert.ok(unfolded.includes('DTEND;VALUE=DATE:'+d1end));
  assert.ok(unfolded.includes('SUMMARY:[마감] 가나다\\, 주식회사 · 신입\\;사원'));
  assert.ok(unfolded.includes('https://e.com/a?x=1'));
  assert.ok(!unfolded.includes('지원함')&&!unfolded.includes('지남')&&!unfolded.includes('미정'));
  // UIDs are the same on every export, so re-importing updates instead of duplicating
  const again=a.run('buildDeadlineICS(deadlinePostingsForCalendar(),Date.now()+86400000)');
  const uids=s=>(s.match(/UID:.*/g)||[]).join('|');
  assert.equal(uids(again),uids(ics));
  // no line is longer than 75 bytes
  for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75,line);
});

test('#87 exporting downloads an .ics file, or explains when there is nothing to export',()=>{
  const {Blob}=require('node:buffer');
  const a=createApp();
  const clicked=[];
  a.context.Blob=Blob;
  a.context.__blobs=[];
  a.run('URL={createObjectURL:b=>{__blobs.push(b);return "blob:x"},revokeObjectURL(){}}');
  a.run('document.createElement=()=>({click(){__clicked.push(this.download)},remove(){}});document.body={appendChild(){}}');
  a.context.__clicked=clicked;
  a.run('exportDeadlineCalendar()');
  assert.equal(clicked.length,0,'nothing to export');
  assert.match(a.toasts.at(-1),/내보낼 마감일이 없어요/);
  const deadline=a.run('plannerDateOffset(koreaToday(),1)');
  a.run(`state.jobPostings=[{id:'j',company:'회사',title:'공고',url:'https://e.com/j',deadline:'${deadline}',stage:'관심'}]`);
  a.run('exportDeadlineCalendar()');
  assert.equal(clicked.length,1);
  assert.match(clicked[0],/^life-ai-deadlines-\d{4}-\d{2}-\d{2}\.ics$/);
  assert.equal(a.context.__blobs[0].type,'text/calendar;charset=utf-8');
  assert.match(a.toasts.at(-1),/1건/);
  a.run('renderMy()');
  assert.match(a.el('myContent').innerHTML,/exportDeadlineCalendar\(\)/);
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
