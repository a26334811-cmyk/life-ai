const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp,html}=require('./helpers/app-harness');

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
