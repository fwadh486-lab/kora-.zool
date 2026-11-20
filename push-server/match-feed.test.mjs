import test from 'node:test';
import assert from 'node:assert/strict';
import '../match-feed-v1.js';
process.env.TZ='Asia/Riyadh';
const feed=globalThis.KoraMatchFeed;
const now=new Date('2026-11-20T21:30:00Z');
const match={id:'en:123',league:'en',home:'Team A',away:'Team B',date:'2026-11-20T20:00:00Z'};
test('Riyadh midnight retains live and recent results, but not old scheduled games',()=>{
  assert.deepEqual(feed.fixtureDays(0,now),['2026-11-20','2026-11-21']);
  assert.equal(feed.visibleOnDay({...match,phase:'live'},'2026-11-21',true,+now),true);
  assert.equal(feed.visibleOnDay({...match,phase:'finished'},'2026-11-21',true,+now),true);
  assert.equal(feed.visibleOnDay({...match,phase:'upcoming'},'2026-11-21',true,+now),false);
  assert.equal(feed.visibleOnDay({...match,phase:'live'},'2026-11-21',false,+now),false);
});
test('only confirmed finished status counts as a result',()=>{
  assert.equal(feed.phaseOf({status:'FT',score:'0 - 0'}),'finished');
  assert.equal(feed.phaseOf({status:'HT',score:'2 - 1'}),'live');
  assert.equal(feed.phaseOf({status:'Postponed',score:'0 - 0'}),'other');
  assert.equal(feed.phaseOf({status:'Scheduled',score:'0 - 0'}),'upcoming');
});
test('merge updates a score and final status without changing ESPN favorite ID',()=>{
  const old={...match,home:'Bayern Munich',away:'Cologne',status:'HT',live:true};
  const fresh={...match,id:'ss:abc',home:'Bayern München',away:'Köln',phase:'finished',live:false,status:'FT',score:'1 - 1'};
  const result=feed.mergeMatches([old],[fresh]);
  assert.equal(result.length,1);
  assert.equal(result[0].id,old.id);
  assert.equal(result[0].phase,'finished');
  assert.equal(result[0].score,'1 - 1');
});
