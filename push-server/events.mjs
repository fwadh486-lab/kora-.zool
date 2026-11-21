const liveStatuses = new Set(['1H','HT','2H','ET','BT','P','LIVE','INT']);
const finalStatuses = new Set(['FT','AET','PEN','AWD','WO']);
const leagueCodes = new Map([[39,'en'],[140,'es'],[78,'de'],[135,'it'],[61,'fr'],[307,'sa'],[2,'cl'],[71,'br'],[88,'nl'],[94,'pt'],[40,'eng2'],[10,'friendly']]);
const aliases = new Map([
  ['bayern','bayernmunich'],['bayernmunchen','bayernmunich'],['manchesterutd','manchesterunited'],
  ['mancity','manchestercity'],['manunited','manchesterunited'],['manutd','manchesterunited'],
  ['athletic','athleticclub'],['athleticbilbao','athleticclub'],['psg','parissaintgermain'],
  ['inter','intermilan'],['internazionale','intermilan'],['newcastle','newcastleunited'],
  ['wolves','wolverhamptonwanderers'],['wolverhampton','wolverhamptonwanderers'],
  ['tottenham','tottenhamhotspur'],['nottingham','nottinghamforest'],
  ['koln','cologne'],['fckoln','cologne'],['1fckoln','cologne'],['1koln','cologne'],
  ['alhilalsaudi','alhilal'],['alnassrsaudi','alnassr']
]);
export function normalizedName(name) {
  const key = String(name || '').normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g,'ا')
    .replace(/\b(?:fc|cf|afc|sc|ac)\b/g,'').replace(/[^\p{L}\p{N}]/gu,'');
  return aliases.get(key) || key;
}
export function fromFixture(raw) {
  const f = raw?.fixture, home = raw?.teams?.home, away = raw?.teams?.away;
  if (!f?.id || !home?.name || !away?.name || !f?.date || !Number.isFinite(Date.parse(f.date))) return null;
  const goals = raw.goals || {}, status = String(f.status?.short || 'NS');
  return {
    id: String(f.id), home: home.name, away: away.name, league: leagueCodes.get(raw.league?.id) || '',
    homeScore: Number.isInteger(goals.home) ? goals.home : null,
    awayScore: Number.isInteger(goals.away) ? goals.away : null,
    status, minute: Number.isInteger(f.status?.elapsed) ? f.status.elapsed : null,
    date: f.date, cards: Array.isArray(raw.events) ? parseCards(raw.events) : null
  };
}
function parseCards(events) {
  const counts = new Map();
  return events.flatMap(event => {
    const type = event?.type === 'Card' && ({'Yellow Card':'yellow','Red Card':'red'})[event.detail];
    if (!type || !event.team?.name || !event.player?.name) return [];
    const identity = JSON.stringify([type,event.team.id || normalizedName(event.team.name),event.player.id || normalizedName(event.player.name)]);
    const count = (counts.get(identity)||0)+1; counts.set(identity,count);
    return [{id:identity+':'+count,type,team:event.team.name,player:event.player.name,
      minute:Number.isInteger(event.time?.elapsed)?event.time.elapsed:null,
      extra:Number.isInteger(event.time?.extra)?event.time.extra:null}];
  });
}
export function selectedBy(preferences, match) {
  if (preferences.allLive && match.league) return true;
  const home = normalizedName(match.home), away = normalizedName(match.away);
  if (preferences.teams.some(team => [home, away].includes(normalizedName(team)))) return true;
  return preferences.matches.some(item => {
    if (item.id === 'af:' + match.id || item.id === 'apif:' + match.id) return true;
    return normalizedName(item.home) === home && normalizedName(item.away) === away &&
      Math.abs(Date.parse(item.date) - Date.parse(match.date)) <= 3 * 3600000;
  });
}
export function transitions(previous, current) {
  if (!previous || !current) return [];
  const result = [], wasLive = liveStatuses.has(previous.status), isLive = liveStatuses.has(current.status);
  const isFinal = finalStatuses.has(current.status), wasFinal = finalStatuses.has(previous.status);
  if (!wasLive && !wasFinal && previous.status === 'NS' && isLive) result.push('kickoff');
  if (['1H','LIVE'].includes(previous.status) && current.status === 'HT') result.push('halftime');
  if (['1H','HT'].includes(previous.status) && current.status === '2H') result.push('secondhalf');
  // A provider's first appearance for a live match is a baseline, not a goal.
  // Score corrections are saved as the new baseline without creating a false goal.
  if ((wasLive || isLive) && (isLive || isFinal) &&
      [previous.homeScore, previous.awayScore, current.homeScore, current.awayScore].every(Number.isInteger)) {
    if (current.homeScore > previous.homeScore && current.awayScore >= previous.awayScore) result.push('goal-home');
    if (current.awayScore > previous.awayScore && current.homeScore >= previous.homeScore) result.push('goal-away');
  }
  if (!wasFinal && isFinal && (wasLive || previous.status === 'NS')) result.push('fulltime');
  return result;
}
export function isFreshSportScoreKickoff(match,now,lastSuccess){
  if(match.status!=='1H'||!Number.isFinite(lastSuccess)||now-lastSuccess<0||now-lastSuccess>180000)return false;
  const elapsed=now-Date.parse(match.date);
  if(!Number.isFinite(elapsed)||elapsed<0)return false;
  return Number.isInteger(match.minute)?match.minute<=3&&elapsed<=600000:elapsed<=180000;
}
export function newCards(previous, current) {
  if (!Array.isArray(previous?.cards) || !Array.isArray(current?.cards)) return [];
  const known = new Set(previous.cards.map(card=>card.id));
  return current.cards.filter(card=>!known.has(card.id));
}
export function preferenceAllows(preferences, event) {
  const key = event.type.startsWith('goal') ? 'goal' : event.type === 'secondhalf' ? 'kickoff' : event.type;
  return preferences.types.includes(key) && selectedBy(preferences, event.match);
}
const arabicTeams=new Map(Object.entries({
  bayernmunich:'بايرن ميونخ',cologne:'كولن',arsenal:'أرسنال',liverpool:'ليفربول',manchestercity:'مانشستر سيتي',manchesterunited:'مانشستر يونايتد',chelsea:'تشيلسي',tottenhamhotspur:'توتنهام',newcastleunited:'نيوكاسل',astonvilla:'أستون فيلا',brightonandhovealbion:'برايتون',fulham:'فولهام',brentford:'برينتفورد',everton:'إيفرتون',nottinghamforest:'نوتنغهام فورست',wolverhamptonwanderers:'وولفرهامبتون',westhamunited:'وست هام',crystalpalace:'كريستال بالاس',realmadrid:'ريال مدريد',barcelona:'برشلونة',atleticomadrid:'أتلتيكو مدريد',athleticclub:'أتلتيك بلباو',espanyol:'إسبانيول',espanyoldebarcelona:'إسبانيول',celta:'سيلتا فيغو',celtavigo:'سيلتا فيغو',sevilla:'إشبيلية',valencia:'فالنسيا',realbetis:'ريال بيتيس',realsociedad:'ريال سوسيداد',villarreal:'فياريال',borussiadortmund:'بوروسيا دورتموند',bayerleverkusen:'باير ليفركوزن',rbleipzig:'لايبزيغ',juventus:'يوفنتوس',intermilan:'إنتر ميلان',milan:'ميلان',napoli:'نابولي',roma:'روما',lazio:'لاتسيو',torino:'تورينو',atalanta:'أتالانتا',parissaintgermain:'باريس سان جيرمان',marseille:'مارسيليا',lyon:'ليون',monaco:'موناكو',troyes:'تروا',havreathleticclub:'لوهافر',lehavre:'لوهافر',alnassr:'النصر',alhilal:'الهلال',alittihad:'الاتحاد',alahli:'الأهلي',alahlishaudi:'الأهلي',alshabab:'الشباب',alettifaq:'الاتفاق',alqadsiah:'القادسية',altaawoun:'التعاون',alhilalomdurman:'الهلال السوداني',almerreikh:'المريخ',sudan:'السودان',spain:'إسبانيا',qatar:'قطر',portugal:'البرتغال',england:'إنجلترا',france:'فرنسا',germany:'ألمانيا',brazil:'البرازيل',argentina:'الأرجنتين',saudiarabia:'السعودية'
}));
export function displayTeam(name,ar){
  if(!ar)return name;
  const age=String(name).match(/\s+U(\d{2})$/i);
  const key=normalizedName(age?name.slice(0,age.index):name).replace(/^(?:rcd|ssc|as)(?=espanyol|napoli|roma)/,'');
  const translated=arabicTeams.get(key);
  return translated?translated+(age?' تحت '+age[1]:''):name;
}
export function notificationImage(value){
  return typeof value==='string'&&value.length<=400&&/^https:\/\/img\.thesports\.com\/football\/(?:player|team)\/[a-z0-9._/%-]+$/i.test(value)?value:'';
}
export function notificationFor(event, language, appUrl) {
  const match=event.match, ar=language!=='en', goal=event.type.startsWith('goal'), card=event.card;
  const home=displayTeam(match.home,ar),away=displayTeam(match.away,ar);
  const side=event.type==='goal-home'?'home':event.type==='goal-away'?'away':card?(normalizedName(card.team)===normalizedName(match.home)?'home':'away'):null;
  // Only use a scorer whose incident is for this exact side and exact score.
  const scorer=goal&&Array.isArray(match.goals)?match.goals.find(g=>g.side===side&&g.homeScore===match.homeScore&&g.awayScore===match.awayScore):null;
  const incident=card||scorer;
  const score=Number.isInteger(match.homeScore)&&Number.isInteger(match.awayScore)?'\u2066'+match.homeScore+' - '+match.awayScore+'\u2069':'';
  const minute=incident?.minute??match.minute;
  const clock=Number.isInteger(minute)&&(goal||card)?minute+(incident?.extra?'+'+incident.extra:'')+'′ ':'';
  const label=goal?(ar?'⚽ هدف!':'⚽ Goal!'):event.type==='kickoff'?(ar?'⚽ بداية المباراة':'⚽ Kickoff'):event.type==='secondhalf'?(ar?'⏱ بداية الشوط الثاني':'⏱ Second half'):event.type==='halftime'?(ar?'⏸ نهاية الشوط الأول':'⏸ Half time'):event.type==='yellow'?(ar?'🟨 بطاقة صفراء':'🟨 Yellow card'):event.type==='red'?(ar?'🟥 بطاقة حمراء':'🟥 Red card'):(ar?'🏁 نهاية المباراة':'🏁 Full time');
  const player=incident?.player||'';
  const actor=player||(goal?(side==='home'?home:away):'');
  const title=home+' - '+away;
  const summary=[clock+label,score,goal?(side==='home'?home:away):actor].filter(Boolean).join(' · ');
  const body=goal&&player?[summary,(ar?'المسجل: ':'Scorer: ')+player,(ar?'الصانع: ':'Assist: ')+(scorer?.assist||(ar?'غير متاح حالياً':'Not available yet'))].join('\n'):summary;
  const image=notificationImage(incident?.photo)||notificationImage(side==='away'?match.awayLogo:match.homeLogo)||notificationImage(match.awayLogo);
  const supportedDetail=String(match.id).startsWith('ss:')&&/^[a-z0-9-]{1,200}$/i.test(match.slug||'');
  const url=supportedDetail?new URL('match-details.html',appUrl):new URL(appUrl);
  if(supportedDetail){url.searchParams.set('id',match.id);url.searchParams.set('sport',match.id);url.searchParams.set('slug',match.slug);if(Number.isFinite(Date.parse(match.date)))url.searchParams.set('date',new Date(match.date).toISOString().slice(0,10))}else url.searchParams.set('team',match.home);
  return {title,body,tag:'korazol-'+event.id,url:url.href,image,source:match.source||''};
}

