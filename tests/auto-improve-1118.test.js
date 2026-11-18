const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

/* #111 backup: the app cannot know the file was saved, so the message must not claim it */
test('backup message does not claim the file was saved',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x'}));
  const d=a.context.document;
  d.createElement=()=>({click(){},remove(){}});
  d.body={appendChild(){}};
  a.context.Blob=Blob;
  a.run('exportLifeAIBackup()');
  assert.equal(a.toasts.length,1);
  assert.match(a.toasts[0],/만들었어요/);
  assert.match(a.toasts[0],/확인해 주세요/);
  assert.doesNotMatch(a.toasts[0],/저장했어요/);
  assert.ok(a.saved().lastBackupAt,'backup date is still recorded');
});
