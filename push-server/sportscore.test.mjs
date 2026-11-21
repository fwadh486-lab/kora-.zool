import test from 'node:test';
import assert from 'node:assert/strict';
import {fromSportScore,collectSportScore} from './sportscore.mjs';
import {newCards,transitions,notificationFor} from './events.mjs';

const now=Date.parse('2026-11-20T18:30:00Z');
const base={home:'Al Ahli SC',away:'Al Nassr',home_score:'1',away_score:'1',status:'live',status_text:'Half time',time:'2026-11-20T17:30:00Z',competition:'Saudi Professional League',url:'/football/match/al-nassr-fc-vs-al-ahli-sfc/pxwrxlhy4w35ryk/'};
const card={time:23,type:'Yellow card',type_id:3,side:'home',player:'Eduard Spertsyan',is_card:true};
const preferences={teams:[],matches:[],types:['goal','kickoff','yellow'],allLive:true};

test('normalize verified provider shape with card, phase, score and stable ID',()=>{
  const match=fromSportScore({...base,incidents:[card]});
  assert.equal(match.league,'sa');assert.equal(match.status,'HT');assert.equal(match.homeScore,1);
  assert.equal(match.id,'ss:pxwrxlhy4w35ryk');assert.equal(match.cards[0].type,'yellow');
  const second=fromSportScore({...base,status_text:'2nd half',live_minute:'46',incidents:[card]});
  assert.deepEqual(transitions(match,second),['secondhalf']);assert.deepEqual(newCards(match,second),[]);
  const message=notificationFor({id:'card',type:'yellow',card:match.cards[0],match},'ar','https://example.org/');assert.equal(message.source,'SportScore');
  assert.match(message.body,/Eduard Spertsyan/);
});
test('goal incident and exact same-team lineup photo are preserved',()=>{
  const photo='https://img.thesports.com/football/player/p.png';
  const raw={...base,home_score:'2',incidents:[{side:'home',player:'Player One',is_goal:true,home_score:2,away_score:1,time:55}],lineups:{home_xi:[{name:'Player One',photo}],away_xi:[{name:'Player One',photo:'https://img.thesports.com/football/player/wrong.png'}]}};
  const match=fromSportScore(raw);assert.equal(match.goals[0].photo,photo);
  const message=notificationFor({id:'goal',type:'goal-home',match},'ar','https://example.org/');assert.match(message.body,/55′.*Player One/);assert.equal(message.image,photo);
});

test('poll live details, reject an ambiguous slug, fetch a disappeared match to confirm full time',async()=>{
  const actualFetch=globalThis.fetch;let scenario='live',calls=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);calls.push(u);assert.equal(u.origin,'https://sportscore.com');
    if(u.pathname==='/api/v1/fixtures/')return Response.json({sport:'football',matches:u.searchParams.get('status')==='live'&&scenario!=='finished'?[base]:[]});
    return Response.json({sport:'football',match:scenario==='wrong'?{...base,url:base.url.replace('pxwrxlhy4w35ryk','wrongid')}:scenario==='finished'?{...base,status:'finished',status_text:'Finished',incidents:[card]}:{...base,incidents:[card]}});
  };
  try{
    const result=await collectSportScore(now,new Map(),[{preferences}]);assert.equal(result.liveCount,1);assert.equal(result.detailCount,1);
    const match=result.matches.values().next().value;assert.equal(match.cards.length,1);
    assert.equal(calls.filter(u=>u.pathname==='/api/widget/match/').length,1);
    scenario='wrong';const wrong=await collectSportScore(now,new Map(),[{preferences}]);assert.equal(wrong.detailCount,0);assert.equal(wrong.matches.get(match.id).cards,null);
    scenario='finished';const previous=new Map([[match.id,{match_json:JSON.stringify(match),updated:now}]]);
    const final=await collectSportScore(now+60000,previous,[{preferences}]);assert.equal(final.matches.get(match.id).status,'FT');
    assert.deepEqual(transitions(match,final.matches.get(match.id)),['fulltime']);
  }finally{globalThis.fetch=actualFetch}
});
