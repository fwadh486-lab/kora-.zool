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
test('register, authorized test, delayed encrypted push, live events and opt-out',async()=>{
  const vapid=createECDH('prime256v1');vapid.generateKeys();
  const device=createECDH('prime256v1');device.generateKeys();
  const env={DB:makeDb(),APP_ORIGIN:'https://fwadh486-lab.github.io',APP_URL:'https://fwadh486-lab.github.io/kora-.zool/',VAPID_SUBJECT:'mailto:admin@example.org',VAPID_PUBLIC_KEY:vapid.getPublicKey().toString('base64url'),VAPID_PRIVATE_KEY:vapid.getPrivateKey().toString('base64url')};
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-device',expirationTime:null,keys:{p256dh:device.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
  const token=randomUUID()+randomUUID(),payload={token,subscription,preferences:{teams:['Bayern'],matches:[],types:['kickoff','goal','fulltime'],language:'ar'}};
  const request=async(path,data,origin=env.APP_ORIGIN)=>worker.fetch(new Request('https://push.example.org'+path,{method:data?'POST':'GET',headers:{origin,'content-type':'application/json'},body:data?JSON.stringify(data):undefined}),env);
  const config=await request('/config');assert.equal(config.status,200);assert.equal((await config.json()).enabled,true);
  assert.equal((await request('/config',null,'https://bad.example')).status,403);
  assert.equal((await request('/subscribe',{...payload,subscription:{...subscription,endpoint:'https://127.0.0.1/'}})).status,400);
  assert.equal((await request('/subscribe',payload)).status,200);
  assert.equal((await request('/subscribe',{...payload,token:randomUUID()+randomUUID()})).status,409);
  assert.equal((await request('/test',payload)).status,202);
  assert.equal((await request('/test',payload)).status,429);
  const sends=[];let fixtureStatus='NS',score=0;
  const realFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith('https://fcm.googleapis.com/')){
      sends.push({headers:new Headers(options.headers),length:options.body.byteLength});
      return new Response(null,{status:201});
    }
    if(String(url).startsWith('https://v3.football.api-sports.io/')){
      assert.equal(options.headers['x-apisports-key'],'test-only-key');
      return Response.json({errors:[],response:[{fixture:{id:123,date:new Date().toISOString(),status:{short:fixtureStatus,elapsed:fixtureStatus==='FT'?90:15}},teams:{home:{name:'Bayern Munich'},away:{name:'FC Köln'}},goals:{home:score,away:0},league:{id:78}}]});
    }
    throw Error('Unexpected outbound request');
  };
  async function tick(now){let pending;worker.scheduled({scheduledTime:now},env,{waitUntil:p=>{pending=p}});await pending}
  try{
    const now=Date.now();
    await tick(now+70000);
    assert.equal(sends.length,1);
    assert.equal(sends[0].headers.get('content-encoding'),'aes128gcm');
    assert.match(sends[0].headers.get('authorization'),/^vapid /);
    assert.equal(sends[0].length,4096);
    await tick(now+130000);assert.equal(sends.length,1);
    env.API_FOOTBALL_KEY='test-only-key';
    await tick(now+190000);assert.equal(sends.length,1);
    fixtureStatus='1H';await tick(now+250000);assert.equal(sends.length,2);
    score=1;await tick(now+310000);assert.equal(sends.length,3);
    await tick(now+370000);assert.equal(sends.length,3);
    fixtureStatus='FT';await tick(now+430000);assert.equal(sends.length,4);
    assert.equal((await request('/unsubscribe',payload)).status,200);
    assert.equal((await request('/test',payload)).status,404);
  }finally{globalThis.fetch=realFetch}
});
