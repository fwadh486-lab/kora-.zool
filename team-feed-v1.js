(function(root){
  'use strict';
  const feed=root.KoraMatchFeed;
  const aliases={mancity:'manchestercity',manunited:'manchesterunited',spurs:'tottenhamhotspur',tottenham:'tottenhamhotspur',wolves:'wolverhamptonwanderers',newcastle:'newcastleunited',psg:'parissaintgermain',atleticomadrid:'atleticomadrid',atletico:'atleticomadrid',athleticclub:'athleticbilbao',bayerleverkusen:'bayerleverkusen',leverkusen:'bayerleverkusen',dortmund:'borussiadortmund',inter:'internazionale',intermilan:'internazionale',milan:'milan',realmadrid:'realmadrid','alnassrriyadh':'alnassr','alhilalsaudi':'alhilal',westham:'westhamunited',brighton:'brightonandhovealbion',brightonhovealbion:'brightonandhovealbion',nottingham:'nottinghamforest'};
  const key=name=>{const k=feed.teamKey(name);return aliases[k]||k};
  const sameName=(a,b)=>Boolean(key(a)&&key(a)===key(b));
  const safeCrest=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['crests.football-data.org','img.thesports.com','a.espncdn.com','images.fotmob.com','media.api-sports.io'].includes(u.hostname)?u.href:''}catch{return ''}};
  function sameTeam(team,name,crest){const a=safeCrest(team.crest),b=safeCrest(crest);if(a&&b&&a===b)return true;if(a&&b&&new URL(a).hostname===new URL(b).hostname)return false;return sameName(team.name,name)}
  function sideOf(match,team){const home=sameTeam(team,match.home,match.homeLogo),away=sameTeam(team,match.away,match.awayLogo);return home===away?null:home?'home':'away'}
  function teamMatches(matches,team,now=Date.now()){
    const all=feed.mergeMatches([],matches.filter(m=>sideOf(m,team)&&Number.isFinite(Date.parse(m.date))));
    const past=all.filter(m=>feed.phaseOf(m)==='finished'&&/^\d+\s*[-:]\s*\d+$/.test(m.score)).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
    const next=all.filter(m=>feed.phaseOf(m)==='upcoming'&&Date.parse(m.date)>=now-2*3600000).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
    const live=all.filter(m=>feed.phaseOf(m)==='live'&&Math.abs(Date.parse(m.date)-now)<12*3600000);
    return {all,past,next,live};
  }
  function outcome(m,team){const side=sideOf(m,team),score=String(m.score).match(/^(\d+)\s*[-:]\s*(\d+)$/);if(!side||!score)return null;const gf=Number(score[side==='home'?1:2]),ga=Number(score[side==='home'?2:1]);return {gf,ga,result:gf>ga?'W':gf<ga?'L':'D'}}
  function summarize(matches,team){return matches.reduce((acc,m)=>{const x=outcome(m,team);if(x){acc.played++;acc[x.result]++;acc.gf+=x.gf;acc.ga+=x.ga}return acc},{played:0,W:0,D:0,L:0,gf:0,ga:0})}
  function standings(data,team){const tables=[...Object.entries(data?.leagues||{}),...Object.entries(data?.groups||{}).flatMap(([league,groups])=>groups.map(t=>[league,t.rows,t.group]))].flatMap(([league,rows,group])=>{if(!Array.isArray(rows))return [];const matches=rows.filter(r=>sameTeam(team,r.team,r.crest));return matches.length===1?[{league,group,rows,team:matches[0],updated:data.leagueUpdated?.[league]||data.updated}]:[]});return tables.sort((a,b)=>Number(b.league===team.league)-Number(a.league===team.league))}
  function cachedMatches(storage){let matches=[];for(const k of ['korazol_scores_v2','korazol_result_history_v1','korazol_scores_cache_v1','korazol_upcoming_v1'])try{const data=JSON.parse(storage.getItem(k)||'null'),items=Array.isArray(data)?data:data?.events;if(Array.isArray(items))matches=feed.mergeMatches(matches,items)}catch{}return matches}
  function verifiedRoster(match,team){const side=sideOf(match,team);if(!side)return null;const lineup=match.verifiedLineups?.find(l=>l.side===side&&(!l.team||sameName(l.team,match[side])));if(!lineup?.players?.length)return null;return {lineup,date:match.date,match};}
  root.KoraTeamFeed={key,sameName,sameTeam,sideOf,safeCrest,teamMatches,outcome,summarize,standings,cachedMatches,verifiedRoster};
})(globalThis);
