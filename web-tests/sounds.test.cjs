const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const raw=path.join(root,'app/src/main/res/raw');
const names=['goal','kickoff','secondhalf','halftime','fulltime','yellow','red','general'];
const src=fs.readFileSync(path.join(root,'app/src/main/java/com/korazol/app/NotificationSounds.java'),'utf8');
test('all eight distinctive event sounds are valid, compact PCM WAV assets',()=>{
 const digests=new Set();
 for(const name of names){
  const buffer=fs.readFileSync(path.join(raw,'korazol_'+name+'.wav'));
  assert.ok(buffer.length>=9000&&buffer.length<=45000,name);
  assert.equal(buffer.toString('ascii',0,4),'RIFF');
  assert.equal(buffer.toString('ascii',8,12),'WAVE');
  assert.equal(buffer.toString('ascii',12,16),'fmt ');
  assert.equal(buffer.readUInt16LE(20),1);
  assert.equal(buffer.readUInt16LE(22),1);
  assert.equal(buffer.readUInt32LE(24),16000);
  assert.equal(buffer.readUInt16LE(34),16);
  assert.equal(buffer.toString('ascii',36,40),'data');
  assert.equal(buffer.readUInt32LE(40),buffer.length-44);
  let peak=0;for(let i=44;i<buffer.length;i+=2)peak=Math.max(peak,Math.abs(buffer.readInt16LE(i)));
  assert.ok(peak>3000&&peak<30000,name+' sound is silent or clipped');
  const digest=require('node:crypto').createHash('sha256').update(buffer).digest('hex');
  assert.ok(!digests.has(digest),name+' sound reused');digests.add(digest);
  assert.ok(src.includes('R.raw.korazol_'+name),name+' is not wired into native app');
 }
});
test('FCM event types route to versioned Android channels without bypassing quiet settings',()=>{
 for(const type of ['goal','kickoff','secondhalf','halftime','fulltime','yellow','red'])assert.match(src,new RegExp('"'+type+'"'));
 assert.match(src,/setSound\(soundUri\(context, TYPES\[i\]\), attrs\)/);
 assert.match(src,/USAGE_NOTIFICATION/);
 assert.match(src,/createNotificationChannels/);
 assert.match(src,/VERSION = "_sound_v1"/);
 assert.doesNotMatch(src,/setBypassDnd\(true\)/);
 const receiver=fs.readFileSync(path.join(root,'app/src/main/java/com/korazol/app/KoraMessagingService.java'),'utf8');
 assert.match(receiver,/NotificationSounds.channelId\(eventType\)/);
 const client=fs.readFileSync(path.join(root,'push-client-v5.js'),'utf8');
 assert.match(client,/preview-sound/);
});
