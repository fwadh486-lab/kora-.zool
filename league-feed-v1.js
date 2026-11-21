(function(root){
  'use strict';
  const matchFeed=root.KoraMatchFeed;
  const catalog={
    en:['الدوري الإنجليزي الممتاز','Premier League','🏴','إنجلترا','England'],
    es:['الدوري الإسباني','La Liga','🇪🇸','إسبانيا','Spain'],
    sa:['الدوري السعودي','Saudi Pro League','🇸🇦','السعودية','Saudi Arabia'],
    sd:['الدوري السوداني','Sudanese Premier League','🇸🇩','السودان','Sudan'],
    rw:['الدوري الرواندي','Rwandan National League','🇷🇼','رواندا','Rwanda'],
    qa:['الدوري القطري','Qatar Stars League','🇶🇦','قطر','Qatar'],
    de:['الدوري الألماني','Bundesliga','🇩🇪','ألمانيا','Germany'],
    it:['الدوري الإيطالي','Serie A','🇮🇹','إيطاليا','Italy'],
    fr:['الدوري الفرنسي','Ligue 1','🇫🇷','فرنسا','France'],
    cl:['دوري أبطال أوروبا','UEFA Champions League','🏆','أوروبا','Europe'],
    el:['الدوري الأوروبي','UEFA Europa League','🏆','أوروبا','Europe'],
    cafcl:['دوري أبطال أفريقيا','CAF Champions League','🏆','أفريقيا','Africa'],
    euro:['كأس أمم أوروبا','UEFA European Championship','🇪🇺','أوروبا','Europe'],
    nations:['دوري الأمم الأوروبية','UEFA Nations League','🇪🇺','أوروبا','Europe'],
    br:['الدوري البرازيلي','Brazilian Série A','🇧🇷','البرازيل','Brazil'],
    nl:['الدوري الهولندي','Eredivisie','🇳🇱','هولندا','Netherlands'],
    pt:['الدوري البرتغالي','Primeira Liga','🇵🇹','البرتغال','Portugal'],
    eng2:['تشامبيونشيب الإنجليزي','English Championship','🏴','إنجلترا','England'],
    friendly:['وديات المنتخبات','International Friendlies','🌍','دولي','International'],
    clubfriendly:['وديات الأندية','Club Friendlies','🤝','دولي','International'],
    nonfifa:['وديات أخرى','Other Friendlies','⚽','دولي','International']
  };
  const valid=code=>Object.hasOwn(catalog,code);
  const url=code=>valid(code)?'./league-details.html?league='+encodeURIComponent(code):'./index.html';
  function tables(data,code){
    const groups=data?.groups?.[code];
    if(Array.isArray(groups))return groups.filter(t=>Array.isArray(t?.rows)&&t.rows.length);
    const rows=data?.leagues?.[code];
    return Array.isArray(rows)&&rows.length?[{group:'',rows}]:[];
  }
  function matches(code,...lists){
    return matchFeed.mergeMatches([],lists.flat().filter(m=>m?.league===code&&Number.isFinite(Date.parse(m.date))&&m.home&&m.away));
  }
  function partition(items,now=Date.now()){
    const sorted=[...items].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
    return {live:sorted.filter(m=>matchFeed.phaseOf(m)==='live'&&Math.abs(now-Date.parse(m.date))<12*3600000),
      upcoming:sorted.filter(m=>matchFeed.phaseOf(m)==='upcoming'&&Date.parse(m.date)>=now-2*3600000),
      results:sorted.filter(m=>matchFeed.phaseOf(m)==='finished').reverse(),
      other:sorted.filter(m=>matchFeed.phaseOf(m)==='other')};
  }
  function teams(data,code,items){
    const result=[];
    const add=(name,crest)=>{
      if(!name||name==='—')return;
      const safe=root.KoraTeamFeed?.safeCrest(crest)||'';
      const match=result.find(t=>root.KoraTeamFeed?root.KoraTeamFeed.sameTeam(t,name,safe):matchFeed.teamKey(t.name)===matchFeed.teamKey(name));
      if(match){if(!match.crest&&safe)match.crest=safe;return}
      result.push({name,crest:safe});
    };
    const groups=tables(data,code);
    for(const table of groups)for(const row of table.rows)add(row.team,row.crest);
    // The published table determines membership; only supplement when no table exists.
    if(!result.length)for(const m of items)for(const side of ['home','away'])add(m[side],m[side+'Logo']);
    return result.sort((a,b)=>a.name.localeCompare(b.name));
  }
  root.KoraLeagueFeed={catalog,valid,url,tables,matches,partition,teams};
})(globalThis);
