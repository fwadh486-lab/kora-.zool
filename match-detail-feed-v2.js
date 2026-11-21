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
    if(target&&/^ss:[a-z0-9]{1,64}$/i.test(target)&&/^[a-z0-9-]{1,200}$/i.test(match?.slug||''))return {id:target,slug:match.slug};
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
    if(!name||!team)return Promise.resolve(null);
    const k=norm(name)+'|'+norm(team);
    if(photoCache.has(k))return photoCache.get(k);
    const p=new Promise(resolve=>{queue.push(async()=>{try{const d=await get('/player-photo',{name,team});const url=d.source==='SportScore'&&d.teamVerified!==false&&typeof d.photo==='string'&&/^https:\/\/img\.thesports\.com\/football\/player\/[a-z0-9._/%-]+$/i.test(d.photo)?d.photo:null;if(!url)photoCache.delete(k);resolve(url)}catch{photoCache.delete(k);resolve(null)}});pump()});
    photoCache.set(k,p);return p;
  }
  function pump(){while(active<4&&queue.length){active++;queue.shift()().finally(()=>{active--;pump()})}}
  const commonsCache=new Map(),commonsQueue=[];let commonsActive=0;
  async function wikiApi(host,params){const url=new URL('/w/api.php',host);for(const [k,v] of Object.entries({format:'json',origin:'*',...params}))url.searchParams.set(k,v);const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('image source unavailable');return r.json()}
  const claimValues=(entity,key)=>(entity?.claims?.[key]||[]).filter(c=>c.rank!=='deprecated').map(c=>c.mainsnak?.datavalue?.value).filter(Boolean);
  const plainText=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,240);
  async function resolveCommonsPortrait(name){
    const result=await wikiApi('https://www.wikidata.org',{action:'wbsearchentities',search:name,language:'en',limit:5});
    const candidates=(result.search||[]).filter(p=>/^Q\d+$/.test(p.id)&&norm(p.label)===norm(name)&&/footballer|football player|soccer player/i.test(p.description||''));
    if(candidates.length!==1)return null;
    const id=candidates[0].id,data=await wikiApi('https://www.wikidata.org',{action:'wbgetentities',ids:id,props:'claims'}),entity=data.entities?.[id];
    // A unique exact name, human and association-football occupation are
    // required; never use a merely similar image-search result.
    if(!claimValues(entity,'P31').some(x=>x.id==='Q5')||!claimValues(entity,'P106').some(x=>x.id==='Q937857'))return null;
    const file=claimValues(entity,'P18').find(x=>typeof x==='string'&&/\.(jpe?g|png|webp)$/i.test(x));if(!file)return null;
    const info=await wikiApi('https://commons.wikimedia.org',{action:'query',formatversion:'2',titles:'File:'+file,prop:'imageinfo',iiprop:'url|extmetadata|mime',iiurlwidth:'250'});
    const image=info.query?.pages?.[0]?.imageinfo?.[0],meta=image?.extmetadata||{},license=plainText(meta.LicenseShortName?.value),author=plainText(meta.Attribution?.value||meta.Artist?.value);
    const photo=image?.thumburl||image?.url,link=image?.descriptionurl;
    if(!/^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(photo||'')||!/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(link||'')||!(/^(CC BY(?:-SA)? [1-4]\.0|CC0|Public domain)$/i.test(license))||!author)return null;
    return {photo,link,license,author,source:'Wikimedia Commons'};
  }
  function commonsPortrait(name){
    const k=norm(name);if(!k)return Promise.resolve(null);
    if(commonsCache.has(k))return commonsCache.get(k);
    const p=new Promise(resolve=>{commonsQueue.push(async()=>{try{resolve(await resolveCommonsPortrait(name))}catch{commonsCache.delete(k);resolve(null)}});pumpCommons()});commonsCache.set(k,p);return p;
  }
  function pumpCommons(){while(commonsActive<2&&commonsQueue.length){commonsActive++;commonsQueue.shift()().finally(()=>{commonsActive--;pumpCommons()})}}
  function portraitCredit(face,name,record){
    const section=face.closest?.('section')||face.closest?.('.team')||face.closest?.('.player-dialog-sheet');if(!section)return;
    let list=section.querySelector('.portrait-credits');if(!list){list=document.createElement('div');list.className='portrait-credits';list.style.cssText='margin-top:12px;color:inherit;font-size:11px;line-height:1.7;overflow-wrap:anywhere';section.append(list);const title=document.createElement('strong');title.textContent='مصادر الصور المرخصة (Wikimedia Commons): ';list.append(title)}
    if([...list.querySelectorAll('a')].some(a=>a.href===record.link))return;
    const credit=document.createElement('div'),a=document.createElement('a');a.href=record.link;a.target='_blank';a.rel='noopener noreferrer';a.style.color='inherit';a.textContent=name+' — '+record.author+' · '+record.license;credit.append(a);list.append(credit);
  }
  function mountPhoto(face,player,team,fallback){
    // Prefer the current club, but a verified photo from an earlier season is
    // acceptable. Unverified guessed CDN IDs are never used.
    const jersey=typeof player.jerseyPhoto==='string'&&/^https:\/\/stitcher\.espn\.com\/sports\/soccer\/leagues\/[^/]+\/events\/\d+\/athletes\/\d+\/jersey\.png(?:\?.*)?$/.test(player.jerseyPhoto)?player.jerseyPhoto:null;
    function display(url,kind,onError,record){
      if(!url||!face.isConnected)return;
      const img=document.createElement('img');img.alt=kind==='jersey'?'قميص المباراة':player.name||'';
      img.referrerPolicy='no-referrer';img.decoding='async';img.dataset.imageKind=kind;
      img.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;border-radius:50%;';
      img.onload=()=>{if(fallback)fallback.hidden=true;face.dataset.imageKind=kind;face.title=kind==='jersey'?'قميص المباراة — لا تتوفر صورة مؤكدة للاعب':'صورة اللاعب من مزوّد البيانات؛ قد تكون من موسم سابق';if(record)portraitCredit(face,player.name,record)};
      img.onerror=()=>{img.remove();onError?.()};face.append(img);img.src=url;
    }
    const showJersey=()=>{if(jersey)display(jersey,'jersey')};
    const showCommons=()=>{if(!face.isConnected)return;commonsPortrait(player.name).then(record=>{if(record)display(record.photo,'portrait',showJersey,record);else showJersey()})};
    const direct=typeof player.photo==='string'&&/^https:\/\/(?:a\.espncdn\.com\/i\/headshots\/soccer\/players\/|img\.thesports\.com\/football\/player\/)/.test(player.photo)?player.photo:null;
    const showDirect=()=>{if(direct)display(direct,'portrait',showCommons);else showCommons()};
    // Wait for the synchronous renderer to attach the face to the document.
    Promise.resolve().then(()=>{if(face.isConnected)photo(player.name,team).then(url=>{if(url)display(url,'portrait',showDirect);else showDirect()})});
  }
  function statKey(v){const k=norm(v).replace(/ /g,'_');return ({ball_possession:'possession',possession_pct:'possession',shots_on_goal:'shots_on_target',on_goal:'shots_on_target',total_shots:'shots',corner_kicks:'corners',won_corners:'corners',xg:'expected_goals',expected_goals_xg:'expected_goals'})[k]||k}
  function mergeStats(primary,secondary){
    const items=new Map();for(const r of [...(secondary||[]),...(primary||[])])items.set(statKey(r.name),r);return [...items.values()];
  }
  function role(p){const pos=String(p.position||'').toUpperCase().replace(/[^A-Z]/g,'');if(/^(GK|G|GOALKEEPER)$/.test(pos))return 0;if(/^(D|DF|DEF|DEFENDER|CD[LR]?|LD|RD|CB|LCB|RCB|LB|RB|LWB|RWB|LEFTBACK|RIGHTBACK|CENTREBACK|CENTERBACK)$/.test(pos))return 1;if(/^(M|MF|MID|MIDFIELDER|CM[LR]?|DM[LR]?|CDM|DMF|LM|RM|CMF|DEFENSIVEMIDFIELDER)$/.test(pos))return 2;if(/^(AM[LR]?|CAM|AMF|ATTACKINGMIDFIELDER|RCF|SS)$/.test(pos))return 3;if(/^(F|FW|ATT|FORWARD|ST|CF|LW|RW|A|STRIKER|LEFTWINGER|RIGHTWINGER)$/.test(pos))return 4;return 2}
  function flank(p){const pos=String(p.position||'').toUpperCase();if(/^(LB|LWB|LM|LW|LD)$/.test(pos))return -2;if(/^(LCB|CD-L|CM-L|DM-L|AM-L)$/.test(pos))return -1;if(/^(RB|RWB|RM|RW|RD)$/.test(pos))return 2;if(/^(RCB|CD-R|CM-R|DM-R|AM-R)$/.test(pos))return 1;return 0}
  function samePlayer(a,b){const x=norm(a.name),y=norm(b.name);if(x===y&&x)return true;if(!a.number||String(a.number)!==String(b.number))return false;const ax=x.split(' '),by=y.split(' ');return Math.min(ax.length,by.length)>=2&&(ax.every(t=>by.includes(t))||by.every(t=>ax.includes(t)))}
  function mergeLineups(primary,secondary,teams){
    const output=[];
    for(const side of ['home','away']){
      const sameSide=l=>l.side===side||(!l.side&&teams?.[side]&&teamMatch(l.team,teams[side]));
      const a=(primary||[]).find(sameSide),b=(secondary||[]).find(sameSide);
      if(!a&&!b)continue;if(!a||!b){output.push(a||b);continue;}
      const mergePlayers=(items,fallback)=>{
        const first=Array.isArray(items)?items:[],other=Array.isArray(fallback)?fallback:[];
        if(!first.length)return other;
        return first.map(p=>{const same=other.filter(x=>samePlayer(p,x));const match=same.length===1?same[0]:null;if(!match)return p;const tactical=p.formationPlace?p:match.formationPlace?match:p;return {...match,...p,photo:p.photo||match.photo,jerseyPhoto:p.jerseyPhoto||match.jerseyPhoto,position:tactical.position||p.position||match.position,number:p.number??match.number,rating:p.rating??match.rating,formationPlace:tactical.formationPlace,id:p.id||match.id}});
      };
      // Only use independently verified players from the same side; no guessed XI.
      const chosen=a.players?.length>=11||!b.players?.length?a:b,other=chosen===a?b:a;
      const players=mergePlayers(chosen.players,other.players);
      const tactical=other.players?.length===11&&players.length===11&&players.every(p=>p.formationPlace)&&other.players.every(p=>p.formationPlace)?other:chosen;
      output.push({...other,...chosen,side,formation:tactical.formation||chosen.formation||other.formation,coach:chosen.coach||other.coach,players,bench:mergePlayers(chosen.bench,other.bench)});
    }
    return output;
  }
  function groups(players,formation){
    const parts=String(formation||'').split(/[-–]/).map(Number).filter(n=>Number.isInteger(n)&&n>0);
    const sorted=[...players].sort((a,b)=>role(a)-role(b)||flank(a)-flank(b));
    if(players.length===11&&parts.reduce((a,b)=>a+b,0)===10&&sorted.filter(p=>role(p)===0).length===1){const rows=[];let i=0;for(const count of [1,...parts]){rows.push(sorted.slice(i,i+count).sort((a,b)=>flank(a)-flank(b)));i+=count}return rows}
    return [0,1,2,3,4].map(r=>sorted.filter(p=>role(p)===r)).filter(r=>r.length);
  }
  root.KoraDetailFeed={teamMatch,loadSportDetail,findFixture,photo,commonsPortrait,mountPhoto,mergeStats,groups,statKey,mergeLineups};
})(globalThis);

