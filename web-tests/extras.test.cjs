const test=require('node:test');
const assert=require('node:assert/strict');
require('../match-feed-v2.js');
require('../match-extras-v1.js');
const x=global.KoraMatchExtras;
const upcoming={id:'ss:fixture1',home:'Real Madrid',away:'FC Barcelona',status:'NS',score:'— : —',phase:'upcoming',date:'2026-12-10T20:00:00Z'};
function memory(){const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),all:m}}
test('private prediction persists across reads with no fabricated crowd data',()=>{
 const store=memory();assert.equal(x.prediction(store,upcoming.id),null);
 assert.equal(x.savePrediction(store,upcoming.id,'home'),true);
 assert.equal(x.prediction(store,upcoming.id),'home');
 assert.equal(x.savePrediction(store,upcoming.id,'bad-choice'),false);
 assert.equal(x.prediction(store,upcoming.id),'home');
 assert.equal(x.savePrediction(store,'__proto__','draw'),true);
 assert.equal(x.prediction(store,'__proto__'),'draw');
 assert.ok(!store.all.toString().includes('http'));
});
test('upcoming and calendar times are true UTC, not fixed Riyadh clock',()=>{
 const now=Date.parse('2026-12-01T00:00:00Z');
 assert.equal(x.isUpcoming(upcoming,now),true);
 const link=x.calendarLink(upcoming,now),url=new URL(link);
 assert.equal(url.origin,'https://calendar.google.com');
 assert.equal(url.searchParams.get('action'),'TEMPLATE');
 assert.equal(url.searchParams.get('dates'),'20261210T200000Z/20261210T220000Z');
 assert.match(url.searchParams.get('text'),/Real Madrid.*Barcelona/);
 assert.equal(x.calendarLink({...upcoming,status:'FT',phase:'finished'},now),'');
 assert.equal(x.calendarLink({...upcoming,date:'not-a-date'},now),'');
 assert.equal(x.calendarLink(upcoming,Date.parse('2026-12-11T00:00:00Z')),'');
});
test('calendar link cannot inject newlines into title or description',()=>{
 const url=new URL(x.calendarLink({...upcoming,home:'ABC\nDEF',away:'XY\r\nZ'},Date.parse('2026-12-01T00:00:00Z')));
 assert.equal(url.searchParams.get('text'),'ABC DEF × XY Z | Kora Zol');
});
test('goal scorer filter drops VAR-disallowed or overturned goals',()=>{
 assert.equal(x.isCountedGoal({type:'Goal',player:'A'}),true);
 assert.equal(x.isCountedGoal({type:'Own Goal'}),true);
 for(const entry of [{type:'Disallowed Goal'},{type:'Goal',detail:'VAR cancelled'},{type:'Goal',description:'Goal overturned'}])assert.equal(x.isCountedGoal(entry),false);
 assert.equal(x.isCountedGoal({type:'Yellow card'}),false);
});
