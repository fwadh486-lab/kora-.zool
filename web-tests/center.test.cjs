const test=require('node:test'),assert=require('node:assert/strict');
require('../match-feed-v2.js');require('../match-pulse-v1.js');require('../match-center-v1.js');
const x=global.KoraMatchCenter,feed=global.KoraMatchFeed,pulse=global.KoraMatchPulse;
const fixture={id:'ss:a-test',home:'FC Bayern Munich',away:'FC Köln',league:'de',competition:'Bundesliga',date:'2026-11-20T19:30:00Z',score:'1 - 1',status:'FT',phase:'finished',events:[
 {side:'home',type:'Goal',minute:37,player:'Harry Kane'},
 {side:'away',type:'Disallowed Goal',minute:70,player:'Player X'},
 {side:'away',type:'Yellow card',minute:80,player:'Player Y'}
],stats:[{name:'possession',home:'62%',away:'38%'},{name:'shots',home:'12',away:'10'}],verifiedLineups:[{team:'FC Bayern Munich',players:[{name:'Harry Kane',rating:8.9,number:9},{name:'Teammate',rating:7.3}]},{team:'FC Köln',players:[{name:'Goalkeeper',rating:7.4}]}]};
const options={phase:feed.phaseOf,pulse:m=>pulse.analyze(m),statKey:x=>x,leagueName:'Bundesliga'};
test('match center model is grounded in score, confirmed events and real stats',()=>{
 const model=x.model(fixture,options);
 assert.equal(model.rawScore,'1 - 1');assert.equal(model.phase,'finished');assert.equal(model.status,'انتهت المباراة');
 assert.equal(model.highlights.length,3);assert.deepEqual(model.highlights.map(v=>v.clock),['80′','70′','37′']);
 assert.equal(model.highlights[1].label,'هدف ملغي');
 assert.deepEqual(model.stats.map(s=>s.home),['62%','12']);
 assert.equal(model.stars[0].name,'Harry Kane');assert.equal(model.stars[0].rating,8.9);
});
test('do not invent a score, player rating or statistics',()=>{
 const unknown=x.model({home:'A',away:'B',date:'bad',score:'— : —',phase:'upcoming',events:[],stats:[{name:'possession',home:'NaN',away:50}],verifiedLineups:[{players:[{name:'A',rating:11}]}]},{phase:feed.phaseOf,pulse:m=>pulse.analyze(m)});
 assert.equal(unknown.rawScore,'VS');assert.deepEqual(unknown.stats,[]);assert.deepEqual(unknown.stars,[]);assert.equal(unknown.date,'');assert.deepEqual(unknown.highlights,[]);
});
test('match center accepts approved crests only and emits safe PNG name',()=>{
 assert.equal(x.model({...fixture,homeLogo:'javascript:alert(1)',awayLogo:'https://evil.tld/crest.png'},options).homeCrest,'');
 assert.equal(x.model({...fixture,awayLogo:'https://evil.tld/crest.png'},options).awayCrest,'');
 assert.equal(x.safeFilename(fixture),'KoraZol-Match-ss-a-test.png');
});
test('reject unverified stat values while preserving zero and percent',()=>{
 const m=x.model({...fixture,stats:[{name:'possession',home:'120%',away:'-20%'},{name:'shots',home:0,away:4},{name:'corners',home:null,away:3}]},options);
 assert.deepEqual(m.stats.map(r=>r.key),['shots']);assert.equal(m.stats[0].home,'0');
});
