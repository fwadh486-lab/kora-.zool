import test from 'node:test';
import assert from 'node:assert/strict';
import {fromSportScore,collectSportScore,verifiedAssist} from './sportscore.mjs';
import {newCards,transitions,notificationFor,isFreshSportScoreKickoff} from './events.mjs';

const now=Date.parse('2026-11-20T18:30:00Z');
const base={home:'Al Ahli SC',away:'Al Nassr',home_score:'1',away_score:'1',status:'live',status_text:'Half time',time:'2026-11-20T17:30:00Z',competition:'Saudi Professional League',url:'/football/match/al-nassr-fc-vs-al-ahli-sfc/pxwrxlhy4w35ryk/'};
const card={time:23,type:'Yellow card',type_id:3,side:'home',player:'Eduard Spertsyan',is_card:true};
const preferences={teams:[],matches:[],types:['goal','kickoff','yellow'],allLive:true};

test('Premier League phases are detected even when missing from the capped global feed and live clock',async()=>{
  const actual=globalThis.fetch;
  let phase='Not started';
  const fixture={...base,home:'Manchester City',away:'Fulham',competition:'English Premier League',url:'/football/match/manchester-city-fulham/city123/',time:new Date(now).toISOString(),home_score:0,away_score:0};
  let calls=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);calls.push(u);
    if(u.pathname!=='/api/v1/fixtures/')return Response.json({match:{...fixture,status_text:phase}});
    const competition=u.searchParams.get('competition');
    return Response.json({sport:'football',matches:competition==='english-premier-league'?[{...fixture,status_text:phase}]:!competition&&u.searchParams.get('status')==='live'?[base]:[]});
  };
  try{
    let previous=null;
    for(const [i,[status,event]] of [['Not started',null],['1st half','kickoff'],['Half time','halftime'],['2nd half','secondhalf'],['Finished','fulltime']].entries()){
      phase=status;calls=[];
      const old=previous?new Map([[previous.id,{match_json:JSON.stringify(previous),updated:now+(i-1)*60000}]]):new Map();
      const result=await collectSportScore(now+i*60000,old,[{preferences}]);
      const current=result.matches.get('ss:city123');assert.ok(current);assert.equal(current.minute,null);
      if(event)assert.ok(transitions(previous,current).includes(event));
      assert.ok(calls.length<=7);previous=current;
    }
    const started=fromSportScore({...fixture,status_text:'1st half'});
    assert.ok(isFreshSportScoreKickoff(started,now+60000,now));
    assert.equal(isFreshSportScoreKickoff(started,now+600000,now+540000),false);
    assert.equal(isFreshSportScoreKickoff({...started,status:'NS'},now+60000,now),false);
  }finally{globalThis.fetch=actual}
});

test('normalize verified provider shape with card, phase, score and stable ID',()=>{
  const match=fromSportScore({...base,incidents:[card]});
  assert.equal(match.league,'sa');assert.equal(match.status,'HT');assert.equal(match.homeScore,1);
  assert.equal(match.id,'ss:pxwrxlhy4w35ryk');assert.equal(match.cards[0].type,'yellow');
  const second=fromSportScore({...base,status_text:'2nd half',live_minute:'46',incidents:[card]});
  assert.deepEqual(transitions(match,second),['secondhalf']);assert.deepEqual(newCards(match,second),[]);
  const message=notificationFor({id:'card',type:'yellow',card:match.cards[0],match},'ar','https://example.org/');assert.equal(message.source,'SportScore');
  assert.match(message.body,/[ء-ي]/u);assert.doesNotMatch(message.body,/[a-z]/i);
});
test('goal incident and exact same-team lineup photo are preserved',()=>{
  const photo='https://img.thesports.com/football/player/p.png';
  const raw={...base,home_score:'2',incidents:[{side:'home',player:'Player One',is_goal:true,home_score:2,away_score:1,time:55}],lineups:{home_xi:[{name:'Player One',photo}],away_xi:[{name:'Player One',photo:'https://img.thesports.com/football/player/wrong.png'}]}};
  const match=fromSportScore(raw);assert.equal(match.goals[0].photo,photo);
  const message=notificationFor({id:'goal',type:'goal-home',match},'ar','https://example.org/');assert.match(message.body,/55′.*\nالمسجل: لاعب الأول/);assert.equal(message.image,photo);
});

test('assist enrichment requires the same team, exact score, minute, scorer and explicit assist',()=>{
  const match={home:'Manchester City',away:'Fulham',homeScore:0,awayScore:1};
  const goal={side:'away',player:'Rodrigo Muniz',minute:16};
  const summary={header:{competitions:[{competitors:[{id:'370',homeAway:'away',team:{displayName:'Fulham'}}]}]},keyEvents:[{scoringPlay:true,team:{id:'370'},clock:{displayValue:"16'"},type:{text:'Goal'},text:'Goal! Manchester City 0, Fulham 1. Rodrigo Muniz (Fulham) shot. Assisted by Oscar Bobb.',participants:[{athlete:{displayName:'Rodrigo Muniz'}},{athlete:{displayName:'Oscar Bobb'}}]}]};
  assert.equal(verifiedAssist(summary,match,goal),'Oscar Bobb');
  assert.equal(verifiedAssist(summary,{...match,awayScore:2},goal),'');
  assert.equal(verifiedAssist(summary,match,{...goal,minute:17}),'');
  assert.equal(verifiedAssist(summary,match,{...goal,player:'Other player'}),'');
  summary.keyEvents[0].text=summary.keyEvents[0].text.replace(' Assisted by Oscar Bobb.','');assert.equal(verifiedAssist(summary,match,goal),'');
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


test('normalize added competitions',()=>{for(const [name,code] of [['Sudanese Premier League','sd'],['Rwandan National League','rw'],['Qatar Stars League','qa'],['CAF Champions League','cafcl'],['UEFA Europa League','el'],['UEFA Nations League','nations'],['UEFA European Championship','euro']])assert.equal(fromSportScore({...base,competition:name}).league,code)});

