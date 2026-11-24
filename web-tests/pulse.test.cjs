const {test}=require('node:test'),assert=require('node:assert/strict');
require('../match-feed-v2.js');require('../match-pulse-v1.js');
const x=global.KoraMatchPulse,phase=global.KoraMatchFeed.phaseOf;
const game={home:'Real Madrid',away:'Barcelona',score:'2 - 1',status:'FT',phase:'finished',events:[
 {type:'Goal',side:'home',minute:10,player:'Scorer One',score:'1 - 0'},
 {type:'Yellow card',team:'Barcelona',minute:22,player:'Defender'},
 {type:'Substitution',side:'away',minute:60,playerIn:'New',playerOut:'Old'},
 {type:'Goal',side:'away',minute:'90+3',player:'Scorer Two',score:'1 - 1'},
 {type:'Disallowed Goal',side:'home',minute:'90+5',player:'Scorer Three'},
 {type:'Red card',side:'home',minute:120,player:'Player Four'}]};
test('verified minutes are chronologically ordered and extra time is retained',()=>{
 const a=x.analyze(game);assert.equal(a.endMinute,120);assert.equal(a.events.length,6);
 assert.deepEqual(a.events.map(e=>e.clock),['10′','22′','60′','90+3′','90+5′','120′']);
 assert.deepEqual(a.events.map(e=>e.kind),['goal','yellow','sub','goal','disallowed','red']);
 assert.equal(a.counts.home.goal,1);assert.equal(a.counts.away.goal,1);assert.equal(a.counts.home.disallowed,1);
});
test('ambiguous teams and invalid minutes never create false timeline events',()=>{
 const invalid=[{type:'Goal',team:'Inter',minute:24},{type:'Goal',side:'home',minute:999},{type:'Goal',side:'away',minute:null},
 {type:'Goal kick',side:'home',minute:22},{type:'Goal',side:'home',minute:10,player:'Scorer One',score:'1 - 0'}];
 const a=x.analyze({...game,events:[...game.events,...invalid]});
 assert.equal(a.events.length,6);
 assert.equal(x.analyze({...game,events:[]}).events.length,0);
 assert.equal(x.analyze({...game,events:null}).sourceAvailable,false);
});
test('a disallowed goal is not counted and the summary never claims pressure',()=>{
 const a=x.analyze(game),s=x.story(game,a,phase),share=x.shareText(game,a,phase);
 assert.match(s,/انتهت بفوز Real Madrid 2 - 1/);assert.match(s,/هدف ملغي/);
 assert.match(share,/90\+5′ هدف ملغي/);assert.doesNotMatch(share,/استحواذ|ضغط هجومي/);
 assert.match(x.story({...game,score:'— : —',events:null},x.analyze({...game,events:null}),phase),/غير متاحة/);
});
test('score zero and draw are distinct; no fabricated final scores',()=>{
 const draw={...game,score:'0 - 0'};assert.match(x.story(draw,x.analyze(draw),phase),/بالتعادل 0 - 0/);
 const future={...game,phase:'upcoming',status:'NS',score:'— : —',events:[]};
 assert.match(x.story(future,x.analyze(future),phase),/غير متاحة/);
});
test('deduped events do not accidentally merge different players or cards',()=>{
 const a=x.analyze({...game,events:[{type:'Yellow card',side:'away',minute:20,player:'A'},{type:'Yellow card',side:'away',minute:20,player:'B'},{type:'Yellow card',side:'away',minute:20,player:'A'}]});
 assert.equal(a.events.length,2);
});
