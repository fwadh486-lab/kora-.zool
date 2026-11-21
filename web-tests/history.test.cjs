const test=require('node:test');
const assert=require('node:assert/strict');
process.env.TZ='Asia/Riyadh';
require('../match-feed-v2.js');require('../match-detail-feed-v2.js');
const feed=global.KoraMatchFeed,detail=global.KoraDetailFeed;
const now=new Date('2026-11-21T12:00:00+03:00');
const old={id:'ss:one',home:'Bayern Munich',away:'FC Köln',league:'de',date:'2026-11-20T19:30:00Z',score:'1 - 1',status:'FT',phase:'finished',slug:'koln-bayern'};
test('results include yesterday and the day before in the device timezone, never scheduled or live games',()=>{
  const before={...old,id:'ss:two',date:'2026-11-19T15:00:00Z'};
  const late={...old,id:'ss:late',date:'2026-11-18T22:30:00Z'};
  const future={...old,id:'ss:future',date:'2026-11-21T12:00:00Z',score:'— : —',status:'NS',phase:'upcoming'};
  assert.deepEqual(feed.resultDays(now,3),['2026-11-21','2026-11-20','2026-11-19']);
  assert.deepEqual(feed.completedResults([old,before,late,future,{...old,id:'ss:live',phase:'live',date:'2026-11-21T11:00:00Z'}],feed.resultDays(now,3)).map(x=>x.id),['ss:one','ss:two','ss:late']);
});
test('history requests each UTC day once, keeps valid results on partial provider failure',async()=>{
  const calls=[];const r=await feed.fetchResultHistory(now,3,async url=>{const date=new URL(url).searchParams.get('date');calls.push(date);if(date==='2026-11-18')throw Error('offline');return{ok:true,json:async()=>({matches:date==='2026-11-20'?[old]:[]})}});
  assert.equal(calls.length,new Set(calls).size);assert.equal(r.partial,true);assert.equal(r.events[0].id,old.id);
});
test('a cached scheduled match cannot overwrite a final result; historical link retains provider identity',()=>{
  const merged=feed.mergeMatches([old],[{...old,score:'— : —',phase:'upcoming',status:'NS',live:false}]);assert.equal(merged[0].score,'1 - 1');assert.equal(merged[0].phase,'finished');
  assert.match(feed.detailUrl(old),/sport=ss%3Aone&slug=koln-bayern/);
});
test('verified lineups merge separately by team, preserving 11 players and enriching only exact identities',()=>{
  const lineup=Array.from({length:11},(_,i)=>({name:'Player '+i,number:i+1,position:i===0?'GK':i<5?'D':i<9?'DM':'F'}));
  const main=[{side:'home',team:'Bayern Munich',players:lineup,bench:[]}];
  const secondary=[{side:'home',team:'Bayern Munich',formation:'4-4-2',players:[{name:'Player 1',id:123,photo:'https://example.com/real.png'},{name:'Player 10 Junior',photo:'https://example.com/wrong.png'}],bench:[{name:'Sub'}]},{side:'away',team:'FC Köln',players:[{name:'Away player'}]}];
  const merged=detail.mergeLineups(main,secondary);assert.equal(merged.length,2);assert.equal(merged[0].players.length,11);assert.equal(merged[0].players[1].photo,'https://example.com/real.png');assert.equal(merged[0].players[10].photo,undefined);assert.equal(merged[0].bench[0].name,'Sub');assert.deepEqual(detail.groups(merged[0].players,merged[0].formation).map(x=>x.length),[1,4,4,2]);
});
