const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

/* #62 */
test('home first-card reason is a sentence for every goal type (never an object)',()=>{
  const a=createApp();
  for(const g of ['job','cert','policy','other']){
    a.run(`state.goalType='${g}'`);
    assert.equal(a.run('typeof priorityReason()'),'string',g);
  }
  a.run("quickGoal('취업 기회 탐색')");
  assert.equal(a.run('state.goalType'),'job');
  a.run('renderHome()');
  assert.doesNotMatch(a.el('homeContent').innerHTML,/\[object Object\]/);
  assert.match(a.run('priorityReason()'),/관심 회사와 공고/);
});

/* #60 */
const status=a=>a.el('postingFetchStatus').textContent;
test('pasting text with a deadline when the deadline box is already filled says what the text says',()=>{
  const a=createApp(undefined,{now:Date.parse('2026-11-16T03:00:00Z')});
  a.el('postingDeadline').value='2026-12-25';
  a.el('postingPaste').value='접수기간 2026.11.10(월) ~ 2026.11.30(일) 18:00';
  a.run('fillPostingFromPaste()');
  assert.equal(a.el('postingDeadline').value,'2026-12-25','typed value is kept');
  assert.doesNotMatch(status(a),/찾지 못했어요/);
  assert.match(status(a),/글에는 마감일이 2026-11-30로 적혀 있어요. 지금 입력한 값과 달라요/);
  const b=createApp(undefined,{now:Date.parse('2026-11-16T03:00:00Z')});
  b.el('postingDeadline').value='2026-11-30';
  b.el('postingPaste').value='접수기간 2026.11.10(월) ~ 2026.11.30(일) 18:00';
  b.run('fillPostingFromPaste()');
  assert.doesNotMatch(status(b),/찾지 못했어요/);
  assert.match(status(b),/입력한 값과 같아요/);
});
