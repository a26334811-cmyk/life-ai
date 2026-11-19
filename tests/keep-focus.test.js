const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

/* #213: redrawing the planner must hand keyboard focus back to the same control. */
function fakeControl(attrs){
  return {tagName:attrs.tag||'BUTTON',id:attrs.id||'',focused:0,focusArgs:null,
    getAttribute:name=>attrs[name]===undefined?null:attrs[name],
    focus(opts){this.focused++;this.focusArgs=opts;}};
}

test('after ticking a habit the same checkbox gets focus back',()=>{
  const a=createApp();
  const oldBox=fakeControl({tag:'INPUT',onchange:"habitToggle('h1','2026-05-10')"});
  const newBox=fakeControl({tag:'INPUT',onchange:"habitToggle('h1','2026-05-10')"});
  const other=fakeControl({tag:'INPUT',onchange:"habitToggle('h2','2026-05-10')"});
  const root=a.el('calendarContent');
  let redrawn=false;
  root.contains=n=>n===oldBox;
  root.querySelectorAll=()=>redrawn?[other,newBox]:[oldBox];
  a.context.document.activeElement=oldBox;
  a.context.__redraw=()=>{redrawn=true;};
  a.run('keepFocus(document.getElementById("calendarContent"),__redraw)');
  assert.equal(redrawn,true);
  assert.equal(newBox.focused,1);
  assert.equal(other.focused,0);
  assert.equal(newBox.focusArgs.preventScroll,true);
});

test('focus outside the planner is left alone and a vanished control does not crash',()=>{
  const a=createApp();
  const outside=fakeControl({onclick:'x()'});
  const inside=fakeControl({onclick:"plannerToggle('e1','2026-05-10')"});
  const stranger=fakeControl({onclick:'other()'});
  const root=a.el('calendarContent');
  root.contains=n=>n===inside;
  root.querySelectorAll=()=>[stranger];
  a.context.__redraw=()=>{};
  a.context.document.activeElement=outside;
  a.run('keepFocus(document.getElementById("calendarContent"),__redraw)');
  assert.equal(stranger.focused,0);
  a.context.document.activeElement=inside;
  a.run('keepFocus(document.getElementById("calendarContent"),__redraw)');
  assert.equal(stranger.focused,0);
});

test('picking a report day gives focus back to the same day button',()=>{
  const a=createApp();
  const day={tag:'BUTTON',onclick:"insightsSelectDate('2026-05-09')",'aria-label':'2026-05-09 집중 0분'};
  const oldDay=fakeControl(day),newDay=fakeControl(day);
  const target=a.el('progressInsights');
  assert.ok(target,'progressInsights element exists in the page');
  let redrawn=false;
  Object.defineProperty(target,'outerHTML',{set(){redrawn=true;},get(){return '';},configurable:true});
  target.parentElement={contains:n=>n===oldDay,querySelectorAll:()=>redrawn?[newDay]:[oldDay]};
  a.context.document.activeElement=oldDay;
  a.run('insightsSelectDate("2026-05-09")');
  assert.equal(redrawn,true);
  assert.equal(newDay.focused,1);
});

test('toggling a habit through the real handler keeps focus on its checkbox',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',nickname:'n',activity:[],completedTasks:[],habits:[{id:'h1',name:'걷기',checks:[]}]}));
  const attrs={tag:'INPUT',onchange:"habitToggle('h1','"+a.run('koreaToday()')+"')"};
  const oldBox=fakeControl(attrs),newBox=fakeControl(attrs);
  const root=a.el('calendarContent');
  let drawn=0;
  Object.defineProperty(root,'innerHTML',{set(){drawn++;},get(){return '';},configurable:true});
  root.contains=n=>n===oldBox;
  root.querySelectorAll=()=>drawn?[newBox]:[oldBox];
  a.context.document.activeElement=oldBox;
  a.run("habitToggle('h1',koreaToday())");
  assert.equal(drawn,1);
  assert.equal(newBox.focused,1);
});
