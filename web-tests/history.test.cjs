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
test('real provider aliases do not create duplicate results or remove distinct fixtures',()=>{
  const pairs=[['Bayern','1. FC Köln','FC Bayern Munich','FC Köln','de'],['Troyes','Le Havre','Troyes','Havre Athletic Club','fr'],['Vitória','Bragantino','Vitória - BA','Red Bull Bragantino','br'],['Vasco da Gama','Internacional','Vasco da Gama Saf - RJ','Internacional - RS','br'],['São Paulo','Fluminense','São Paulo - SP','Fluminense - RJ','br'],['Corinthians','Botafogo','Corinthians - SP','Botafogo - RJ','br'],['Grêmio','Bahia','Grêmio - RS','Bahia - BA','br']];
  const fixtures=pairs.flatMap(([h,a,x,y,league],i)=>[{...old,id:league+':'+i,home:h,away:a,league},{...old,id:'ss:alias'+i,home:x,away:y,league}]);
  const results=feed.completedResults(fixtures,feed.resultDays(now,3));
  assert.equal(results.length,pairs.length);assert.ok(results.every(m=>m.sportScoreId));
  assert.equal(feed.completedResults([...fixtures,{...fixtures[0],id:'de:later',date:'2026-11-19T19:30:00Z'}],feed.resultDays(now,3)).length,pairs.length+1);
});
test('verified lineups merge separately by team, preserving 11 players and enriching only exact identities',()=>{
  const lineup=Array.from({length:11},(_,i)=>({name:'Player '+i,number:i+1,position:i===0?'GK':i<5?'D':i<9?'DM':'F'}));
  const main=[{side:'home',team:'Bayern Munich',players:lineup,bench:[]}];
  const secondary=[{side:'home',team:'Bayern Munich',formation:'4-4-2',players:[{name:'Player 1',id:123,photo:'https://example.com/real.png'},{name:'Player 10 Junior',photo:'https://example.com/wrong.png'}],bench:[{name:'Sub'}]},{side:'away',team:'FC Köln',players:[{name:'Away player'}]}];
  const merged=detail.mergeLineups(main,secondary);assert.equal(merged.length,2);assert.equal(merged[0].players.length,11);assert.equal(merged[0].players[1].photo,'https://example.com/real.png');assert.equal(merged[0].players[10].photo,undefined);assert.equal(merged[0].bench[0].name,'Sub');assert.deepEqual(detail.groups(merged[0].players,merged[0].formation).map(x=>x.length),[1,4,4,2]);
});
test('verified tactical data replaces broad positions and puts each player into the correct formation row',()=>{
 const names=['Jonas Urbig','Jonathan Tah','Dayot Upamecano','Josip Stanišić','Konrad Laimer','Lennart Karl','Aleksandar Pavlović','Joshua Kimmich','Harry Kane','Nathaniel Brown','Michael Olise'];
 const pos=['G','CD-L','CD-R','LB','RB','AM','LM','RM','F','AM-L','AM-R'];
 const primary=names.map((name,i)=>({name,number:i+1,position:i===0?'G':i<5?'D':i===8?'F':'M'}));
 const secondary=names.map((name,i)=>({name:name.normalize('NFD').replace(/[\u0300-\u036f]/g,''),number:String(i+1),position:pos[i],formationPlace:String(i+1)}));
 const merged=detail.mergeLineups([{side:'home',players:primary}],[{side:'home',players:secondary,formation:'4-2-3-1'}])[0];
 assert.equal(merged.formation,'4-2-3-1');
 assert.deepEqual(detail.groups(merged.players,merged.formation).map(row=>row.map(p=>p.position)),[['G'],['LB','CD-L','CD-R','RB'],['LM','RM'],['AM-L','AM','AM-R'],['F']]);
});
test('portrait renderer verifies name and team, displays the real resource, and uses match jersey if unavailable',async()=>{
 const originalFetch=global.fetch,originalDocument=global.document;
 const portrait='https://img.thesports.com/football/player/player.png',jersey='https://stitcher.espn.com/sports/soccer/leagues/esp.1/events/42/athletes/9/jersey.png?darkMode=false';
 const calls=[];global.fetch=async url=>{const u=new URL(url);if(u.hostname==='www.wikidata.org')return{ok:true,json:async()=>({search:[]})};calls.push([u.searchParams.get('name'),u.searchParams.get('team')]);return{ok:true,json:async()=>u.searchParams.get('name')==='Confirmed Player'?{source:'SportScore',photo:portrait,teamVerified:true}:{photo:null}}};
 global.document={createElement(){return{style:{},dataset:{},set src(value){this.url=value;queueMicrotask(()=>this.onload())},remove(){}}}};
 const face=()=>({isConnected:true,dataset:{},children:[],append(img){this.children.push(img)}});
 try{const first=face(),second=face(),f1={hidden:false},f2={hidden:false};detail.mountPhoto(first,{name:'Confirmed Player',photo:'https://old-club.invalid/old.png',jerseyPhoto:jersey},'Current Club',f1);detail.mountPhoto(second,{name:'No Photo',jerseyPhoto:jersey},'Current Club',f2);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[['Confirmed Player','Current Club'],['No Photo','Current Club']]);assert.equal(first.children[0].url,portrait);assert.equal(second.children[0].url,jersey);assert.equal(first.dataset.imageKind,'portrait');assert.equal(second.dataset.imageKind,'jersey');assert.equal(f1.hidden,true);assert.equal(f2.hidden,true)}finally{global.fetch=originalFetch;global.document=originalDocument}
});
test('Commons fallback requires exact footballer identity and a reusable attributed photo',async()=>{
 const original=global.fetch,claim=value=>({mainsnak:{datavalue:{value}}});
 global.fetch=async url=>{const u=new URL(url),action=u.searchParams.get('action');let body={};if(action==='wbsearchentities'){const name=u.searchParams.get('search');body={search:[{id:'Q123',label:name,description:'German footballer'},...(name==='Ambiguous Name'?[{id:'Q456',label:name,description:'Brazilian footballer'}]:[])]}}else if(action==='wbgetentities')body={entities:{Q123:{claims:{P31:[claim({id:'Q5'})],P106:[claim({id:'Q937857'})],P18:[claim('Player.jpg')]}}}};else body={query:{pages:[{imageinfo:[{thumburl:'https://thumb.wikimedia.org/wikipedia/commons/thumb/Player.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Player.jpg',extmetadata:{LicenseShortName:{value:'CC BY-SA 4.0'},Artist:{value:'<a>Photo Author</a>'}}}]}]}};return{ok:true,json:async()=>body}};
 try{const result=await detail.commonsPortrait('Example Footballer');assert.equal(result.author,'Photo Author');assert.equal(result.license,'CC BY-SA 4.0');assert.equal(result.source,'Wikimedia Commons');assert.equal(await detail.commonsPortrait('Ambiguous Name'),null)}finally{global.fetch=original}
});
