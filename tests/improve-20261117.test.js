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
