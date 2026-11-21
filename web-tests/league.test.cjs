const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
require('../match-feed-v2.js');require('../team-feed-v1.js');require('../league-feed-v1.js');
const f=global.KoraLeagueFeed;
const data=require('../data/standings.json');
const snapshots=[require('../data/fixtures.json'),require('../data/sportscore-fixtures.json')];
const all=snapshots.flatMap(s=>s.matches);

test('every existing competition, including English and Spanish, has a unique navigation target',()=>{
  const source=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const options=[...source.matchAll(/<option value="([a-z0-9]+)" data-ar=/g)].map(m=>m[1]).filter(code=>code!=='all');
  for(const code of new Set([...options,...all.map(m=>m.league),...Object.keys(data.leagues),...Object.keys(data.groups)])){
    if(!code)continue;
    assert.ok(f.valid(code),code+' has no competition page');
    assert.equal(new URL(f.url(code),'https://example.com/').searchParams.get('league'),code);
  }
  assert.ok(f.valid('en')&&f.valid('es'));
  assert.equal(f.valid('__proto__'),false);
});
test('competition fixtures, results and teams never leak from another league',()=>{
  for(const code of Object.keys(f.catalog)){
    const matches=f.matches(code,all);
    assert.ok(matches.every(m=>m.league===code));
    const groups=f.tables(data,code);
    const teams=f.teams(data,code,matches);
    for(const t of teams)if(groups.length)assert.ok(groups.some(g=>g.rows.some(r=>r.team===t.name)));
  }
});
test('grouped tournaments retain numbered groups and avoid duplicate teams',()=>{
  const a={team:'Al Merreikh',rank:1,points:10},b={team:'Other club',rank:1,points:8};
  const grouped={groups:{sd:[{group:'Group 1',rows:[a]},{group:'Championship Group',rows:[a,b]}]}};
  assert.deepEqual(f.tables(grouped,'sd').map(t=>t.group),['Group 1','Championship Group']);
  assert.deepEqual(f.teams(grouped,'sd',[]).map(t=>t.name),['Al Merreikh','Other club']);
});
test('results and upcoming fixtures are sorted separately, duplicate fixtures merged',()=>{
  const game={id:'a',league:'en',home:'Arsenal',away:'Chelsea',date:'2026-11-20T13:00:00Z',status:'FT',score:'1 - 0'};
  const next={...game,id:'b',date:'2026-11-23T14:00:00Z',status:'NS',score:'— : —'};
  const matches=f.matches('en',[game,next],[game,{...next,league:'es',id:'c'}]);
  assert.equal(matches.length,2);
  const result=f.partition(matches,Date.parse('2026-11-21T00:00:00Z'));
  assert.deepEqual(result.results.map(m=>m.id),['a']);assert.deepEqual(result.upcoming.map(m=>m.id),['b']);
});
