const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp,html}=require('./helpers/app-harness.js');

/* Fake scrolling: record which element was scrolled to / focused. */
function spy(a){
  const log=[];
  for(const id of ['plannerDayList','plannerEditor','plannerTitle']){
    const e=a.el(id);
    e.scrollIntoView=()=>log.push('scroll:'+id);
    e.focus=()=>log.push('focus:'+id);
  }
  return log;
}
const grid=a=>a.el('calendarContent').innerHTML;

/* #206 */
test('clicking a calendar day scrolls to that day\'s schedule card',()=>{
  const a=createApp();const log=spy(a);
  a.run("plannerSelect('2026-05-12',true)");
  assert.deepEqual(log,['scroll:plannerDayList']);
  assert.match(grid(a),/id="plannerDayList"/);
  assert.match(grid(a),/onclick="plannerSelect\('2026-05-12',true\)"/);
});

test('selecting a day without the reveal flag (e.g. "today" buttons) does not scroll',()=>{
  const a=createApp();const log=spy(a);
  a.run("plannerSelect('2026-05-12')");
  assert.deepEqual(log,[]);
});

/* #207 */
test('"+ add" and "edit" move to the form and focus the title; save and cancel go back to the list',async()=>{
  const a=createApp();const log=spy(a);
  a.run('plannerOpenForm()');
  assert.deepEqual(log.splice(0),['scroll:plannerEditor','focus:plannerTitle']);
  a.run('plannerCancelForm()');
  assert.deepEqual(log.splice(0),['scroll:plannerDayList']);

  a.run('plannerOpenForm()');log.length=0;
  a.el('plannerTitle').value='공부';a.el('plannerDate').value='2026-05-10';a.el('plannerTime').value='';
  a.el('plannerCategory').value='personal';a.el('plannerRepeat').value='none';a.el('plannerUntil').value='';a.el('plannerPriority').value='normal';
  await a.run('plannerSave()');
  assert.deepEqual(log.splice(0),['scroll:plannerDayList']);

  const id=a.saved().plannerEntries[0].id;
  a.run(`plannerEdit('${id}','2026-05-10')`);
  assert.deepEqual(log.splice(0),['scroll:plannerEditor','focus:plannerTitle']);
});

/* #210 */
test('month view dims days that belong to the previous or next month',()=>{
  const a=createApp();
  a.run("plannerSelected='2026-05-15';renderCalendar()");
  const buttons=grid(a).match(/<button type="button" class="planner-day[^>]*>/g);
  assert.equal(buttons.length,42);
  const other=buttons.filter(b=>/\bother\b/.test(b));
  // May 2026 starts on Friday and the grid starts Sun Apr 26: 5 April days + 6 June days.
  assert.equal(other.length,11);
  assert.ok(other.every(b=>/다른 달/.test(b)));
  const inMonth=buttons.filter(b=>/aria-label="5월 \d+일 /.test(b));
  assert.equal(inMonth.length,31);
  assert.ok(inMonth.every(b=>!/\bother\b/.test(b)&&!/다른 달/.test(b)));
});

test('week view never marks days as another month',()=>{
  const a=createApp();
  a.run("plannerView='week';plannerSelected='2026-05-01';renderCalendar()");
  assert.doesNotMatch(grid(a),/planner-day [^"]*\bother\b/);
});

/* #211 */
test('calendar cells show an event count and titles are at least 12px',()=>{
  const a=createApp();
  a.run("state.plannerEntries=[{id:'x1',title:'공부하기',date:'2026-05-12',time:'',category:'personal',repeat:'none',until:'',priority:'normal'}];plannerSelected='2026-05-12';renderCalendar()");
  assert.match(grid(a),/class="dot-count" aria-hidden="true">●1</);
  const size=html.match(/\.planner-day \.dot\{[^}]*font-size:(\d+)px/);
  assert.ok(Number(size[1])>=12);
  const mobile=html.match(/@media\(max-width:520px\)\{[^\n]*\}/)[0];
  assert.match(mobile,/\.planner-day \.dot\{display:none\}/);
  assert.match(mobile,/\.planner-day \.dot-count\{display:block\}/);
  assert.doesNotMatch(html,/\.planner-day \.dot\{font-size:(9|10)px/);
});
