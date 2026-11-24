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

/* Match identifiers, matching and deep links always use the provider's original text.
 * Only notification presentation is localized; never invent a different team identity. */
const extendedArabicTeams=new Map(Object.entries({
  bugesera:'بوغيسيرا',rayonsports:'رايون سبورتس',rayonsportsfc:'رايون سبورتس',
  afcbournemouth:'بورنموث',bournemouth:'بورنموث',sunderland:'سندرلاند',leedsunited:'ليدز يونايتد',burnley:'بيرنلي',ipswichtown:'إيبسويتش تاون',leicestercity:'ليستر سيتي',southampton:'ساوثهامبتون',sheffieldunited:'شيفيلد يونايتد',blackburnrovers:'بلاكبيرن روفرز',norwichcity:'نورويتش سيتي',middlesbrough:'ميدلزبره',coventrycity:'كوفنتري سيتي',watford:'واتفورد',stoke:'ستوك سيتي',stirkecity:'ستوك سيتي',derbycounty:'ديربي كاونتي',
  girona:'جيرونا',getafe:'خيتافي',rayo:'رايو فاييكانو',rayovallecano:'رايو فاييكانو',osasuna:'أوساسونا',mallorca:'مايوركا',realsociedad:'ريال سوسيداد',realoviedo:'ريال أوفييدو',alaves:'ألافيس',deportivoalaves:'ألافيس',levante:'ليفانتي',elche:'إلتشي',laspalmas:'لاس بالماس',granada:'غرناطة',valladolid:'بلد الوليد',realvalladolid:'بلد الوليد',cadiz:'قادش',leganes:'ليغانيس',sportinggijon:'سبورتينغ خيخون',
  freiburg:'فرايبورغ',scfreiburg:'فرايبورغ',werderbremen:'فيردر بريمن',stuttgart:'شتوتغارت',vfbStuttgart:'شتوتغارت',eintrachtfrankfurt:'آينتراخت فرانكفورت',frankfurt:'فرانكفورت',wolfsburg:'فولفسبورغ',augsburg:'أوغسبورغ',mainz:'ماينز',mainz05:'ماينز',unionberlin:'يونيون برلين',hoffenheim:'هوفنهايم',heidenheim:'هايدنهايم',hamburger:'هامبورغ',hamburg:'هامبورغ',hamburgersv:'هامبورغ',borussiamonchengladbach:'بوروسيا مونشنغلادباخ',monchengladbach:'مونشنغلادباخ',koln:'كولن',rbLeipzig:'لايبزيغ',
  atalanta:'أتالانتا',bologna:'بولونيا',fiorentina:'فيورنتينا',udinese:'أودينيزي',verona:'هيلاس فيرونا',hellasverona:'هيلاس فيرونا',genoa:'جنوى',cagliari:'كالياري',lecce:'ليتشي',parma:'بارما',pisa:'بيزا',como:'كومو',cremonese:'كريمونيزي',sassuolo:'ساسولو',empoli:'إمبولي',sampdoria:'سامبدوريا',palermo:'باليرمو',frosinone:'فروزينوني',monza:'مونزا',salernitana:'ساليرنيتانا',
  lille:'ليل',lens:'لانس',rennes:'رين',brest:'بريست',nantes:'نانت',strasbourg:'ستراسبورغ',nice:'نيس',auxerre:'أوكسير',angers:'أنجيه',metz:'ميتز',lorient:'لوريان',toulouse:'تولوز',parisfc:'باريس إف سي',reims:'ريمس',montpellier:'مونبلييه',saintetienne:'سانت إتيان',
  alriyadh:'الرياض',alfateh:'الفتح',alfatih:'الفتح',alkhaleej:'الخليج',alfayha:'الفيحاء',alfaiha:'الفيحاء',alhazm:'الحزم',damac:'ضمك',alraed:'الرائد',alweHda:'الوحدة',alwehda:'الوحدة',alokhdood:'الأخدود',alorobah:'العروبة',alnajma:'النجمة',alneom:'نيوم',neom:'نيوم',neomsc:'نيوم',alkholood:'الخلود',alnassrriyadh:'النصر',alhilalriyadh:'الهلال',alittihadjeddah:'الاتحاد',alahliJeddah:'الأهلي',
  alhilalportSudan:'هلال الساحل',alhilalportsudan:'هلال الساحل',almerreikhomdurman:'المريخ',almerreikhalsudan:'المريخ',alahlishendi:'الأهلي شندي',alahlikhartoum:'الأهلي الخرطوم',hayalarab:'حي العرب',hayalarabportsudan:'حي العرب',alamalatbara:'الأمل عطبرة',alhilalalsahil:'هلال الساحل',alhilalobied:'هلال الأبيض',alshortaGedaref:'الشرطة القضارف',
  benfica:'بنفيكا',sportingcp:'سبورتينغ لشبونة',sportinglisbon:'سبورتينغ لشبونة',porto:'بورتو',braga:'سبورتينغ براغا',ajax:'أياكس',psv:'آيندهوفن',psveindhoven:'آيندهوفن',feyenoord:'فينورد',utrecht:'أوتريخت',azalkmaar:'ألكمار',twente:'تفينتي',
  celtic:'سلتيك',rangers:'رينجرز',clubbrugge:'كلوب بروج',anderlecht:'أندرلخت',galatasaray:'غلطة سراي',fenerbahce:'فنربخشة',besiktas:'بشكتاش',olympiacos:'أولمبياكوس',olympiakos:'أولمبياكوس',panathinaikos:'باناثينايكوس',redstarbelgrade:'النجم الأحمر',crvenazvezda:'النجم الأحمر',spartaprague:'سبارتا براغ',slaviaprague:'سلافيا براغ',dinamozagreb:'دينامو زغرب',shakhtardonetsk:'شاختار دونيتسك',dynamokyiv:'دينامو كييف',qarabag:'قره باغ',youngboys:'يونغ بويز',basel:'بازل',fcbasel:'بازل',bodoGlimt:'بودو غليمت',bodoglimt:'بودو غليمت',kairat:'كايرات',
  flamengo:'فلامنغو',fluminense:'فلومينينسي',palmeiras:'بالميراس',corinthians:'كورينثيانز',santos:'سانتوس',saopaulo:'ساو باولو',atleticomineiro:'أتلتيكو مينيرو',vascodagama:'فاسكو دا غاما',botafogo:'بوتافوغو',gremio:'غريميو',internacional:'إنترناسيونال',cruzeiro:'كروزيرو',bahia:'باهيا',fortaleza:'فورتاليزا',ceara:'سيارا',vitoria:'فيتوريا',juventude:'جوفنتودي',bragantino:'براغانتينو',redbullbragantino:'براغانتينو',mirassol:'ميراسول',athleticoparanaense:'أتلتيكو باراناينسي',sportrecife:'سبورت ريسيفي',
  morocco:'المغرب',tunisia:'تونس',algeria:'الجزائر',egypt:'مصر',nigeria:'نيجيريا',senegal:'السنغال',ghana:'غانا',cameroon:'الكاميرون',ivorycoast:'كوت ديفوار',cotedivoire:'كوت ديفوار',ethiopia:'إثيوبيا',rwanda:'رواندا',kenya:'كينيا',uganda:'أوغندا',southafrica:'جنوب أفريقيا',tanzania:'تنزانيا',drcongo:'الكونغو الديمقراطية',
  belgium:'بلجيكا',netherlands:'هولندا',croatia:'كرواتيا',serbia:'صربيا',switzerland:'سويسرا',ukraine:'أوكرانيا',turkiye:'تركيا',turkey:'تركيا',denmark:'الدنمارك',sweden:'السويد',norway:'النرويج',poland:'بولندا',austria:'النمسا',czechia:'التشيك',czechrepublic:'التشيك',scotland:'اسكتلندا',wales:'ويلز',ireland:'أيرلندا',northernireland:'أيرلندا الشمالية',
  japan:'اليابان',southkorea:'كوريا الجنوبية',korearepublic:'كوريا الجنوبية',australia:'أستراليا',iran:'إيران',iraq:'العراق',jordan:'الأردن',oman:'عُمان',kuwait:'الكويت',bahrain:'البحرين',unitedarabemirates:'الإمارات',uae:'الإمارات',palestine:'فلسطين',lebanon:'لبنان',syria:'سوريا',uzbekistan:'أوزبكستان',china:'الصين',indonesia:'إندونيسيا',mexico:'المكسيك',unitedstates:'الولايات المتحدة',usa:'الولايات المتحدة',canada:'كندا',colombia:'كولومبيا',chile:'تشيلي',uruguay:'أوروغواي',paraguay:'باراغواي',ecuador:'الإكوادور',peru:'بيرو',venezuela:'فنزويلا'
}));
const arabicWords=new Map(Object.entries({
  fc:'إف سي',cf:'سي إف',afc:'إيه إف سي',sc:'إس سي',ac:'إيه سي',as:'إيه إس',sv:'إس في',
  al:'ال',el:'إل',real:'ريال',club:'كلوب',football:'فوتبول',sporting:'سبورتينغ',athletic:'أتلتيك',
  city:'سيتي',united:'يونايتد',town:'تاون',rovers:'روفرز',county:'كاونتي',
  manchester:'مانشستر',bayern:'بايرن',munich:'ميونخ',muenchen:'ميونخ',madrid:'مدريد',barcelona:'برشلونة',paris:'باريس',saint:'سانت',st:'سانت',
  inter:'إنتر',milan:'ميلان',borussia:'بوروسيا',nottingham:'نوتنغهام',forest:'فورست',
  west:'وست',east:'إيست',north:'نورث',south:'ساوث',new:'نيو',castle:'كاسل',
  red:'ريد',blue:'بلو',white:'وايت',black:'بلاك',star:'ستار',stars:'ستارز',racing:'راسينغ',
  olympique:'أولمبيك',olympic:'أولمبيك',de:'دي',da:'دا',do:'دو',del:'ديل',la:'لا',las:'لاس',los:'لوس',
  river:'ريفر',plate:'بليت',young:'يونغ',boys:'بويز',sport:'سبورت',national:'ناسيونال',
  women:'السيدات',ladies:'السيدات',femenino:'السيدات',femeni:'السيدات',reserves:'الرديف',
  harry:'هاري',kane:'كين',brown:'براون',nathaniel:'ناثانييل',mohamed:'محمد',mohammed:'محمد',salah:'صلاح',
  cristiano:'كريستيانو',ronaldo:'رونالدو',vinicius:'فينيسيوس',junior:'جونيور',mbappe:'مبابي',
  player:'لاعب',one:'الأول',two:'الثاني'
}));
const latinLetterArabic={a:'ا',b:'ب',c:'ك',d:'د',e:'ي',f:'ف',g:'غ',h:'ه',i:'ي',j:'ج',k:'ك',l:'ل',m:'م',n:'ن',o:'و',p:'ب',q:'ق',r:'ر',s:'س',t:'ت',u:'و',v:'ف',w:'و',x:'كس',y:'ي',z:'ز'};
const latinClusters=[['sch','ش'],['tch','تش'],['sh','ش'],['ch','تش'],['th','ث'],['ph','ف'],['gh','غ'],['kh','خ'],['ck','ك'],['qu','كو'],['ou','و'],['oo','و'],['ee','ي'],['ea','ي'],['ei','اي'],['ai','اي'],['au','او'],['ay','اي'],['ey','اي'],['ie','ي'],['ts','تس'],['tz','تس'],['ng','نغ']];
function latinWordToArabic(value){
 const raw=value.toLowerCase();
 if(arabicWords.has(raw))return arabicWords.get(raw);
 let result='';
 for(let i=0;i<raw.length;){
   const pair=latinClusters.find(([cluster])=>raw.startsWith(cluster,i));
   if(pair){result+=pair[1];i+=pair[0].length;continue}
   result+=latinLetterArabic[raw[i]]||raw[i];i++;
 }
 return result.replace(/([ابتثجحخدذرزسشصضطظعغفقكلمنهوي])\1/g,'$1');
}
/* This fallback is a readable Arabic-script transliteration, not an official club
 * name translation. Known club names always take priority above. */
export function arabicScript(value){
 const text=String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
 .replace(/[øØ]/g,'o').replace(/[æÆ]/g,'ae').replace(/[ß]/g,'ss').replace(/[ıİ]/g,'i').replace(/[łŁ]/g,'l');
 return text.replace(/[a-z]+/gi,token=>latinWordToArabic(token)).replace(/\s{2,}/g,' ').trim();
}

export function displayTeam(name,ar){
  if(!ar)return name;
  const original=String(name||'').trim();
  const suffix=original.match(/\s+U-?(\d{2})$/i);
  const female=original.match(/\s+(?:women|ladies|femenino|femeni)$/i);
  const base=suffix?original.slice(0,suffix.index):female?original.slice(0,female.index):original;
  const key=normalizedName(base).replace(/^(?:rcd|ssc|as)(?=espanyol|napoli|roma)/,'');
  const translated=arabicTeams.get(key)||extendedArabicTeams.get(key)||arabicScript(base);
  return translated+(suffix?' تحت '+suffix[1]:'')+(female?' للسيدات':'');
}

/* Find a scorer by the exact goal score and side, never by the latest
 * scoreboard alone. An event at 0-1 must not inherit the 0-2 scorer. */
export function verifiedGoalScorer(event) {
  const match=event?.match,side=event?.type==='goal-home'?'home':event?.type==='goal-away'?'away':null;
  if(!side||!match||!Number.isInteger(match.homeScore)||!Number.isInteger(match.awayScore))return null;
  const choices=(Array.isArray(match.goals)?match.goals:[]).filter(g=>g&&g.side===side&&Number(g.homeScore)===match.homeScore&&Number(g.awayScore)===match.awayScore&&typeof g.player==='string'&&g.player.trim());
  const players=new Set(choices.map(g=>normalizedName(g.player)));
  return players.size===1&&choices.length===1?choices[0]:null;
}
export function attachVerifiedScorer(event,latest) {
  if(!event?.type?.startsWith('goal')||!event.match||!latest||String(latest.id)!==String(event.match.id))return event;
  if(normalizedName(event.match.home)!==normalizedName(latest.home)||normalizedName(event.match.away)!==normalizedName(latest.away))return event;
  if(Number.isFinite(Date.parse(event.match.date))&&Number.isFinite(Date.parse(latest.date))&&Math.abs(Date.parse(event.match.date)-Date.parse(latest.date))>15*60000)return event;
  if(!Number.isInteger(latest.homeScore)||!Number.isInteger(latest.awayScore)||latest.homeScore<event.match.homeScore||latest.awayScore<event.match.awayScore)return event;
  if(verifiedGoalScorer(event))return event;
  const enriched={...event,match:{...event.match,goals:Array.isArray(latest.goals)?latest.goals:[]}};
  return verifiedGoalScorer(enriched)?enriched:event;
}

export function notificationImage(value){
  return typeof value==='string'&&value.length<=400&&/^https:\/\/img\.thesports\.com\/football\/(?:player|team)\/[a-z0-9._/%-]+$/i.test(value)?value:'';
}
export function notificationFor(event, language, appUrl) {
  const match=event.match, ar=language!=='en', goal=event.type.startsWith('goal'), card=event.card;
  const home=displayTeam(match.home,ar),away=displayTeam(match.away,ar);
  const side=event.type==='goal-home'?'home':event.type==='goal-away'?'away':card?(normalizedName(card.team)===normalizedName(match.home)?'home':'away'):null;
  // Only use a scorer whose incident is for this exact side and exact score.
  const scorer=goal?verifiedGoalScorer(event):null;
  const incident=card||scorer;
  const score=Number.isInteger(match.homeScore)&&Number.isInteger(match.awayScore)?'\u2066'+match.homeScore+' - '+match.awayScore+'\u2069':'';
  const minute=incident?.minute??match.minute;
  const clock=Number.isInteger(minute)&&(goal||card)?minute+(incident?.extra?'+'+incident.extra:'')+'′ ':'';
  const label=goal?(ar?'⚽ هدف!':'⚽ Goal!'):event.type==='kickoff'?(ar?'⚽ بداية المباراة':'⚽ Kickoff'):event.type==='secondhalf'?(ar?'⏱ بداية الشوط الثاني':'⏱ Second half'):event.type==='halftime'?(ar?'⏸ نهاية الشوط الأول':'⏸ Half time'):event.type==='yellow'?(ar?'🟨 بطاقة صفراء':'🟨 Yellow card'):event.type==='red'?(ar?'🟥 بطاقة حمراء':'🟥 Red card'):(ar?'🏁 نهاية المباراة':'🏁 Full time');
  const player=ar?arabicScript(incident?.player||''):(incident?.player||'');
  const actor=player||(goal?(side==='home'?home:away):'');
  const title=home+' - '+away;
  const summary=[clock+label,score,goal?(side==='home'?home:away):actor].filter(Boolean).join(' · ');
  const body=goal?(player?[summary,(ar?'المسجل: ':'Scorer: ')+player,(ar?'الصانع: ':'Assist: ')+(scorer?.assist?(ar?arabicScript(scorer.assist):scorer.assist):(ar?'غير متاح حالياً':'Not available yet'))].join('\n'):[summary,ar?'اسم المسجل لم يتأكد من المصدر بعد':'Scorer not confirmed by provider yet'].join('\n')):summary;
  const image=notificationImage(incident?.photo)||notificationImage(side==='away'?match.awayLogo:match.homeLogo)||notificationImage(match.awayLogo);
  const supportedDetail=String(match.id).startsWith('ss:')&&/^[a-z0-9-]{1,200}$/i.test(match.slug||'');
  const url=supportedDetail?new URL('match-details.html',appUrl):new URL(appUrl);
  if(supportedDetail){url.searchParams.set('id',match.id);url.searchParams.set('sport',match.id);url.searchParams.set('slug',match.slug);if(Number.isFinite(Date.parse(match.date)))url.searchParams.set('date',new Date(match.date).toISOString().slice(0,10))}else url.searchParams.set('team',match.home);
  return {title,body,tag:'korazol-'+event.id,url:url.href,image,source:match.source||''};
}

