/* The focus-timer end alert really runs for each alarm mode, using a fake AudioContext, navigator.vibrate and panel. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

const NOW=Date.parse('2026-05-10T03:00:00Z');
function fakeAudio(){
  const log={created:0,started:0,instances:[]};
  class FakeAudioContext{
    constructor(){log.created++;this.state='suspended';this.currentTime=0;this.destination={};log.instances.push(this);}
    resume(){this.state='running';return Promise.resolve();}
    createOscillator(){return {frequency:{},connect:g=>g,start(){log.started++;},stop(){}};}
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect:d=>d};}
  }
  return {log,FakeAudioContext};
}
function build(alarm,{running=true}={}){
  const saved=JSON.stringify(running?{focusSettings:{minutes:25,alarm},focusRun:{status:'running',deadline:NOW+60000,minutes:25,category:'study'}}:{focusSettings:{minutes:25,alarm}});
  const a=createApp(saved,{now:NOW});
  const audio=fakeAudio();
  const vibrations=[],flashes=[];
  a.context.window={AudioContext:audio.FakeAudioContext};
  a.context.navigator.vibrate=pattern=>{vibrations.push(pattern);return true;};
  const panel=a.el('focusPanel');
  panel.classList={add:c=>flashes.push(c),remove(){},toggle(){},contains(){return false;}};
  return {a,audio,vibrations,flashes};
}
const finish=a=>{a.clock.now+=26*60000;a.tick();};

test('vibrate mode vibrates at the end and makes no sound',()=>{
  const t=build('vibrate');finish(t.a);
  assert.equal(t.vibrations.length,1);assert.equal(t.audio.log.started,0);assert.deepEqual(t.flashes,[]);
});

test('sound mode plays a tone when the sound was prepared by pressing start',()=>{
  const t=build('sound',{running:false});
  t.a.run('focusPrimeSound()');
  t.a.run('focusStartPause()');
  finish(t.a);
  assert.equal(t.audio.log.started,1,'tone played');
  assert.equal(t.vibrations.length,0,'no fallback needed');
  assert.deepEqual(t.flashes,[]);
});

test('sound mode after the app was reopened (sound never prepared) falls back to vibration and flashing',()=>{
  const t=build('sound');   // timer was already running when the app opened: focusPrimeSound never ran
  finish(t.a);
  assert.equal(t.audio.log.started,0,'no tone is possible without a tap');
  assert.equal(t.vibrations.length,1,'vibrates instead');
  assert.deepEqual(t.flashes,['focus-flash'],'flashes instead');
});

test('sound mode with a sound context that is still suspended also falls back',()=>{
  const t=build('sound',{running:false});
  t.a.run('focusPrimeSound()');
  t.audio.log.instances[0].resume=()=>new Promise(()=>{});   // the browser never allowed it
  t.audio.log.instances[0].state='suspended';
  t.a.run('focusStartPause()');
  finish(t.a);
  assert.equal(t.audio.log.started,0);assert.equal(t.vibrations.length,1);assert.deepEqual(t.flashes,['focus-flash']);
});

test('flash mode only flashes, silent mode does nothing',()=>{
  const f=build('flash');finish(f.a);
  assert.deepEqual(f.flashes,['focus-flash']);assert.equal(f.vibrations.length,0);assert.equal(f.audio.log.started,0);
  const s=build('silent');finish(s.a);
  assert.deepEqual(s.flashes,[]);assert.equal(s.vibrations.length,0);assert.equal(s.audio.log.started,0);
});

test('finishing records the session once and alerts once',()=>{
  const t=build('vibrate');finish(t.a);t.a.tick();
  assert.equal(t.a.run('state.focusHistory.length'),1);
  assert.equal(t.vibrations.length,1);
});
