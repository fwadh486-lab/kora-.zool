(function(root){
'use strict';
const PHASES={live:'🔴 مباشر',finished:'انتهت المباراة',upcoming:'لم تبدأ',other:'حالة خاصة'};
const ICON={goal:'⚽',disallowed:'⊘',red:'🟥',yellow:'🟨',sub:'⇄'};
const names={possession:'الاستحواذ',shots:'التسديدات',shots_on_target:'على المرمى',corners:'الركنيات'};
const acceptedHosts=new Set(['crests.football-data.org','img.thesports.com','a.espncdn.com','images.fotmob.com','media.api-sports.io']);
function tidy(value,max=90){return String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)}
function crest(value){try{const u=new URL(value);return u.protocol==='https:'&&acceptedHosts.has(u.hostname)?u.href:''}catch{return ''}}
function scoreOf(value){const m=tidy(value).match(/^(\d{1,3})\s*[-:]\s*(\d{1,3})$/);return m?[Number(m[1]),Number(m[2])]:null}
function statsOf(match,statKey){
 const raw=Array.isArray(match?.stats)?match.stats:Array.isArray(match?.statistics)?match.statistics:[];
 const rows=new Map();
 for(const v of raw){
   const key=typeof statKey==='function'?statKey(v?.name||v?.type||v?.label):tidy(v?.name||v?.type||v?.label).toLowerCase().replace(/[^a-z0-9]+/g,'_');
   if(!Object.hasOwn(names,key)||rows.has(key))continue;
   const a=v?.home??v?.homeValue??v?.values?.[0],b=v?.away??v?.awayValue??v?.values?.[1];
   if(a==null||b==null)continue;
   const n=Number(String(a).replace('%','')),m=Number(String(b).replace('%',''));
   if(!Number.isFinite(n)||!Number.isFinite(m)||n<0||m<0||n>10000||m>10000||(key==='possession'&&(n>100||m>100)))continue;
   const suffix=key==='possession'?'%':'';
   rows.set(key,{key,label:names[key],home:String(a).includes('%')?String(a):String(n)+suffix,away:String(b).includes('%')?String(b):String(m)+suffix,homeNumber:n,awayNumber:m});
 }
 return [...rows.values()];
}
function starsOf(match){
 const seen=new Set(),list=[];
 for(const line of Array.isArray(match?.verifiedLineups)?match.verifiedLineups:[]){
   const team=tidy(line?.team||match?.[line?.side]||'',60);
   for(const p of Array.isArray(line?.players)?line.players:[]){
     const name=tidy(p?.name,70),rating=Number(p?.rating);
     if(!name||!team||!Number.isFinite(rating)||rating<=0||rating>10)continue;
     const key=team.toLowerCase()+'|'+name.toLowerCase();
     if(seen.has(key))continue;seen.add(key);
     list.push({name,team,rating,number:p?.number??null,player:p});
   }
 }
 return list.sort((a,b)=>b.rating-a.rating||a.name.localeCompare(b.name)).slice(0,3);
}
function model(match,opts={}){
 const phase=typeof opts.phase==='function'?opts.phase(match):match?.phase||'other';
 const score=scoreOf(match?.score);
 const pulse=opts.pulse?.(match,opts.teamMatch)||{events:[],sourceAvailable:false};
 const events=Array.isArray(pulse.events)?pulse.events:[];
 const notable=events.filter(e=>ICON[e.kind]&&e.kind!=='sub');
 const highlights=notable.slice(-4).reverse().map(e=>({
    kind:e.kind,clock:tidy(e.clock,10),team:tidy(match?.[e.side],60),player:tidy(e.player,70),
    label:root.KoraMatchPulse?.labels?.[e.kind]||e.kind,icon:ICON[e.kind]
 }));
 const status=phase==='other'?tidy(match?.status||'حالة خاصة',35):(PHASES[phase]||'حالة المباراة');
 let date='';
 if(Number.isFinite(Date.parse(match?.date)))date=new Date(match.date).toLocaleString('ar-SA-u-ca-gregory',{weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
 const league=tidy(opts.leagueName||match?.competition||match?.league||'كرة القدم',70);
 return {
   home:tidy(match?.home||'الفريق الأول',64),away:tidy(match?.away||'الفريق الثاني',64),score,phase,status,
   homeCrest:crest(match?.homeLogo),awayCrest:crest(match?.awayLogo),date,league,
   updated:tidy(match?.updated||'',40),highlights,stats:statsOf(match,opts.statKey),stars:starsOf(match),
   eventCount:events.length,hasEvents:Boolean(pulse.sourceAvailable),rawScore:score?score.join(' - '):'VS'
 };
}
function setText(ctx,text,x,y,maxWidth,size=40,weight=600,align='center',color='#ffffff'){
 const content=tidy(text,160)||'—';
 ctx.font=weight+' '+size+'px "Cairo",Tahoma,Arial,sans-serif';
 ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';ctx.direction='rtl';
 let value=content;
 while(value.length>1&&ctx.measureText(value).width>maxWidth)value=value.slice(0,-2)+'…';
 ctx.fillText(value,x,y);
}
function round(ctx,x,y,w,h,r,color){
 ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();
}
function image(url,timeout=5500){
 if(!url)return Promise.resolve(null);
 return new Promise(resolve=>{
   const img=new Image();let done=false;
   const settle=value=>{if(done)return;done=true;clearTimeout(timer);img.onload=img.onerror=null;resolve(value)};
   const timer=setTimeout(()=>settle(null),timeout);
   img.crossOrigin='anonymous';img.onload=()=>settle(img);img.onerror=()=>settle(null);img.src=url;
 });
}
function teamAvatar(ctx,img,name,x,y){
 ctx.save();ctx.beginPath();ctx.arc(x,y,70,0,Math.PI*2);ctx.fillStyle='#173c35';ctx.fill();ctx.restore();
 if(img){const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,s=Math.min(118/w,118/h);ctx.drawImage(img,x-w*s/2,y-h*s/2,w*s,h*s)}
 else setText(ctx,tidy(name).slice(0,2),x,y,110,50,800,'center','#b0efcf');
}
async function paint(canvas,match,opts={}){
 const data=model(match,opts);
 canvas.width=1080;canvas.height=1350;
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('canvas_unavailable');
 const [brand,homeLogo,awayLogo]=await Promise.all([
   image(opts.brandUrl||'./kora-zol-icon-192.png'),
   image(data.homeCrest),image(data.awayCrest)
 ]);
 const bg=ctx.createLinearGradient(0,0,1080,1350);bg.addColorStop(0,'#091f20');bg.addColorStop(.55,'#081918');bg.addColorStop(1,'#05120e');ctx.fillStyle=bg;ctx.fillRect(0,0,1080,1350);
 const glow=ctx.createRadialGradient(540,480,50,540,480,650);glow.addColorStop(0,'#1b60442a');glow.addColorStop(1,'#1b604400');ctx.fillStyle=glow;ctx.fillRect(0,100,1080,1050);
 for(let i=0;i<7;i++){ctx.fillStyle='#ffffff08';ctx.fillRect(i*180-200,650,3,450)}
 ctx.fillStyle='#20e39a';ctx.fillRect(0,0,1080,12);
 if(brand){const ratio=Math.min(104/(brand.naturalWidth||brand.width),104/(brand.naturalHeight||brand.height));const w=(brand.naturalWidth||brand.width)*ratio,h=(brand.naturalHeight||brand.height)*ratio;ctx.drawImage(brand,950-w/2,90-h/2,w,h)}
 setText(ctx,'كورة زول',850,83,570,53,900,'right');
 setText(ctx,'KORA ZOL · MATCH CENTER',850,133,570,23,600,'right','#9fc3b6');
 ctx.fillStyle='#ffffff20';ctx.fillRect(70,178,940,2);
 setText(ctx,data.league,540,226,860,36,700,'center','#a7e6c7');
 if(data.date)setText(ctx,data.date,540,280,920,26,500,'center','#b7ccca');
 teamAvatar(ctx,homeLogo,data.home,220,404);teamAvatar(ctx,awayLogo,data.away,860,404);
 setText(ctx,data.home,220,518,380,40,800);
 setText(ctx,data.away,860,518,380,40,800);
 setText(ctx,data.rawScore,540,414,390,data.score?105:81,900,'center','#e9fff1');
 round(ctx,370,560,340,64,32,'#174535');
 setText(ctx,data.status,540,590,304,30,800,'center','#caffdf');
 ctx.fillStyle='#ffffff20';ctx.fillRect(70,650,940,2);
 setText(ctx,'أبرز أحداث المباراة',970,701,885,37,900,'right','#cbffdf');
 if(data.highlights.length){
   for(let i=0;i<4;i++){
     const y=750+i*72,ev=data.highlights[i];
     if(!ev)break;
     round(ctx,70,y,940,60,13,i%2?'#16302c':'#1b3a32');
     setText(ctx,ev.clock,950,y+31,90,26,700,'right','#c7f2de');
     setText(ctx,ev.icon+' '+ev.label,835,y+31,270,24,750,'right');
     setText(ctx,(ev.player?ev.player+' · ':'')+ev.team,535,y+31,410,22,650,'right','#c5ded7');
   }
 }else setText(ctx,'لا توجد أحداث مؤكدة متاحة حالياً',540,842,870,28,500,'center','#9ebcb2');
 ctx.fillStyle='#ffffff20';ctx.fillRect(70,1077,940,2);
 setText(ctx,'أرقام من المباراة',970,1124,840,32,900,'right','#caffdf');
 const line=data.stats.slice(0,2);
 if(line.length){
   for(let i=0;i<line.length;i++){
     const st=line[i],x=i===0?745:285;
     round(ctx,x-219,1153,438,89,13,'#17392f');
     setText(ctx,st.label,x,1176,360,22,600,'center','#b2d6c7');
     setText(ctx,st.home+'   -   '+st.away,x,1214,380,31,800);
   }
 }else setText(ctx,'الإحصائيات غير متوفرة من المصدر',540,1196,850,25,500,'center','#a9c1b7');
 ctx.fillStyle='#ffffff20';ctx.fillRect(70,1271,940,2);
 setText(ctx,'بطاقة من بيانات المباراة المتاحة · كورة زول',540,1310,920,25,650,'center','#9bc8b4');
 return data;
}
async function png(canvas,match,opts={}){
 const data=await paint(canvas,match,opts);
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('png_export_failed')),'image/png'));
 return {blob,data};
}
function safeFilename(match){
 const id=tidy(match?.id||'',100).replace(/[^a-z0-9_-]/gi,'-').slice(0,54)||'match';
 return 'KoraZol-Match-'+id+'.png';
}
root.KoraMatchCenter={model,paint,png,safeFilename};
})(globalThis);
