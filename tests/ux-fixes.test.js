const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {script}=require('./helpers/app-harness.js');

/* Pull one top-level function out of the inline app script so it can be run with stubs. */
function extractFunction(name){
  const start=script.indexOf('function '+name+'(');
  assert.ok(start>=0,name+' exists');
  const end=script.indexOf('\n}',start); // top-level functions close with a "}" at column 0
  return script.slice(start,end+2);
}

/* ---------- #360: dangerous confirm dialogs focus the Cancel button ---------- */
test('danger confirm dialog focuses Cancel (index 0), a normal confirm keeps focusing OK',()=>{
  const calls=[];
  const ctx={uiAsk:config=>{calls.push(config);return Promise.resolve(true);}};
  vm.createContext(ctx);
  vm.runInContext(extractFunction('uiConfirm'),ctx);
  ctx.uiConfirm('지울까요?',{ok:'삭제',danger:true});
  ctx.uiConfirm('계속할까요?');
  assert.equal(calls[0].focusIndex,0);
  assert.equal(calls[0].buttons[0].label,'취소');
  assert.equal(calls[0].buttons[1].kind,'danger');
  assert.equal(calls[1].focusIndex,1);
  assert.equal(calls[1].buttons[1].kind,'primary');
});
