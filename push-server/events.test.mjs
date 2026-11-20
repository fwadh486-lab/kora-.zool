import test from 'node:test';
import assert from 'node:assert/strict';
import {fromFixture,transitions,selectedBy,preferenceAllows,notificationFor} from './events.mjs';
const match = {id:'123',home:'Bayern Munich',away:'FC Köln',date:'2026-11-20T19:30:00Z',status:'1H',homeScore:0,awayScore:0,minute:18};
test('no initial or repeated alert; detect kickoff, goal and final',()=>{
  assert.deepEqual(transitions(null,match),[]);
  assert.deepEqual(transitions({...match,status:'NS',homeScore:null,awayScore:null},match),['kickoff']);
  assert.deepEqual(transitions(match,{...match,homeScore:1}),['goal-home']);
  assert.deepEqual(transitions({...match,homeScore:1},{...match,homeScore:1}),[]);
  assert.deepEqual(transitions({...match,homeScore:1},match),[]);
  assert.deepEqual(transitions(match,{...match,status:'FT',awayScore:1}),['goal-away','fulltime']);
});
test('team aliases, exact fixture and conservative favorite matching',()=>{
  assert.equal(selectedBy({teams:['Bayern'],matches:[]},match),true);
  assert.equal(selectedBy({teams:['Arsenal'],matches:[]},match),false);
  assert.equal(selectedBy({teams:[],matches:[{id:'af:123'}]},match),true);
  assert.equal(selectedBy({teams:[],matches:[{id:'de:987',home:'Bayern',away:'Cologne',date:match.date}]},match),true);
  assert.equal(selectedBy({teams:[],matches:[{home:'Bayern',away:'Cologne',date:'2026-11-23T19:30:00Z'}]},match),false);
});
test('preferences and Arabic / English payload',()=>{
  const event={id:'123:2:goal-home',type:'goal-home',match:{...match,homeScore:1}};
  assert.equal(preferenceAllows({teams:['Bayern'],matches:[],types:['goal']},event),true);
  assert.equal(preferenceAllows({teams:['Bayern'],matches:[],types:['fulltime']},event),false);
  const message=notificationFor(event,'ar','https://fwadh486-lab.github.io/kora-.zool/');
  assert.match(message.title,/زوووط/);
  assert.match(message.body,/1 - 0/);
  assert.match(message.url,/team=Bayern\+Munich/);
});
test('real API fixture shape',()=>{
  const fixture=fromFixture({fixture:{id:42,date:match.date,status:{short:'2H',elapsed:77}},teams:{home:{name:'Arsenal'},away:{name:'Chelsea'}},goals:{home:2,away:1},league:{id:39}});
  assert.deepEqual([fixture.id,fixture.league,fixture.homeScore,fixture.awayScore,fixture.minute],['42','en',2,1,77]);
});
