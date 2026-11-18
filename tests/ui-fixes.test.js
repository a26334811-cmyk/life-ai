const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

/* ---------- README에 중첩 폴더 배포 규칙 (#169) ---------- */
test('README에 중첩 폴더가 실제 배포본이라는 규칙과 동기화 명령이 적혀 있다',()=>{
  const readme=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','README.txt'),'utf8');
  assert.match(readme,/중첩 폴더/);
  assert.match(readme,/지우면 안 됩니다/);
  assert.match(readme,/node scripts\/sync-nested\.js/);
  assert.match(readme,/직접 고치지 않습니다/);
});
/* ---------- 안내 문구(토스트) 표시 시간 (#165) ---------- */
test('토스트 표시 시간은 글자 수에 비례하고 최대 8초, 중요 안내는 최소 시간을 지킨다',()=>{
  const a=createApp();
  assert.equal(a.run("toastDuration('')"),1800);
  assert.equal(a.run("toastDuration('가'.repeat(20))"),2800);
  assert.equal(a.run("toastDuration('가'.repeat(500))"),8000);
  assert.equal(a.run("toastDuration('짧은 글',6000)"),6000);
  assert.equal(a.run("toastDuration('가'.repeat(500),6000)"),8000);
});
test('저장 실패 안내는 6초 이상 보여 준다',()=>{
  const a=createApp(undefined,{failSave:true});
  a.run('persistState()');
  assert.match(a.toasts[0],/저장하지 못했어요/);
  assert.ok(a.toastMinMs[0]>=6000);
});
test('집중 기록 정리 안내는 6초 이상 보여 준다',()=>{
  const a=createApp();
  a.run("for(let i=0;i<LifeLogic.FOCUS_HISTORY_LIMIT;i++)focusHistory().push({date:'2026-05-01',minutes:25,category:'study',completedAt:'2026-05-01T00:00:'+String(i).padStart(2,'0')+'.000Z'});focusRecordCompletion({minutes:25,category:'study',completedAt:'2026-05-10T03:25:00.000Z',date:'2026-05-10'})");
  const i=a.toasts.findIndex(m=>/정리했어요/.test(m));
  assert.ok(i>=0);
  assert.ok(a.toastMinMs[i]>=6000);
});
/* ---------- 타이머 카드의 오늘 집중 시간 (#175) ---------- */
test('타이머 카드에 오늘 집중 분·세션 수가 보이고 세션이 끝나면 갱신된다',()=>{
  const a=createApp();
  assert.match(a.run('focusPanelHTML()'),/오늘 집중 0분 · 세션 0번/);
  a.el('calendar').classList.contains=name=>name==='active';
  a.run("focusRecordCompletion({minutes:25,category:'study',completedAt:'2026-05-10T01:00:00.000Z',date:koreaToday()});focusRecordCompletion({minutes:25,category:'job',completedAt:'2026-05-10T02:00:00.000Z',date:koreaToday()});focusRecordCompletion({minutes:50,category:'job',completedAt:'2026-05-09T02:00:00.000Z',date:'2026-05-09'})");
  assert.match(a.run('focusPanelHTML()'),/오늘 집중 50분 · 세션 2번/);
  assert.match(a.el('focusTodaySummary').textContent,/오늘 집중 50분 · 세션 2번/);
  assert.match(a.run('focusHistoryHTML()'),/<strong>50분<\/strong><p class="meta">오늘/);
});

/* ---------- '오늘' 탭의 남은 습관 (#173) ---------- */
test('오늘 탭에 아직 안 한 습관만 체크박스로 보이고, 체크하면 기존 habitToggle로 저장된다',()=>{
  const a=createApp();
  a.run("state.habits=[{id:'h1',name:'공부 30분',checks:[]},{id:'h2',name:'스트레칭',checks:[koreaToday()]}]");
  const html=a.run('todayHabitsHTML()');
  assert.match(html,/오늘 남은 습관 1개/);
  assert.match(html,/공부 30분/);
  assert.doesNotMatch(html,/스트레칭/);
  assert.match(html,/data-id=\"h1\" onchange=\"habitToggle\(this\.dataset\.id,'2026-05-10'\)/);
  assert.match(a.run('plannerFocusHTML()+todayHabitsHTML()'),/habitToggle/);
  a.run("habitToggle('h1',koreaToday())");
  assert.ok(a.saved().habits[0].checks.includes(a.run('koreaToday()')));
  assert.match(a.run('todayHabitsHTML()'),/모두 해냈어요/);
  assert.doesNotMatch(a.run('todayHabitsHTML()'),/checkbox/);
});
test('습관이 하나도 없으면 오늘 탭에 습관 카드를 만들지 않는다',()=>{
  const a=createApp();
  assert.equal(a.run('todayHabitsHTML()'),'');
});
test('오늘 탭 화면에 남은 습관 카드가 들어간다',()=>{
  assert.match(require('./helpers/app-harness.js').script,/data-tab="today"[\s\S]*?plannerFocusHTML\(\)\}[\s\S]*?\$\{todayHabitsHTML\(\)\}\s*\$\{focusPanelHTML\(\)/);
});

/* ---------- 알림 설정은 켜져 있는데 브라우저에서 막힌 경우 (#171) ---------- */
const savedNotifyOn=()=>{
  const a=createApp();
  a.run('focusSettings().notify=true;persistState()');
  return a.storage.get('lifeAIPrototypeV5');
};
test('알림이 막혀 있으면 집중 패널을 그릴 때 체크를 끄고 안내한다',()=>{
  const a=createApp(savedNotifyOn(),{notification:{permission:'denied',requestResult:'denied'}});
  assert.equal(a.run('focusSettings().notify'),true);
  const html=a.run('focusPanelHTML()');
  assert.doesNotMatch(html,/<input type="checkbox" checked/);
  assert.equal(a.saved().focusSettings.notify,false);
  assert.equal(a.toasts.filter(m=>/알림이 막혀 있어요/.test(m)).length,1);
  a.run('focusPanelHTML()');
  assert.equal(a.toasts.filter(m=>/알림이 막혀 있어요/.test(m)).length,1,'안내는 한 번만');
});
test('허용된 알림은 그대로 켜져 있고 안내도 없다',()=>{
  const a=createApp(savedNotifyOn(),{notification:{permission:'granted',requestResult:'granted'}});
  const html=a.run('focusPanelHTML()');
  assert.match(html,/<input type="checkbox" checked/);
  assert.equal(a.toasts.length,0);
});
test('타이머가 끝나는 순간 알림이 막혀 있으면 한 번만 안내한다',async()=>{
  const a=createApp(savedNotifyOn(),{hidden:true,notification:{permission:'denied',requestResult:'denied'}});
  await a.run('focusShowNotification()');
  await a.run('focusShowNotification()');
  assert.equal(a.toasts.filter(m=>/알림이 막혀 있어요/.test(m)).length,1);
  assert.equal(a.run('focusSettings().notify'),false);
  assert.equal(a.notifications.length,0);
});

/* ---------- 기회 카드의 '둘러보기' 버튼 (#166) ---------- */
test('기회 카드에는 개발용 문구만 띄우는 버튼이 없고, 버튼은 실제 화면으로 간다',()=>{
  for(const [type,goal] of [['cert','위험물산업기사 준비'],['policy','청년 지원'],['other','영어 공부']]){
    const a=createApp();
    a.run(`state.goalType='${type}';state.mainGoal='${goal}'`);
    const html=a.run('opportunityCards()');
    assert.doesNotMatch(html,/둘러보기|DEMO|프로토타입|테스트 전|데이터 연결/);
    assert.doesNotMatch(html,/onclick="toast\(/);
    assert.match(html,/준비 중이에요|go\('/);
  }
  const cert=createApp();
  cert.run("state.goalType='cert';state.mainGoal='위험물산업기사 준비'");
  assert.match(cert.run('opportunityCards()'),/go\('jobHub'\)/);
  const policy=createApp();
  policy.run("state.goalType='policy';state.mainGoal='청년 지원'");
  assert.match(policy.run('opportunityCards()'),/준비 중이에요/);
});
test('기록 손상 시작 안내는 6초 이상 보여 준다',()=>{
  const a=createApp('not json at all');
  assert.match(a.run('startupNotice'),/읽지 못해/);
  assert.ok(a.run('startupNoticeMs')>=6000);
});
