const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp,html}=require('./helpers/app-harness.js');

/* #209: pressing Enter in these text fields runs the same action as the screen's button. */
const handler=id=>{
  const tag=html.match(new RegExp('<input id="'+id+'"[^>]*>'))[0];
  return {code:tag.match(/onkeydown="([^"]*)"/)?.[1],hint:tag.match(/enterkeyhint="(\w+)"/)?.[1]};
};
const press=(a,id,event,value='값')=>{
  a.context.__ev=event;a.context.__self={value};
  a.run(`(function(event){${handler(id).code}}).call(__self,__ev)`);
};
const cases=[
  ['nickname','go','next'],
  ['jobInput','selectJob','go'],
  ['customGoalInput','createCustomGoal','go'],
  ['habitName','habitAdd','done']
];
for(const [id,fn,hint] of cases){
  test(`Enter in #${id} calls ${fn}() and the phone keyboard shows "${hint}"`,()=>{
    const a=createApp();
    const calls=[];
    a.context.__calls=calls;
    a.run(`${fn}=(...args)=>__calls.push(args)`);
    assert.equal(handler(id).hint,hint);
    let prevented=0;
    press(a,id,{key:'a',isComposing:false,preventDefault:()=>prevented++});
    assert.equal(calls.length,0);
    // Enter while a Korean syllable is still being composed must not trigger it.
    press(a,id,{key:'Enter',isComposing:true,preventDefault:()=>prevented++});
    assert.equal(calls.length,0);
    press(a,id,{key:'Enter',isComposing:false,preventDefault:()=>prevented++},'회계');
    assert.equal(calls.length,1);
    assert.equal(prevented,1);
    if(id==='nickname')assert.deepEqual([...calls[0]],['goalChoice']);
    if(id==='jobInput')assert.deepEqual([...calls[0]],['회계']);
  });
}
