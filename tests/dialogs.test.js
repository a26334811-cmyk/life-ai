/* Runs the app's real confirm/choice/prompt dialogs (uiAsk) on a tiny fake DOM,
   instead of the scripted answers the other tests use. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

function setup(){
  const a=createApp(null,{realDialogs:true});
  const listeners={};
  const doc=a.context.document;
  doc.activeElement=null;
  doc.body={children:[],appendChild(n){this.children.push(n);return n;}};
  doc.addEventListener=(type,fn)=>{(listeners[type]=listeners[type]||[]).push(fn);};
  doc.removeEventListener=(type,fn)=>{listeners[type]=(listeners[type]||[]).filter(f=>f!==fn);};
  doc.createElement=tag=>({
    tag,children:[],listeners:{},attrs:{},style:{},value:'',
    appendChild(c){this.children.push(c);return c;},
    setAttribute(k,v){this.attrs[k]=v;},
    addEventListener(type,fn){this.listeners[type]=fn;},
    remove(){const i=doc.body.children.indexOf(this);if(i>=0)doc.body.children.splice(i,1);},
    focus(){doc.activeElement=this;},select(){}
  });
  const dialog={
    get open(){return doc.body.children[0]||null;},
    get buttons(){const box=this.open.children[0];return box.children[box.children.length-1].children;},
    get input(){return this.open.children[0].children.find(c=>c.tag==='input');},
    label:b=>b.textContent,
    key(key,extra={}){(listeners.keydown||[]).forEach(fn=>fn({key,shiftKey:false,preventDefault(){},...extra}));},
    click(label){this.buttons.find(b=>b.textContent===label).listeners.click();},
    backdrop(){this.open.listeners.mousedown({target:this.open});},
    keyListeners:()=>(listeners.keydown||[]).length
  };
  const tick=()=>new Promise(r=>setImmediate(r));
  return {a,dialog,doc,tick};
}

test('confirm: Esc, outside click and 취소 all end as cancel; the ok button returns true',async()=>{
  const {a,dialog,tick}=setup();
  for(const close of [()=>dialog.key('Escape'),()=>dialog.backdrop(),()=>dialog.click('취소')]){
    const p=a.run("uiConfirm('지울까요?',{ok:'삭제'})");await tick();
    assert.ok(dialog.open);close();
    assert.equal(await p,false);
    assert.equal(dialog.open,null,'dialog is removed');
    assert.equal(dialog.keyListeners(),0,'key listener is removed');
  }
  const p=a.run("uiConfirm('지울까요?',{ok:'삭제'})");await tick();
  dialog.click('삭제');
  assert.equal(await p,true);
});

test('a dangerous confirm starts on 취소 so one Enter press does not delete; a normal confirm starts on the ok button',async()=>{
  const {a,dialog,doc,tick}=setup();
  const danger=a.run("uiConfirm('이 일정을 삭제할까요?',{title:'일정 삭제',ok:'삭제',danger:true})");await tick();
  assert.equal(doc.activeElement.textContent,'취소');
  assert.match(dialog.buttons.find(b=>b.textContent==='삭제').className,/danger/);
  dialog.key('Escape');assert.equal(await danger,false);
  const normal=a.run("uiConfirm('초기화할까요?',{ok:'초기화'})");await tick();
  assert.equal(doc.activeElement.textContent,'초기화');
  dialog.key('Escape');await normal;
});

test('choice returns the clicked button value and null for Esc, outside click and 취소',async()=>{
  const {a,dialog,doc,tick}=setup();
  const run=()=>a.run("uiChoice('어디까지?',[{label:'전체',value:'all'},{label:'이 일정만',value:'one'}])");
  let p=run();await tick();
  assert.equal(doc.activeElement.textContent,'전체','first choice is focused');
  dialog.click('이 일정만');assert.equal(await p,'one');
  p=run();await tick();dialog.click('전체');assert.equal(await p,'all');
  for(const close of [()=>dialog.key('Escape'),()=>dialog.backdrop(),()=>dialog.click('취소')]){
    p=run();await tick();close();assert.equal(await p,null);
  }
});

test('prompt returns the typed text on Enter or 확인 and null on Esc',async()=>{
  const {a,dialog,doc,tick}=setup();
  let p=a.run("uiPrompt('이름?','기본값')");await tick();
  assert.equal(doc.activeElement,dialog.input,'input is focused');
  assert.equal(dialog.input.value,'기본값');
  dialog.input.value='새 이름';dialog.key('Enter');
  assert.equal(await p,'새 이름');
  p=a.run("uiPrompt('이름?','기본값')");await tick();
  dialog.input.value='다시';dialog.click('확인');
  assert.equal(await p,'다시');
  p=a.run("uiPrompt('이름?','기본값')");await tick();
  dialog.key('Escape');assert.equal(await p,null);
});

test('Tab and Shift+Tab stay inside the dialog',async()=>{
  const {a,dialog,doc,tick}=setup();
  const p=a.run("uiChoice('어디까지?',[{label:'전체',value:'all'}])");await tick();
  assert.equal(doc.activeElement.textContent,'전체');
  dialog.key('Tab');assert.equal(doc.activeElement.textContent,'취소');
  dialog.key('Tab');assert.equal(doc.activeElement.textContent,'전체','wraps to the first button');
  dialog.key('Tab',{shiftKey:true});assert.equal(doc.activeElement.textContent,'취소','Shift+Tab wraps backwards');
  dialog.key('Escape');await p;
});

test('dialogs opened back to back show one at a time, in order',async()=>{
  const {a,dialog,doc,tick}=setup();
  const first=a.run("uiConfirm('첫째?')");
  const second=a.run("uiChoice('둘째?',[{label:'A',value:'a'}])");
  await tick();
  assert.equal(doc.body.children.length,1);
  assert.equal(dialog.open.children[0].children.find(c=>c.tag==='p').textContent,'첫째?');
  dialog.click('확인');assert.equal(await first,true);
  await tick();
  assert.equal(doc.body.children.length,1);
  assert.equal(dialog.open.children[0].children.find(c=>c.tag==='p').textContent,'둘째?');
  dialog.click('A');assert.equal(await second,'a');
});

test('alert closes with its only button and keeps focus handling safe',async()=>{
  const {a,dialog,tick}=setup();
  const p=a.run("uiAlert('끝났어요')");await tick();
  assert.equal(dialog.buttons.length,1);
  dialog.click('확인');assert.equal(await p,undefined);
  assert.equal(dialog.open,null);
});
