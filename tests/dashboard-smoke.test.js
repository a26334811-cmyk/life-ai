const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
test('inline application JavaScript parses',()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
  assert.ok(scripts.length>0,'expected inline app script');
  scripts.forEach((script,i)=>assert.doesNotThrow(()=>new vm.Script(script,{filename:'index-script-'+i+'.js'})));
});
test('modern blue dashboard and navigation targets exist',()=>{
  for(const id of ['home','my','goals','calendar','jobHub','cert','liveJobs','bottomnav']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  for(const marker of ['dashboard-stats','dashboard-grid','exportLifeAIBackup','importLifeAIBackup','liveJobsRequestVersion']){
    assert.ok(html.includes(marker),marker);
  }
});

test('planner, focus and habit integration markers are present',()=>{
  for(const fn of ['plannerSave','plannerOccurs','plannerForDate','habitToggle','habitStreak','focusStartPause','focusRecordCompletion','progressInsightsHTML','focusNotify']){
    assert.match(html,new RegExp('function '+fn+'\\('),fn);
  }
  for(const token of ["alarm:'vibrate'","navigator.vibrate","focus-flash","visibilitychange","focusHistoryHTML()","habitPanelHTML()","progressInsightsHTML()"]){
    assert.ok(html.includes(token),token);
  }
});

test('nested Netlify entrypoint matches root app',()=>{
  const path=require('node:path');
  const nested=fs.readFileSync(path.join(__dirname,'..','LIFE_AI_v6_2_QNET_LIVE_FIXED (3)','life_ai_v6_2','index.html'),'utf8');
  assert.equal(nested,html,'nested deployment directory must not serve a stale app');
});

test('planner has four tabbed panels and defaults to Today',()=>{
  for(const tab of ['today','calendar','habits','stats']){
    assert.ok(html.includes("'"+tab+"'"),tab);
  }
  assert.match(html,/let plannerActiveTab='today'/);
  assert.match(html,/function plannerSwitchTab\(tab\)/);
  assert.match(html,/planner-tabpanel\[hidden\]/);
});

test('planner editor starts collapsed and supports explicit add/edit/cancel',()=>{
  assert.match(html,/let plannerFormOpen=false/);
  assert.match(html,/function plannerOpenForm\(\)/);
  assert.match(html,/function plannerCancelForm\(\)/);
  assert.match(html,/id="plannerEditor"/);
  assert.match(html,/aria-expanded=/);
});

test('day view hides weekday grid and weekly report starts on Sunday',()=>{
  assert.match(html,/plannerView==='day'\s*\?/);
  assert.match(html,/planner-day-summary/);
  assert.match(html,/이번 주/);
  assert.match(html,/weekStart=plannerDateOffset\(today,-new Date\(today\+'T12:00:00Z'\).getUTCDay\(\)\)/);
});

test('weekly insights is default and monthly insights has calendar month bounds',()=>{
  assert.match(html,/let insightsPeriod='week'/);
  assert.match(html,/function insightsSetPeriod\(period\)/);
  assert.match(html,/monthStart=today.slice\(0,7\)\+'-01'/);
  assert.match(html,/월간/);
  assert.match(html,/id="progressInsights"/);
});

test('recovery mode is opt-in and does not suppress critical reminders',()=>{
  assert.match(html,/function recoverySetMode\(mode\)/);
  assert.match(html,/function recoveryPanelHTML\(\)/);
  assert.match(html,/state.recoveryMode=mode;persistState\(\)/);
  assert.match(html,/시험·면접 일정을 숨기지 않아요/);
});

test('monthly heatmap displays daily focus and selectable dates',()=>{
  assert.match(html,/function insightsSelectDate\(date\)/);
  assert.match(html,/class="insights-heatmap"/);
  assert.match(html,/aria-label="월간 날짜별 집중 시간"/);
  assert.match(html,/d\.minutes\/maxDayMinutes/);
  assert.match(html,/selected\.minutes/);
});

test('focus timer uses compact action row and hides advanced alarm settings',()=>{
  assert.match(html,/class="focus-actions"/);
  assert.match(html,/class="focus-more"/);
  assert.match(html,/알림 및 사용 안내/);
  assert.match(html,/진행 중인 집중 시간을 초기화할까요/);
  assert.match(html,/집중 시간을 변경하면 진행 중인 타이머가 초기화돼요/);
});

test('dashboard and secondary cards stay compact and avoid stale preview messaging',()=>{
  assert.doesNotMatch(html,/새 기능 미리보기 · 2026-11-12/);
  assert.match(html,/class="habit-add"/);
  assert.match(html,/class="habit-row"/);
  assert.match(html,/class="focus-history-more"/);
  assert.match(html,/이번 주/);
  assert.match(html,/dashboard-panel \.btn/);
});
