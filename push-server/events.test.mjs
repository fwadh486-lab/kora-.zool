import test from 'node:test';
import assert from 'node:assert/strict';
import {fromFixture,transitions,newCards,selectedBy,preferenceAllows,notificationFor} from './events.mjs';
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
  assert.equal(message.title,'بايرن ميونخ - كولن');
  assert.match(message.body,/هدف/);
  assert.match(message.body,/1 - 0/);
  assert.match(message.url,/team=Bayern\+Munich/);
});
test('real API fixture shape',()=>{
  const fixture=fromFixture({fixture:{id:42,date:match.date,status:{short:'2H',elapsed:77}},teams:{home:{name:'Arsenal'},away:{name:'Chelsea'}},goals:{home:2,away:1},league:{id:39}});
  assert.deepEqual([fixture.id,fixture.league,fixture.homeScore,fixture.awayScore,fixture.minute],['42','en',2,1,77]);
});
test('halftime and second-half kickoff, with existing kickoff preference',()=>{
  const halftime={...match,status:'HT'}, second={...match,status:'2H'};
  assert.deepEqual(transitions(match,halftime),['halftime']);
  assert.deepEqual(transitions(halftime,second),['secondhalf']);
  assert.equal(preferenceAllows({teams:['Bayern'],matches:[],types:['kickoff']},{type:'secondhalf',match:second}),true);
  assert.equal(preferenceAllows({teams:[],matches:[],types:['kickoff'],allLive:true},{type:'secondhalf',match:{...second,league:'de'}}),true);
});
test('new card identity ignores time corrections and distinguishes cards for different players',()=>{
  const raw={fixture:{id:42,date:match.date,status:{short:'1H',elapsed:25}},teams:{home:{name:match.home},away:{name:match.away}},goals:{home:0,away:0}};
  const event={type:'Card',detail:'Yellow Card',time:{elapsed:24},team:{id:9,name:match.home},player:{id:8,name:'Player One'}};
  const before=fromFixture({...raw,events:[]}), first=fromFixture({...raw,events:[event]});
  assert.equal(newCards(before,first).length,1);
  assert.deepEqual(newCards(null,first),[]);
  assert.deepEqual(newCards(first,fromFixture({...raw,events:[{...event,time:{elapsed:25}}]})),[]);
  const next=fromFixture({...raw,events:[event,{...event,player:{id:10,name:'Player Two'}}]});
  assert.equal(newCards(first,next).length,1);
  const card=newCards(first,next)[0];
  const notification=notificationFor({id:'card',type:card.type,card,match:next},'ar','https://example.com/');
  assert.match(notification.body,/بطاقة صفراء/);assert.match(notification.body,/Player Two/);
});
test('rich match notifications select only the exact scorer, score and safe image',()=>{
  const logo='https://img.thesports.com/football/team/club.png',photo='https://img.thesports.com/football/player/player.png';
  const event={id:'goal',type:'goal-home',match:{...match,homeScore:1,awayScore:0,homeLogo:logo,goals:[{side:'home',homeScore:1,awayScore:0,player:'Nathaniel Brown',minute:37,photo}]}};
  const message=notificationFor(event,'ar','https://example.com/');
  assert.equal(message.title,'بايرن ميونخ - كولن');assert.match(message.body,/37′.*هدف.*1 - 0.*Nathaniel Brown/);assert.equal(message.image,photo);
  event.match.goals[0].homeScore=2;
  const fallback=notificationFor(event,'ar','https://example.com/');assert.doesNotMatch(fallback.body,/Nathaniel/);assert.equal(fallback.image,logo);
  assert.equal(notificationFor(event,'en','https://example.com/').title,'Bayern Munich - FC Köln');
});
