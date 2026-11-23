const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

test('editing a saved posting keeps one posting and keeps stage, checks and creation date',()=>{
  const a=createApp();
  a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';
  a.el('postingUrl').value='https://example.com/jobs/1';a.el('postingDeadline').value='2099-01-01';
  a.el('postingNotes').value='메모';a.run('savePosting()');
  const id=a.run('state.jobPostings[0].id');
  a.run(`setPostingStage('${id}','지원 완료');setPostingTask('${id}',1,true)`);
  const createdAt=a.run('state.jobPostings[0].createdAt');
  a.run(`editPosting('${id}')`);
  assert.equal(a.el('postingId').value,id);
  assert.equal(a.el('postingNotes').value,'메모');
  assert.equal(a.el('postingFormTitle').textContent,'공고 수정');
  a.el('postingDeadline').value='2099-02-02';a.run('savePosting()');
  assert.equal(a.run('state.jobPostings.length'),1);
  const p=JSON.parse(a.run('JSON.stringify(state.jobPostings[0])'));
  assert.equal(p.id,id);assert.equal(p.deadline,'2099-02-02');assert.equal(p.notes,'메모');
  assert.equal(p.stage,'지원 완료');assert.deepEqual(p.tasks,[false,true,false,false]);assert.equal(p.createdAt,createdAt);
  assert.equal(a.saved().jobPostings[0].deadline,'2099-02-02');
});
