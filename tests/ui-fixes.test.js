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
