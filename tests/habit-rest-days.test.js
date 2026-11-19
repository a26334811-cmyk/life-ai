const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../logic.js');
const {createApp}=require('./helpers/app-harness.js');

/* #268: a rest day keeps a habit streak alive without adding to it. */
test('streak skips rest days without counting them',()=>{
  const checks=['2026-05-07','2026-05-08','2026-05-10'];
  assert.equal(L.habitStreak(checks,'2026-05-10'),1,'without a rest day the 9th breaks the streak');
  assert.equal(L.habitStreak(checks,'2026-05-10',['2026-05-09']),3);
});

test('a rest day today keeps yesterday\'s streak, and an unchecked day after it still breaks it',()=>{
  assert.equal(L.habitStreak(['2026-05-08','2026-05-09'],'2026-05-10',['2026-05-10']),2);
  assert.equal(L.habitStreak(['2026-05-07'],'2026-05-10',['2026-05-09']),0,'the 8th is neither checked nor rest');
});

test('rest days alone give no streak and bad input is ignored',()=>{
  assert.equal(L.habitStreak([],'2026-05-10',['2026-05-10','2026-05-09']),0);
  assert.equal(L.habitStreak(['2026-05-10'],'2026-05-10','nope'),1);
  assert.equal(L.habitStreak(undefined,'2026-05-10',undefined),0);
});

test('the old two-argument call still works',()=>{
  assert.equal(L.habitStreak(['2026-05-09','2026-05-10'],'2026-05-10'),2);
  assert.equal(L.habitStreak(['2026-05-09'],'2026-05-10'),1);
});

test('restDates must be a list of real dates when a backup is checked',()=>{
  const base={nickname:'a',mainGoal:'b',activity:[],completedTasks:[false,false,false,false,false]};
  const withHabit=h=>({...base,habits:[h]});
  assert.equal(L.validateBackupState(withHabit({id:'h1',name:'걷기',checks:[]})),true,'old habits have no restDates');
  assert.equal(L.validateBackupState(withHabit({id:'h1',name:'걷기',checks:[],restDates:['2026-05-09']})),true);
  assert.equal(L.validateBackupState(withHabit({id:'h1',name:'걷기',checks:[],restDates:'2026-05-09'})),false);
  assert.equal(L.validateBackupState(withHabit({id:'h1',name:'걷기',checks:[],restDates:['not a date']})),false);
});

const seeded=()=>JSON.stringify({mainGoal:'x',nickname:'n',activity:[],completedTasks:[false,false,false,false,false],
  habits:[{id:'h1',name:'걷기',createdAt:'2026-05-01',checks:['2026-05-08','2026-05-10']}]});

test('the rest button toggles today in the habit and the streak survives',()=>{
  // fake clock is 2026-05-10 in Korea; the 9th was missed, so rest on the 9th is set directly
  const a=createApp(seeded());
  assert.equal(a.run("habitStreak(habitEntries()[0])"),1);
  a.run("habitEntries()[0].restDates=['2026-05-09']");
  assert.equal(a.run("habitStreak(habitEntries()[0])"),2);
  a.run("habitRestToggle('h1')");
  assert.equal(a.run("JSON.stringify(habitEntries()[0].restDates)"),'["2026-05-09","2026-05-10"]');
  assert.equal(a.saved().habits[0].restDates.length,2);
  a.run("habitRestToggle('h1')");
  assert.equal(a.run("JSON.stringify(habitEntries()[0].restDates)"),'["2026-05-09"]');
});

test('the rest button appears on the habit panel',()=>{
  const a=createApp(seeded());
  assert.match(a.run('habitPanelHTML()'),/habitRestToggle\(this\.dataset\.id\)[\s\S]*오늘 쉬기/);
  a.run("habitRestToggle('h1')");
  assert.match(a.run('habitPanelHTML()'),/오늘은 쉬는 날이에요[\s\S]*쉬기 취소/);
});

test('the report leaves rest days out of the achievement rate',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',nickname:'n',activity:[],completedTasks:[false,false,false,false,false],
    habits:[{id:'h1',name:'걷기',createdAt:'2026-05-10',checks:['2026-05-10']},
            {id:'h2',name:'책',createdAt:'2026-05-10',checks:[]}]}));
  const rate=()=>Number(a.run('progressInsightsHTML()').match(/<strong>(\d+)%<\/strong><p class="meta">습관 달성률/)[1]);
  assert.equal(rate(),50);
  a.run("habitEntries()[1].restDates=['2026-05-10']");
  assert.equal(rate(),100);
});
