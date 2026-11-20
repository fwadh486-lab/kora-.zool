(function(root){
  'use strict';
  const base='https://korazol-push.fwadh486.workers.dev';
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const key=s=>norm(s).replace(/\b(fc|cf|afc|sc|sfc|rcd|ac|club|football|de|the)\b/g,' ').replace(/\s+/g,' ').trim();
  const aliases={'espanyol de barcelona':'espanyol','espanyol barcelona':'espanyol','athletic bilbao':'athletic','bayern munchen':'bayern munich','koln':'cologne','havre athletic':'le havre','havre':'le havre','al ahli jeddah':'al ahli','al nassr riyadh':'al nassr','sao paulo sp':'sao paulo','fluminense rj':'fluminense'};
  function teamMatch(a,b){const x=key(a),y=key(b);return !!x&&!!y&&(aliases[x]||x)===(aliases[y]||y)}
  async function get(path,params){
    const url=new URL(path,base);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
    const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(18000)});
    if(!r.ok)throw Error('HTTP '+r.status);return r.json();
  }
  async function findFixture(match,id){
    const d=match?.date?new Date(match.date):new Date();
    if(!Number.isFinite(+d))return null;
    const target=match?.sportScoreId||(/^ss:/.test(id||'')?id:null);
    if(target&&match?.slug)return {id:target,slug:match.slug};
    const days=[0,-1,1].map(n=>new Date(+d+n*86400000).toISOString().slice(0,10));
    for(const day of days){
      try{
        const response=await get('/fixtures',{date:day});
        const found=response.matches?.find(m=>target?m.id===target:m.league===match?.league&&teamMatch(m.home,match.home)&&teamMatch(m.away,match.away)&&Math.abs(Date.parse(m.date)-+d)<3*3600000);
        if(found)return found;
      }catch{}
    }
    return null;
  }
  async function loadSportDetail(match,id){
    const found=await findFixture(match,id);
    if(!found)return null;
    const data=await get('/match',{id:found.id,slug:found.slug});
    if(data.id!==found.id)return null;
    return data;
  }
  const photoCache=new Map(),queue=[];let active=0;
  function photo(name,team){
    const k=norm(name)+'|'+norm(team);
    if(photoCache.has(k))return photoCache.get(k);
    const p=new Promise(resolve=>{queue.push(async()=>{try{const d=await get('/player-photo',{name,team});resolve(typeof d.photo==='string'&&d.photo.startsWith('https://')?d.photo:null)}catch{photoCache.delete(k);resolve(null)}});pump()});
    photoCache.set(k,p);return p;
  }
  function pump(){while(active<4&&queue.length){active++;queue.shift()().finally(()=>{active--;pump()})}}
  function statKey(v){const k=norm(v).replace(/ /g,'_');return ({ball_possession:'possession',possession_pct:'possession',shots_on_goal:'shots_on_target',on_goal:'shots_on_target',total_shots:'shots',corner_kicks:'corners',won_corners:'corners'})[k]||k}
  function mergeStats(primary,secondary){
    const items=new Map();for(const r of [...(secondary||[]),...(primary||[])])items.set(statKey(r.name),r);return [...items.values()];
  }
  function role(p){const pos=String(p.position||'').toUpperCase();if(/^(GK|G|GOALKEEPER)$/.test(pos))return 0;if(/^(D|CD|LD|RD|CB|LB|RB|LWB|RWB)/.test(pos))return 1;if(/^(M|CM|DM|AM|LM|RM)/.test(pos))return 2;if(/^(F|ST|CF|LW|RW|A)/.test(pos))return 3;return 2}
  function groups(players,formation){
    const parts=String(formation||'').split(/[-–]/).map(Number).filter(n=>Number.isInteger(n)&&n>0);
    const sorted=[...players].sort((a,b)=>role(a)-role(b));
    if(players.length===11&&parts.reduce((a,b)=>a+b,0)===10&&role(sorted[0])===0){const rows=[];let i=0;for(const count of [1,...parts]){rows.push(sorted.slice(i,i+count));i+=count}return rows}
    return [0,1,2,3].map(r=>sorted.filter(p=>role(p)===r)).filter(r=>r.length);
  }
  root.KoraDetailFeed={teamMatch,loadSportDetail,findFixture,photo,mergeStats,groups,statKey};
})(globalThis);
