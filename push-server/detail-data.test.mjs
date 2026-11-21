import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMatchDetails,publicMatchDetails,publicPlayerPhoto} from './sportscore.mjs';
const raw={home:'A',away:'B',home_score:'2',away_score:'1',time:'2026-11-20T17:30:00Z',competition:'English Premier League',url:'/football/match/a-vs-b/abc123/',status:'finished',status_text:'Finished',home_ht_score:1,away_ht_score:1,
incidents:[{side:'away',type:'Goal',player:'Forward',time:14,is_goal:true,home_score:0,away_score:1},{side:'home',type:'Yellow card',player:'Defender',time:23},{side:'home',type:'Substitution',player_in:'New',player_out:'Old',time:78}],
stats:[{label:'Ball Possession',home:49,away:51,suffix:'%'},{label:'Shots on Target',home:7,away:4}],lineups:{confirmed:true,home_formation:'4-3-3',home_xi:[{name:'Goalkeeper',number:1,position:'G',rating:'0.0'}],home_subs:[{name:'Reserve',number:12,position:'D'}],away_xi:[{name:'Forward',number:9,position:'F'}]}};
test('detail maps actual goals, cards, substitutions, statistics and confirmed lineups',()=>{
 const m=normalizeMatchDetails(raw,'2026-11-20T20:00:00Z');
 assert.equal(m.phase,'finished');assert.equal(m.score,'2 - 1');assert.equal(m.events[0].score,'0 - 1');assert.equal(m.events[2].playerOut,'Old');
 assert.equal(m.stats[0].home,'49%');assert.equal(m.verifiedLineups.length,2);assert.equal(m.verifiedLineups[0].players[0].rating,null);assert.equal(m.verifiedLineups[0].bench[0].name,'Reserve');assert.deepEqual(m.halfTime,{home:1,away:1});
 assert.deepEqual(normalizeMatchDetails({...raw,lineups:{...raw.lineups,confirmed:false}}).verifiedLineups,[]);
});
test('a different meeting of the same teams must never be returned',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({match:raw});
 try{await assert.rejects(publicMatchDetails('ss:wrong','a-vs-b'),/fixture_mismatch/);assert.equal((await publicMatchDetails('ss:abc123','a-vs-b')).id,'ss:abc123')}finally{globalThis.fetch=original}
});
test('player photos use exact name and matching team, not a similar name',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>String(url).includes('/search/')?Response.json({players:[{name:'Cristiano Ronaldo',slug:'cristiano-ronaldo'},{name:'Cristiano Ronaldo Junior',slug:'ronaldo-junior'}]}):Response.json({player:{name:'Cristiano Ronaldo',logo:'https://img.thesports.com/football/player/real.png'},stats:{team:'Al Nassr'}});
 try{assert.equal((await publicPlayerPhoto('Cristiano Ronaldo','Al Nassr')).photo,'https://img.thesports.com/football/player/real.png');assert.equal((await publicPlayerPhoto('Cristiano Ronaldo','Other Team')).photo,null)}finally{globalThis.fetch=original}
});
test('duplicate search entries are resolved by the canonical profile, and no unverified or conflicting photo escapes',async()=>{
 const original=globalThis.fetch;let team='Real Madrid',logo='https://img.thesports.com/football/player/verified.png';
 globalThis.fetch=async url=>String(url).includes('/search/')?Response.json({players:[{name:'Example Player',slug:'example-player',logo:'https://img.thesports.com/football/player/old.png'},{name:'Example Player',slug:'example-player',logo:''}]}):Response.json({player:{name:'Example Player',logo},stats:{team}});
 try{const photo=await publicPlayerPhoto('Example Player','Real Madrid');assert.equal(photo.photo,logo);assert.equal(photo.teamVerified,true);assert.equal(photo.kitVerified,false);team='Former Club';assert.equal((await publicPlayerPhoto('Example Player','Real Madrid')).photo,null);team='';assert.equal((await publicPlayerPhoto('Example Player','Real Madrid')).photo,null);team='Real Madrid';logo='';assert.equal((await publicPlayerPhoto('Example Player','Real Madrid')).photo,null)}finally{globalThis.fetch=original}
});
