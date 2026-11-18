/* Real numbers for the stats screen: progressInsightsHTML() (report) and focusHistoryHTML() (focus record).
   The clock is fixed, so every expected value below was worked out by hand from the dates. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

// "12:00 in Korea" = 03:00 UTC on the same date
const kst=date=>Date.parse(date+'T03:00:00Z');
function setup(date,{habits=[],history=[],period='week',nowMs}={}){
  const a=createApp(null,{now:nowMs||kst(date)});
  a.run('state.habits='+JSON.stringify(habits)+';state.focusHistory='+JSON.stringify(history)+";insightsPeriod='"+period+"';insightsSelectedDate=''");
  return a;
}
const report=a=>{
  const html=a.run('progressInsightsHTML()');
  const pick=(re,name)=>{const m=html.match(re);assert.ok(m,'missing '+name);return m[1];};
  return {
    html,
    period:pick(/class="meta insights-period">([^<]+)</,'period'),
    focus:Number(pick(/<strong>(\d+)분<\/strong><p class="meta">집중 시간/,'focus minutes')),
    active:Number(pick(/<strong>(\d+)일<\/strong><p class="meta">활동한 날/,'active days')),
    rate:pick(/<strong>([^<]+)<\/strong><p class="meta">습관 달성률/,'rate'),
    basis:pick(/습관 달성 (\d+\/\d+)회/,'basis'),
    habitsCount:Number(pick(/등록된 습관 (\d+)개/,'habit count')),
    dayButtons:(html.match(/class="insights-day /g)||[]).length,
    bars:[...html.matchAll(/<small>(.)<\/small><div class="meta">(\d+)분/g)].map(m=>m[1]+m[2])
  };
};
const record=a=>{
  const html=a.run('focusHistoryHTML()');
  const m=re=>html.match(re)[1];
  return {today:Number(m(/<strong>(\d+)분<\/strong><p class="meta">오늘/)),week:Number(m(/<strong>(\d+)분<\/strong><p class="meta">이번 주/)),all:m(/<strong>([^<]+)<\/strong><p class="meta">전체/)};
};

const history=[
  {date:'2026-11-29',minutes:30,category:'study'},
  {date:'2026-11-30',minutes:25,category:'study'},
  {date:'2026-11-30',minutes:10,category:'job'},
  {date:'2026-11-28',minutes:60,category:'study'},   // the Saturday before the week
  {date:'2026-12-01',minutes:45,category:'study'}    // in the future relative to Nov 30
];
const habits=[
  {id:'h1',name:'독서',createdAt:'2026-11-01',checks:['2026-11-28','2026-11-29','2026-11-30','2026-12-01']},
  {id:'h2',name:'운동',createdAt:'2026-11-30',checks:['2026-11-30']},   // made today
  {id:'h3',name:'물 마시기',checks:['2026-11-29']},                    // no creation date
  {id:'h4',name:'내일 시작',createdAt:'2026-12-01',checks:[]}          // not started yet
];

test('weekly report for a week that crosses the end of November (Mon 2026-11-30)',()=>{
  const r=report(setup('2026-11-30',{habits,history}));
  assert.equal(r.period,'11-29 ~ 12-05');
  // focus: 11-29 30 + 11-30 35 = 65 (11-28 is before the week, 12-01 is after today)
  assert.equal(r.focus,65);
  assert.equal(r.active,2);
  // 11-29: possible h1,h3 = 2, done h1,h3 = 2. 11-30: possible h1,h2,h3 = 3, done h1,h2 = 2. => 4/5
  assert.equal(r.basis,'4/5');assert.equal(r.rate,'80%');
  assert.equal(r.habitsCount,4);
  assert.deepEqual(r.bars,['일30','월35','화0','수0','목0','금0','토0']);
});

test('focus record: today, this week and total use the same fixed dates',()=>{
  const x=record(setup('2026-11-30',{habits,history}));
  assert.equal(x.today,35);
  assert.equal(x.week,65);          // 11-29 + 11-30 only
  assert.equal(x.all,'2시간 50분');  // 30+25+10+60+45 = 170 minutes
});

test('monthly report for November 2026',()=>{
  const r=report(setup('2026-11-30',{habits,history,period:'month'}));
  assert.equal(r.period,'11-01 ~ 11-30');
  assert.equal(r.dayButtons,30);
  assert.equal(r.focus,125);        // 60 + 30 + 35
  assert.equal(r.active,3);         // 11-28, 11-29, 11-30
  // possible: h1 30 days + h2 1 + h3 30 = 61; done: h1 3 (11-28,29,30) + h2 1 + h3 1 = 5
  assert.equal(r.basis,'5/61');assert.equal(r.rate,'8%');
});

test('week starts on Sunday: today being Sunday, Saturday and the first of a month',()=>{
  assert.equal(report(setup('2026-11-29')).period,'11-29 ~ 12-05');   // Sunday
  assert.equal(report(setup('2026-12-05')).period,'11-29 ~ 12-05');   // Saturday
  assert.equal(report(setup('2026-12-06')).period,'12-06 ~ 12-12');   // next Sunday
  assert.equal(report(setup('2026-12-01')).period,'11-29 ~ 12-05');   // Tuesday the 1st
});

test('leap year: February 2028 has 29 days, February 2026 has 28',()=>{
  const leap=report(setup('2028-02-29',{period:'month',history:[{date:'2028-02-29',minutes:20,category:'study'},{date:'2028-03-01',minutes:99,category:'study'}]}));
  assert.equal(leap.period,'02-01 ~ 02-29');assert.equal(leap.dayButtons,29);
  assert.equal(leap.focus,20,'March 1 is outside February');
  const plain=report(setup('2026-02-10',{period:'month'}));
  assert.equal(plain.period,'02-01 ~ 02-28');assert.equal(plain.dayButtons,28);
  const week=report(setup('2028-02-29',{history:[{date:'2028-02-29',minutes:20,category:'study'}]}));
  assert.equal(week.period,'02-27 ~ 03-04','the week runs through the leap day into March');
  assert.equal(week.focus,20);
});

test('a habit made today only counts from today, and no habits shows a dash instead of 0%',()=>{
  const r=report(setup('2026-11-30',{habits:[{id:'n',name:'새 습관',createdAt:'2026-11-30',checks:[]}]}));
  assert.equal(r.basis,'0/1');assert.equal(r.rate,'0%','one possible day (today), nothing done');
  const done=report(setup('2026-11-30',{habits:[{id:'n',name:'새 습관',createdAt:'2026-11-30',checks:['2026-11-30']}]}));
  assert.equal(done.rate,'100%');assert.equal(done.active,1);
  const none=report(setup('2026-11-30'));
  assert.equal(none.rate,'—');assert.equal(none.basis,'0/0');assert.equal(none.focus,0);assert.equal(none.active,0);
});

test('records without a date or without checks do not break the numbers',()=>{
  const a=setup('2026-11-30',{habits:[{id:'x',name:'검사 없음'},{id:'y',name:'날짜 없음',checks:['2026-11-30']}],
    history:[{minutes:99,category:'study'},{date:'2026-11-30',minutes:25,category:'study'}]});
  const r=report(a);
  assert.equal(r.focus,25,'an entry without a date is not counted in any day');
  assert.equal(r.basis,'1/4');  // 2 habits x 2 days (11-29, 11-30) possible, 1 done
  const x=record(a);
  assert.equal(x.today,25);assert.equal(x.week,25);
});

test('the Korean date decides the day: 01:00 on Dec 1 in Korea is still Nov 30 in UTC',()=>{
  const a=setup('2026-12-01',{history,nowMs:Date.parse('2026-11-30T16:00:00Z')});
  assert.equal(a.run('koreaToday()'),'2026-12-01');
  const x=record(a);
  assert.equal(x.today,45,'only the Dec 1 session counts as today');
  assert.equal(x.week,110);   // 11-29 30 + 11-30 35 + 12-01 45
  assert.equal(report(a).focus,110);
});
