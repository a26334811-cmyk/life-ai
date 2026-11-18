const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

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
test('기록 손상 시작 안내는 6초 이상 보여 준다',()=>{
  const a=createApp('not json at all');
  assert.match(a.run('startupNotice'),/읽지 못해/);
  assert.ok(a.run('startupNoticeMs')>=6000);
});
