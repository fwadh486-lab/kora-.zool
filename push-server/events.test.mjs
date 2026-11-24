import test from 'node:test';
import assert from 'node:assert/strict';
import {fromFixture,transitions,newCards,selectedBy,preferenceAllows,notificationFor,displayTeam,arabicScript,verifiedGoalScorer,attachVerifiedScorer} from './events.mjs';
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
  assert.match(notification.body,/بطاقة صفراء/);assert.match(notification.body,/لاعب الثاني/);
});
test('rich match notifications select only the exact scorer, score and safe image',()=>{
  const logo='https://img.thesports.com/football/team/club.png',photo='https://img.thesports.com/football/player/player.png';
  const event={id:'goal',type:'goal-home',match:{...match,homeScore:1,awayScore:0,homeLogo:logo,goals:[{side:'home',homeScore:1,awayScore:0,player:'Nathaniel Brown',minute:37,photo}]}};
  const message=notificationFor(event,'ar','https://example.com/');
  assert.equal(message.title,'بايرن ميونخ - كولن');assert.match(message.body,/37′.*هدف.*1 - 0.*\nالمسجل: ناثانييل براون\nالصانع: غير متاح حالياً/);assert.equal(message.image,photo);
  event.match.goals[0].assist='Player Two';assert.match(notificationFor(event,'ar','https://example.com/').body,/الصانع: لاعب الثاني/);
  assert.match(notificationFor(event,'en','https://example.com/').body,/Scorer: Nathaniel Brown\nAssist: Player Two/);
  event.match.goals[0].homeScore=2;
  const fallback=notificationFor(event,'ar','https://example.com/');assert.doesNotMatch(fallback.body,/Nathaniel/);assert.equal(fallback.image,logo);
  assert.equal(notificationFor(event,'en','https://example.com/').title,'Bayern Munich - FC Köln');
  event.match.id='ss:abc123';event.match.slug='bayern-vs-koln';const link=new URL(notificationFor(event,'ar','https://example.com/app/').url);assert.equal(link.pathname,'/app/match-details.html');assert.equal(link.searchParams.get('slug'),'bayern-vs-koln');assert.equal(link.searchParams.get('sport'),'ss:abc123');
});


test('Arabic match notification localizes well-known teams from top leagues and Sudan',()=>{
  const pairs=[
   ['Real Madrid','ريال مدريد'],['FC Barcelona','برشلونة'],['Man City','مانشستر سيتي'],
   ['Bayern München','بايرن ميونخ'],['Borussia Mönchengladbach','بوروسيا مونشنغلادباخ'],
   ['Al Hilal Omdurman','الهلال السوداني'],['Al-Nassr','النصر'],['AFC Bournemouth','بورنموث'],
   ['Botafogo','بوتافوغو'],['FC Köln','كولن'],['Sudan','السودان'],
   ['Al Ahli Shendi','الأهلي شندي'],['PSV Eindhoven','آيندهوفن'],['Japan','اليابان']
  ];
  for(const [source,expected] of pairs)assert.equal(displayTeam(source,true),expected,source);
  for(const [source] of pairs)assert.equal(displayTeam(source,false),source);
  assert.equal(displayTeam('Real Madrid U21',true),'ريال مدريد تحت 21');
  assert.equal(displayTeam('FC Barcelona Women',true),'برشلونة للسيدات');
});
test('Unknown club names are legibly Arabic-script without changing exact identity in links',()=>{
  const unknown='Southwood Rangers FC';
  const ar=displayTeam(unknown,true);
  assert.match(ar,/[ء-ي]/u);assert.doesNotMatch(ar,/[a-z]/i);
  assert.equal(displayTeam('Al Najma',true),'النجمة');
  assert.equal(arabicScript('Nathaniel Brown'),'ناثانييل براون');
  const alert=notificationFor({id:'next',type:'goal-home',match:{...match,home:unknown,away:'Real Madrid',homeScore:2,awayScore:0}},'ar','https://example.com/app/');
  assert.match(alert.title,/ريال مدريد/);assert.doesNotMatch(alert.title,/[a-z]/i);
  assert.doesNotMatch(alert.body,/[a-z]/i);
  assert.equal(new URL(alert.url).searchParams.get('team'),unknown);
});
test('FCM and browser payload share the same Arabic team and scorer names; English remains unchanged',()=>{
 const event={id:'fixture',type:'goal-away',match:{...match,home:'Real Madrid',away:'FC Barcelona',homeScore:0,awayScore:1,goals:[{side:'away',homeScore:0,awayScore:1,player:'Harry Kane',assist:'Mohamed Salah',minute:56}]}};
 const ar=notificationFor(event,'ar','https://example.com/app/'),en=notificationFor(event,'en','https://example.com/app/');
 assert.equal(ar.title,'ريال مدريد - برشلونة');
 assert.match(ar.body,/المسجل: هاري كين/);
 assert.match(ar.body,/الصانع: محمد صلاح/);
 assert.equal(en.title,'Real Madrid - FC Barcelona');
 assert.match(en.body,/Scorer: Harry Kane/);
 assert.match(en.body,/Assist: Mohamed Salah/);
});

test('delayed verified scorer enriches the original 0-1 alert after score reaches 0-2',()=>{
 const oldMatch={...match,id:'ss:fixture',home:'Bugesera',away:'Rayon Sports FC',homeScore:0,awayScore:1,goals:null};
 const event={id:'ss:fixture:score:0:1:goal-away',type:'goal-away',match:oldMatch};
 const newer={...oldMatch,awayScore:2,goals:[
  {side:'away',player:'Scorer One',minute:35,homeScore:0,awayScore:1},
  {side:'away',player:'Scorer Two',minute:42,homeScore:0,awayScore:2}
 ]};
 assert.equal(verifiedGoalScorer(event),null);
 const merged=attachVerifiedScorer(event,newer);
 assert.equal(verifiedGoalScorer(merged).player,'Scorer One');
 const body=notificationFor(merged,'ar','https://example.com/').body;
 assert.match(body,/المسجل: .*الأول/);
 assert.doesNotMatch(body,/المسجل: .*الثاني/);
 assert.equal(merged.match.awayScore,1);
 assert.equal(event.match.goals,null);
 const next={id:'ss:fixture:score:0:2:goal-away',type:'goal-away',match:{...oldMatch,awayScore:2}};
 assert.equal(verifiedGoalScorer(attachVerifiedScorer(next,newer)).player,'Scorer Two');
});
test('reject cross-match goals, mismatched teams, incomplete score and ambiguous identity',()=>{
 const ev={id:'goal',type:'goal-home',match:{...match,homeScore:1,awayScore:0,goals:null}};
 const base={...match,homeScore:1,awayScore:0,goals:[{side:'home',player:'Player One',homeScore:1,awayScore:0}]};
 for(const fake of [{...base,id:'wrong'},{...base,home:'Another Club'},{...base,homeScore:0},{...base,date:'2026-12-20T10:00:00Z'}])assert.equal(attachVerifiedScorer(ev,fake),ev);
 assert.equal(verifiedGoalScorer(attachVerifiedScorer(ev,{...base,goals:[...base.goals,{...base.goals[0],player:'Player Two'}]})),null);
 assert.equal(verifiedGoalScorer({type:'goal-home',match:{...match,goals:[]}}),null);
});

test('goals without verified scorers state the limitation instead of displaying a guessed name',()=>{const alert=notificationFor({id:'unknown',type:'goal-away',match:{...match,homeScore:0,awayScore:1,goals:null,source:'SportScore'}},'ar','https://example.com/');assert.match(alert.body,/اسم المسجل لم يتأكد من المصدر بعد/);assert.doesNotMatch(alert.body,/المسجل: لاعب/);});

test('score notifications from Bugesera against Rayon Sports use Arabic club names',()=>{const goal={id:'rw-goal',type:'goal-away',match:{id:'ss:rwanda',home:'Bugesera',away:'Rayon Sports FC',status:'1H',homeScore:0,awayScore:2,minute:42,date:'2026-11-24T13:00:00Z',source:'SportScore'}};const message=notificationFor(goal,'ar','https://example.org/');assert.equal(message.title,'بوغيسيرا - رايون سبورتس');assert.match(message.body,/اسم المسجل لم يتأكد/);const en=notificationFor(goal,'en','https://example.org/');assert.equal(en.title,'Bugesera - Rayon Sports FC');});

test('competition-only, team-only, combined and intersection notification filtering',()=>{
 const m={id:'321',home:'Al Hilal',away:'Al Ain',league:'afcelite',date:'2026-11-24T20:00:00Z'};
 const base={types:['goal'],teams:[],matches:[],leagues:[],allLive:false,selectionRule:'any'};
 assert.equal(selectedBy({...base,leagues:['afcelite']},m),true);
 assert.equal(selectedBy({...base,leagues:['cl']},m),false);
 assert.equal(selectedBy({...base,teams:['Al Hilal']},m),true);
 assert.equal(selectedBy({...base,teams:['Al Ahli']},m),false);
 assert.equal(selectedBy({...base,teams:['Al Hilal'],leagues:['cl']},m),true);
 assert.equal(selectedBy({...base,teams:['Al Hilal'],leagues:['cl'],selectionRule:'both'},m),false);
 assert.equal(selectedBy({...base,teams:['Al Hilal'],leagues:['afcelite'],selectionRule:'both'},m),true);
 assert.equal(selectedBy(base,m),false);
 assert.equal(selectedBy({...base,matches:[{id:'321',home:m.home,away:m.away,date:m.date}]},m),true);
 assert.equal(selectedBy({...base,allLive:true},m),true);
});
