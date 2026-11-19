const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

/* #269: when a focus session ends, offer a 5 minute break that does not touch the focus settings. */
const MIN=60*1000;
const finishSession=a=>{a.run('focusStartPause()');a.clock.now+=25*MIN+500;a.tick();};
const settle=()=>new Promise(r=>setImmediate(r));

test('finishing a session asks what to do next with a 5 minute break and one more round',async()=>{
  const asked=[];
  const a=createApp(undefined,{choice:(message,choices)=>{asked.push({message,choices});return null;}});
  finishSession(a);
  await settle();
  assert.equal(asked.length,1);
  assert.equal(asked[0].choices.map(c=>c.value).join(','),'break,again');
  assert.match(asked[0].choices[0].label,/5분 쉬기/);
  assert.equal(a.run('focusHistory().length'),1);
  assert.equal(a.run('focusBreakActive()'),false,'closing the dialog starts nothing');
});

test('choosing the break counts down 5 minutes without changing settings or history',async()=>{
  const a=createApp(undefined,{choice:'break',confirm:false});
  finishSession(a);
  await settle();
  assert.equal(a.run('focusBreakActive()'),true);
  assert.equal(a.run('focusBreakRemaining'),300);
  assert.equal(a.el('focusClock').textContent,'05:00');
  assert.equal(a.run('focusSettings().minutes'),25);
  assert.equal(a.run('focusRunning'),false);
  a.clock.now+=2*MIN;a.tick();
  assert.equal(a.run('focusBreakRemaining'),180);
  assert.equal(a.el('focusClock').textContent,'03:00');
  assert.equal(a.run('focusHistory().length'),1,'a break is not a focus record');
  assert.equal('focusRun' in a.saved(),false);
});

test('when the break ends it only asks whether to focus again',async()=>{
  const questions=[];
  const a=createApp(undefined,{choice:'break',confirm:m=>{questions.push(m);return false;}});
  finishSession(a);
  await settle();
  a.clock.now+=5*MIN+1000;a.tick();
  await settle();
  assert.equal(a.run('focusBreakActive()'),false);
  assert.equal(questions.length,1);
  assert.match(questions[0],/다시 집중할까요/);
  assert.equal(a.run('focusRunning'),false);
  assert.equal(a.run('focusRemaining'),25*60,'ready for the next 25 minutes');
  assert.equal(a.run('focusSettings().minutes'),25);
  assert.equal(a.run('focusHistory().length'),1);
});

test('saying yes after the break starts the next focus session',async()=>{
  const a=createApp(undefined,{choice:'break',confirm:true});
  finishSession(a);
  await settle();
  a.clock.now+=5*MIN+1000;a.tick();
  await settle();
  assert.equal(a.run('focusRunning'),true);
  assert.equal(a.run('focusRemaining'),25*60);
});

test('"one more round" starts a fresh focus session at once',async()=>{
  const a=createApp(undefined,{choice:'again'});
  finishSession(a);
  await settle();
  assert.equal(a.run('focusRunning'),true);
  assert.equal(a.run('focusRemaining'),25*60);
  assert.equal(a.run('focusBreakActive()'),false);
});

test('pressing start or reset during a break ends the break',async()=>{
  const a=createApp(undefined,{choice:'break'});
  finishSession(a);
  await settle();
  a.run('focusStartPause()');
  assert.equal(a.run('focusBreakActive()'),false);
  assert.equal(a.run('focusRunning'),true);
  const b=createApp(undefined,{choice:'break',confirm:false});
  finishSession(b);
  await settle();
  await b.run('focusReset()');
  assert.equal(b.run('focusBreakActive()'),false);
  assert.equal(b.run('focusRunning'),false);
  assert.equal(b.run('focusRemaining'),25*60);
  assert.equal(b.dialogs.filter(d=>d.kind==='confirm').length,0,'no warning for a break');
});

test('changing the saved focus length is not caused by taking a break',async()=>{
  const a=createApp(undefined,{choice:'break'});
  a.run("focusChangeMinutes(30)");
  await settle();
  a.run('focusStartPause()');a.clock.now+=30*MIN+500;a.tick();
  await settle();
  assert.equal(a.run('focusBreakRemaining'),300);
  assert.equal(a.run('focusSettings().minutes'),30);
  assert.equal(a.saved().focusSettings.minutes,30);
});
