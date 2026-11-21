import test from 'node:test';
import assert from 'node:assert/strict';
import {fromSportScore,collectSportScore,publicFixtures} from './sportscore.mjs';
import {newCards,transitions,notificationFor} from './events.mjs';

const now=Date.parse('2026-11-20T18:30:00Z');
const base={home:'Al Ahli SC',away:'Al Nassr',home_score:'1',away_score:'1',status:'live',status_text:'Half time',time:'2026-11-20T17:30:00Z',competition:'Saudi Professional League',url:'/football/match/al-nassr-fc-vs-al-ahli-sfc/pxwrxlhy4w35ryk/'};
const card={time:23,type:'Yellow card',type_id:3,side:'home',player:'Eduard Spertsyan',is_card:true};
const preferences={teams:[],matches:[],types:['goal','kickoff','yellow'],allLive:true};

test('requested competitions are recognized and queried by their provider slugs',async()=>{
  const leagues={'sudanese-premier-league':['Sudanese Premier League','sd'],'rwandan-national-league':['Rwandan National League','rw'],'qatar-stars-league':['Qatar Stars League','qa'],'caf-champions-league':['CAF Champions League','cafcl'],'uefa-europa-league':['UEFA Europa League','el'],'uefa-nations-league':['UEFA Nations League','nations'],'uefa-european-championship':['UEFA European Championship','euro']};
  const actual=globalThis.fetch;const calls=[];globalThis.fetch=async url=>{const slug=new URL(url).searchParams.get('competition');calls.push(slug);const entry=leagues[slug];return Response.json({sport:'football',matches:entry?[{...base,competition:entry[0],url:`/football/match/test/${entry[1]}123/`}]:[]})};
  try{const result=await publicFixtures('2026-11-19',now);assert.equal(result.partial,false);for(const [slug,[name,code]] of Object.entries(leagues)){assert.ok(calls.includes(slug));assert.equal(fromSportScore({...base,competition:name}).league,code);assert.ok(result.matches.some(m=>m.league===code))}}finally{globalThis.fetch=actual}
});

test('normalize verified provider shape with card, phase, score and stable ID',()=>{
  const match=fromSportScore({...base,incidents:[card]});
  assert.equal(match.league,'sa');assert.equal(match.status,'HT');assert.equal(match.homeScore,1);
  assert.equal(match.id,'ss:pxwrxlhy4w35ryk');assert.equal(match.cards[0].type,'yellow');
  const second=fromSportScore({...base,status_text:'2nd half',live_minute:'46',incidents:[card]});
  assert.deepEqual(transitions(match,second),['secondhalf']);assert.deepEqual(newCards(match,second),[]);
  const message=notificationFor({id:'card',type:'yellow',card:match.cards[0],match},'ar','https://example.org/');assert.match(message.body,/SportScore/);
  assert.match(message.body,/Eduard Spertsyan/);
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
