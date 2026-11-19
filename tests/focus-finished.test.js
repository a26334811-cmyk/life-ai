const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

/* #189: a session that already finished must not trigger the "reset the running timer?" warning. */
test('after a session has finished, reset and duration change do not ask for confirmation',async()=>{
  const a=createApp(undefined,{confirm:false});
  a.run('focusStartPause()');
  a.clock.now+=25*60*1000+500;
  a.tick();
  assert.equal(a.run('focusRunning'),false);
  await a.run('focusReset()');
  assert.equal(a.run('focusRemaining'),25*60);
  assert.equal(a.run('focusHistory().length'),1);
  a.run('focusStartPause()');
  a.clock.now+=25*60*1000+500;
  a.tick();
  await a.run('focusChangeMinutes(30)');
  assert.equal(a.run('focusRemaining'),30*60);
  assert.equal(a.run('focusSettings().minutes'),30);
});

test('a paused timer still asks before reset',async()=>{
  const a=createApp(undefined,{confirm:false});
  a.run('focusStartPause()');
  a.clock.now+=60*1000;
  a.run('focusStartPause()');
  await a.run('focusReset()');
  assert.equal(a.run('focusRemaining'),24*60);
});
