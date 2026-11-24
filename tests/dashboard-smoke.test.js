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

test('lookup status boxes are announced to screen readers',()=>{
  for(const id of ['liveCertStatus','liveJobStatus','postingFetchStatus']){
    const tag=html.match(new RegExp('<[a-z]+[^>]*\\bid="'+id+'"[^>]*>'));
    assert.ok(tag,id);
    assert.match(tag[0],/role="status"/,id);assert.match(tag[0],/aria-live="polite"/,id);
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
  assert.match(html,/function plannerSwitchTab\(tab(,slide)?\)/);
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
  assert.match(html,/weekStart=LifeLogic\.weekStart\(today\)/);
  assert.match(html,/LifeLogic\.periodDates\(today,monthly\?'month':'week'\)/);
  assert.equal(require('../logic.js').weekStart('2026-11-17'),'2026-11-15','the week starts on Sunday');
  assert.match(html,/function weekdayOf\(date\)\{return new Date\(date\+'T12:00:00Z'\).getUTCDay\(\);\}/);
});

test('weekly insights is default and monthly insights has calendar month bounds',()=>{
  assert.match(html,/let insightsPeriod='week'/);
  assert.match(html,/function insightsSetPeriod\(period\)/);
  assert.match(html,/LifeLogic\.periodDates\(today,monthly\?'month':'week'\)/);
  const november=require('../logic.js').periodDates('2026-11-17','month');
  assert.equal(november.start,'2026-11-01');assert.equal(november.end,'2026-11-30');
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
  assert.match(html,/class="planner-item habit-row"/);
  assert.match(html,/class="focus-history-more"/);
  assert.match(html,/이번 주/);
  assert.match(html,/dashboard-panel \.btn/);
});

test('changing focus duration resets once after confirmation without second reset prompt',()=>{
  const match=html.match(/function focusChangeMinutes\(value\)\{([\s\S]*?)\n\}/);
  assert.ok(match,'focusChangeMinutes must exist');
  assert.doesNotMatch(match[1],/focusReset\(\)/);
  assert.match(match[1],/focusRemaining=Number\(value\)\*60/);
});

test('backup import validates nested records and warns when saving fails',()=>{
  assert.doesNotMatch(html,/validateLifeAIBackupState/);
  assert.match(html,/LifeLogic\.readBackup\(await file\.text\(\)\)/);
  assert.match(html,/if\(!result\.ok\)throw backupError\(result\.message\)/);
  assert.match(html,/const snapshot=localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(html,/lifeAISaveWarningShown/);
  assert.match(html,/기록을 저장하지 못했어요/);
});

test('focus timer starts with the saved duration after reopening the app',()=>{
  assert.match(html,/let focusRemaining=\(LifeLogic\.isFocusMinutes\(state\.focusSettings\?\.minutes\)/);
  assert.doesNotMatch(html,/let focusRemaining=25\*60/);
});

test('mobile bottom nav has no backdrop blur (its background is almost opaque, so blur only costs scrolling speed)',()=>{
  const base=html.match(/\.bottomnav\{([^}]*)\}/)[1];
  assert.match(base,/position:fixed/,'matched the base nav rule');
  assert.doesNotMatch(base,/backdrop-filter\s*:\s*blur/);
});

test('home summary is rounded and compact with details available on demand',()=>{
  assert.match(html,/class="soft-overview"/);
  assert.match(html,/class="soft-overview-row"/);
  assert.doesNotMatch(html,/자세한 현황 보기/);
  assert.doesNotMatch(html,/<div class="dashboard-stats">/);
  assert.match(html,/\.soft-overview\{[^}]*border-radius:26px/);
  assert.match(html,/aria-label="시험 일정 보기"/);
});

test('every link that opens a new tab hides the app address from the other site',()=>{
  const links=html.match(/<a\b[^>]*target="_blank"[^>]*>/g)||[];
  assert.ok(links.length>0);
  for(const tag of links)assert.match(tag,/rel="noopener noreferrer"/,tag);
});

