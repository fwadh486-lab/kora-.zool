import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createECDH,randomBytes,randomUUID} from 'node:crypto';
import worker from './worker.mjs';

function makeDb(){
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const wrap=(sql,args=[])=>({
    bind:(...values)=>wrap(sql,values),
    first:async()=>db.prepare(sql).get(...args)||null,
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:db.prepare(sql).run(...args)})
  });
  return {prepare:sql=>wrap(sql),batch:async stmts=>{db.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}}};
}
test('dashboard-only Worker creates one stable signing key without exposing its private key',async()=>{
  const env={DB:makeDb()};
  const config=()=>worker.fetch(new Request('https://push.example.org/config',{headers:{origin:'https://fwadh486-lab.github.io'}}),env);
  const results=await Promise.all([config(),config()]);
  const [a,b]=await Promise.all(results.map(r=>r.json()));
  assert.equal(a.enabled,true);assert.equal(a.publicKey.length,87);assert.equal(a.publicKey,b.publicKey);
  assert.deepEqual(Object.keys(a).sort(),['enabled','liveEnabled','publicKey']);
  const row=await env.DB.prepare('SELECT public_key,private_key FROM push_keys WHERE id=1').first();
  assert.equal(row.public_key,a.publicKey);assert.equal(row.private_key.length,43);
  assert.notEqual(row.private_key,a.publicKey);
});
test('register, authorized test, delayed encrypted push, live events and opt-out',async()=>{
  const vapid=createECDH('prime256v1');vapid.generateKeys();
  const device=createECDH('prime256v1');device.generateKeys();
  const env={DB:makeDb(),APP_ORIGIN:'https://fwadh486-lab.github.io',APP_URL:'https://fwadh486-lab.github.io/kora-.zool/',VAPID_SUBJECT:'mailto:admin@example.org',VAPID_PUBLIC_KEY:vapid.getPublicKey().toString('base64url'),VAPID_PRIVATE_KEY:vapid.getPrivateKey().toString('base64url')};
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-device',expirationTime:null,keys:{p256dh:device.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
  const token=randomUUID()+randomUUID(),payload={token,subscription,preferences:{teams:['Bayern'],matches:[],types:['kickoff','goal','fulltime','yellow','halftime'],language:'ar'}};
  const request=async(path,data,origin=env.APP_ORIGIN)=>worker.fetch(new Request('https://push.example.org'+path,{method:data?'POST':'GET',headers:{origin,'content-type':'application/json'},body:data?JSON.stringify(data):undefined}),env);
  const config=await request('/config');assert.equal(config.status,200);assert.equal((await config.json()).enabled,true);
  assert.equal((await request('/config',null,'https://bad.example')).status,403);
  assert.equal((await request('/subscribe',{...payload,subscription:{...subscription,endpoint:'https://127.0.0.1/'}})).status,400);
  assert.equal((await request('/subscribe',payload)).status,200);
  assert.equal((await request('/subscribe',{...payload,token:randomUUID()+randomUUID()})).status,409);
  assert.equal((await request('/test',payload)).status,202);
  assert.equal((await request('/test',payload)).status,429);
  assert.equal((await (await request('/test-status',payload)).json()).state,'pending');
  assert.equal((await request('/test-status',{...payload,token:randomUUID()+randomUUID()})).status,409);
  const sends=[];let fixtureStatus='NS',score=0,cards=[];
  const realFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith('https://fcm.googleapis.com/')){
      assert.equal(options.redirect,'manual','Cloudflare Workers must not use unsupported redirect error mode or follow redirects');
      sends.push({headers:new Headers(options.headers),length:options.body.byteLength});
      return new Response(null,{status:201});
    }
    if(String(url).startsWith('https://v3.football.api-sports.io/')){
      assert.equal(options.headers['x-apisports-key'],'test-only-key');
      return Response.json({errors:[],response:[{fixture:{id:123,date:new Date().toISOString(),status:{short:fixtureStatus,elapsed:fixtureStatus==='FT'?90:15}},teams:{home:{name:'Bayern Munich'},away:{name:'FC Köln'}},goals:{home:score,away:0},league:{id:78},...(new URL(url).searchParams.has('live')?{events:cards}:{})}]});
    }
    throw Error('Unexpected outbound request');
  };
  async function tick(now){let pending;worker.scheduled({scheduledTime:now},env,{waitUntil:p=>{pending=p}});await pending}
  try{
    const now=Date.now();
    await tick(now+70000);
    assert.equal(sends.length,1);
    assert.equal(sends[0].headers.get('content-encoding'),'aes128gcm');
    assert.equal(sends[0].headers.get('urgency'),'high');
    assert.match(sends[0].headers.get('authorization'),/^vapid /);
    assert.equal(sends[0].length,4096);
    assert.deepEqual((await (await request('/test-status',payload)).json()).state,'accepted');
    await tick(now+130000);assert.equal(sends.length,1);
    env.API_FOOTBALL_KEY='test-only-key';
    await tick(now+190000);assert.equal(sends.length,1);
    fixtureStatus='1H';await tick(now+250000);assert.equal(sends.length,2);
    score=1;await tick(now+310000);assert.equal(sends.length,3);
    await tick(now+370000);assert.equal(sends.length,3);
    cards=[{type:'Card',detail:'Yellow Card',time:{elapsed:22},team:{id:9,name:'Bayern Munich'},player:{id:8,name:'Player One'}}];
    await tick(now+430000);assert.equal(sends.length,4);
    await tick(now+490000);assert.equal(sends.length,4);
    fixtureStatus='HT';await tick(now+550000);assert.equal(sends.length,5);
    fixtureStatus='2H';await tick(now+610000);assert.equal(sends.length,6);
    fixtureStatus='FT';await tick(now+670000);assert.equal(sends.length,7);
    assert.equal((await request('/unsubscribe',payload)).status,200);
    assert.equal((await request('/test',payload)).status,404);
  }finally{globalThis.fetch=realFetch}
});
test('provider rejection is reported without falsely claiming delivery',async()=>{
  const env={DB:makeDb()};
  const device=createECDH('prime256v1');device.generateKeys();
  const sub={endpoint:'https://fcm.googleapis.com/fcm/send/rejected-test',keys:{p256dh:device.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
  const payload={token:randomUUID()+randomUUID(),subscription:sub,preferences:{types:[]}};
  const request=path=>worker.fetch(new Request('https://push.example.org'+path,{method:'POST',headers:{origin:'https://fwadh486-lab.github.io','content-type':'application/json'},body:JSON.stringify(payload)}),env);
  const realFetch=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(null,{status:403});
    assert.equal((await request('/subscribe')).status,200);
    assert.equal((await request('/test')).status,202);
    let pending;worker.scheduled({scheduledTime:Date.now()+70000},env,{waitUntil:p=>{pending=p}});await pending;
    const status=await (await request('/test-status')).json();
    assert.equal(status.state,'rejected');assert.equal(status.providerStatus,403);
  }finally{globalThis.fetch=realFetch}
});
