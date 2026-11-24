/* Runs the REAL uiAsk / uiConfirm / uiChoice / uiPrompt / uiAlert from index.html against a tiny fake page
   (createElement, appendChild, addEventListener only). The other tests replace these dialogs with scripted
   answers, so without this file a broken dialog would go unnoticed. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {script}=require('./helpers/app-harness.js');

const start=script.indexOf('let uiDialogQueue');
const end=script.indexOf('function historyBack()');
assert.ok(start>0&&end>start,'dialog source found in index.html');
const dialogSource=script.slice(start,end);

function createPage(){
  const listeners=[];                       // document-level key listeners (capture)
  const body={children:[],appendChild(node){node.parent=body;body.children.push(node);return node;}};
  const document={
    body,activeElement:null,
    createElement(tag){
      const node={tag,children:[],attrs:{},listeners:{},style:{},textContent:'',className:'',value:'',type:'',
        setAttribute(k,v){node.attrs[k]=v;},
        appendChild(child){child.parent=node;node.children.push(child);return child;},
        addEventListener(type,fn){(node.listeners[type]=node.listeners[type]||[]).push(fn);},
        focus(){document.activeElement=node;},select(){node.selected=true;},
        remove(){if(node.parent){node.parent.children=node.parent.children.filter(c=>c!==node);node.parent=null;}}};
      return node;
    },
    addEventListener(type,fn){if(type==='keydown')listeners.push(fn);},
    removeEventListener(type,fn){const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);}
  };
  const context={document,Promise,console};
  vm.createContext(context);
  vm.runInContext(dialogSource,context);
  const modals=()=>body.children;
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  const all=(node,out=[])=>{out.push(node);node.children.forEach(c=>all(c,out));return out;};
  const buttons=()=>modals().flatMap(m=>all(m)).filter(n=>n.tag==='button');
  const input=()=>modals().flatMap(m=>all(m)).find(n=>n.tag==='input');
  const press=(key,extra={})=>{
    const event={key,prevented:false,preventDefault(){this.prevented=true;},...extra};
    [...listeners].forEach(fn=>fn(event));
    return event;
  };
  const click=label=>{
    const b=buttons().find(x=>x.textContent===label);
    assert.ok(b,'button '+label);
    b.listeners.click.forEach(fn=>fn({}));
  };
  const clickBackdrop=(onBox=false)=>{
    const wrap=modals()[0];
    const target=onBox?wrap.children[0]:wrap;
    wrap.listeners.mousedown.forEach(fn=>fn({target}));
  };
  return {context,document,listeners,modals,flush,buttons,input,press,click,clickBackdrop,
    run:code=>vm.runInContext(code,context)};
}

test('confirm: Esc and clicking outside cancel (false); the buttons give false/true; the keyboard listener is removed',async()=>{
  const p=createPage();
  let answer;
  p.run("uiConfirm('지울까요?',{title:'삭제'})").then(v=>{answer=v;});
  await p.flush();
  assert.equal(p.modals().length,1);
  assert.equal(p.listeners.length,1);
  assert.equal(p.press('Escape').prevented,true);
  await p.flush();
  assert.equal(answer,false);
  assert.equal(p.modals().length,0,'dialog removed');
  assert.equal(p.listeners.length,0,'key listener removed');

  p.run("uiConfirm('지울까요?')").then(v=>{answer=v;});await p.flush();
  p.clickBackdrop(true);await p.flush();
  assert.equal(p.modals().length,1,'a click inside the box does not close it');
  p.clickBackdrop(false);await p.flush();
  assert.equal(answer,false);

  p.run("uiConfirm('지울까요?')").then(v=>{answer=v;});await p.flush();
  p.click('취소');await p.flush();
  assert.equal(answer,false);

  p.run("uiConfirm('지울까요?',{ok:'지우기'})").then(v=>{answer=v;});await p.flush();
  p.click('지우기');await p.flush();
  assert.equal(answer,true);
});

test('confirm: the OK button has the focus when the dialog opens',async()=>{
  const p=createPage();
  p.run("uiConfirm('지울까요?')");await p.flush();
  assert.equal(p.document.activeElement.textContent,'확인');
  p.press('Escape');await p.flush();
});

test('prompt: Enter in the input returns the typed text, the OK button returns it, Esc/cancel/outside give null',async()=>{
  const p=createPage();
  let answer='unset';
  p.run("uiPrompt('이름은?','기본값')").then(v=>{answer=v;});await p.flush();
  assert.equal(p.input().value,'기본값');
  assert.equal(p.document.activeElement,p.input(),'input is focused');
  p.input().value='새 이름';
  const enter=p.press('Enter');await p.flush();
  assert.equal(enter.prevented,true);
  assert.equal(answer,'새 이름');
  assert.equal(p.modals().length,0);

  p.run("uiPrompt('이름은?')").then(v=>{answer=v;});await p.flush();
  p.input().value='버튼으로';p.click('확인');await p.flush();
  assert.equal(answer,'버튼으로');

  for(const close of [()=>p.press('Escape'),()=>p.click('취소'),()=>p.clickBackdrop(false)]){
    answer='unset';
    p.run("uiPrompt('이름은?')").then(v=>{answer=v;});await p.flush();
    p.input().value='쓰다 말았어요';
    close();await p.flush();
    assert.equal(answer,null);
  }
});

test('prompt: Enter does nothing when the focus is not on the input',async()=>{
  const p=createPage();
  let answer='unset';
  p.run("uiPrompt('이름은?')").then(v=>{answer=v;});await p.flush();
  p.document.activeElement=p.buttons()[0];
  p.press('Enter');await p.flush();
  assert.equal(answer,'unset');
  p.press('Escape');await p.flush();
  assert.equal(answer,null);
});

test('choice: picking a button gives its value; Esc and outside give null',async()=>{
  const p=createPage();
  let answer='unset';
  const ask=()=>p.run("uiChoice('어떻게 할까요?',[{label:'전체',value:'all'},{label:'이번만',value:'one'}])").then(v=>{answer=v;});
  ask();await p.flush();
  p.click('이번만');await p.flush();
  assert.equal(answer,'one');
  ask();await p.flush();p.press('Escape');await p.flush();
  assert.equal(answer,null);
  ask();await p.flush();p.clickBackdrop(false);await p.flush();
  assert.equal(answer,null);
});

test('alert: closes with the button or Esc and gives nothing back',async()=>{
  const p=createPage();
  let done=0,answer='unset';
  p.run("uiAlert('안내')").then(v=>{answer=v;done++;});await p.flush();
  assert.equal(p.modals()[0].children[0].attrs.role,'alertdialog');
  p.click('확인');await p.flush();
  assert.equal(done,1);assert.equal(answer,undefined);
  p.run("uiAlert('안내')").then(()=>{done++;});await p.flush();
  p.press('Escape');await p.flush();
  assert.equal(done,2);
});

test('Tab keeps the focus inside the dialog and wraps around',async()=>{
  const p=createPage();
  p.run("uiConfirm('지울까요?')");await p.flush();
  const [cancel,ok]=p.buttons();
  p.document.activeElement=ok;
  assert.equal(p.press('Tab').prevented,true);
  assert.equal(p.document.activeElement,cancel,'wrapped to the first button');
  p.press('Tab',{shiftKey:true});
  assert.equal(p.document.activeElement,ok,'shift+Tab wrapped back');
  p.press('Escape');await p.flush();
});

test('dialogs that open back to back appear one at a time, in order',async()=>{
  const p=createPage();
  const order=[];
  p.run("uiConfirm('첫 번째')").then(v=>order.push(['first',v]));
  p.run("uiConfirm('두 번째')").then(v=>order.push(['second',v]));
  p.run("uiPrompt('세 번째')").then(v=>order.push(['third',v]));
  await p.flush();
  assert.equal(p.modals().length,1,'only the first is on screen');
  assert.equal(p.modals()[0].children[0].children[0].textContent,'첫 번째');
  p.press('Escape');await p.flush();
  assert.equal(p.modals().length,1);
  assert.equal(p.modals()[0].children[0].children[0].textContent,'두 번째');
  p.click('확인');await p.flush();
  assert.equal(p.modals().length,1);
  p.input().value='글';p.press('Enter');await p.flush();
  assert.deepEqual(order,[['first',false],['second',true],['third','글']]);
  assert.equal(p.modals().length,0);
  assert.equal(p.listeners.length,0);
});

test('without a real page the dialogs fall back to their safe default instead of hanging',async()=>{
  const p=createPage();
  p.document.createElement=undefined;
  assert.equal(await p.run("uiConfirm('x')"),true);
  assert.equal(await p.run("uiChoice('x',[])"),null);
  assert.equal(await p.run("uiPrompt('x')"),null);
});
