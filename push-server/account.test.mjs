import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signToken} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {accountRoute,cleanAccountData} from './account.mjs';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-kid',kty:'RSA',alg:'RS256',use:'sig'};
function jwt(overrides={}){
 const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 const now=Math.floor(Date.now()/1000);
 const h=b64({alg:'RS256',kid:'test-kid'}),p=b64({iss:'https://securetoken.google.com/kora-zol',aud:'kora-zol',sub:'member-1',exp:now+3600,iat:now-30,auth_time:now-300,...overrides});
 return h+'.'+p+'.'+signToken('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');
}
function env(){
 const db=new DatabaseSync(':memory:');
 const bind=(sql,values=[])=>({bind:(...xs)=>bind(sql,xs),first:async()=>db.prepare(sql).get(...values)||null,run:async()=>({meta:db.prepare(sql).run(...values)})});
 return {DB:{prepare:sql=>bind(sql)}};
}
const data={followedTeams:['Al Hilal'],favoriteMatches:['ss:match'],notificationLeagues:['afcelite'],notificationTeams:['Al Hilal'],followedLeagues:['afcelite'],alertRule:'both',alertTypes:['goal'],alertAllLive:false,savedMatches:[{id:'ss:match',home:'Al Hilal',away:'Al Ain',date:'2026-11-24T18:00:00Z'}]};
test('server saves and restores user-specific data with signature-verified Firebase identity',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{assert.match(String(url),/securetoken@system\.gserviceaccount\.com/);return Response.json({keys:[jwk]})};
 const db=env();
 const req=(method,token,payload)=>new Request('https://worker.invalid/account',{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined});
 const parse=async r=>r.json();
 try{
  let res=await accountRoute(req('GET',jwt()),db,parse);assert.equal((await res.json()).found,false);
  res=await accountRoute(req('PUT',jwt(),data),db,parse);assert.equal(res.status,200);
  res=await accountRoute(req('GET',jwt()),db,parse);assert.deepEqual((await res.json()).data,cleanAccountData(data));
  res=await accountRoute(req('GET',jwt({sub:'member-2'})),db,parse);assert.equal((await res.json()).found,false);
  res=await accountRoute(req('GET',jwt({aud:'other-project'})),db,parse);assert.equal(res.status,401);
  res=await accountRoute(req('GET',jwt({exp:Math.floor(Date.now()/1000)-10})),db,parse);assert.equal(res.status,401);
  const bad=req('GET',jwt());bad.headers.set('authorization','Bearer '+jwt().slice(0,-4)+'AAAA');res=await accountRoute(bad,db,parse);assert.equal(res.status,401);
  res=await accountRoute(req('PUT',jwt(),{...data,favoriteMatches:['ok',3]}),db,parse);assert.equal(res.status,400);
  res=await accountRoute(req('GET',jwt()),db,parse);assert.deepEqual((await res.json()).data,cleanAccountData(data));
 }finally{globalThis.fetch=original;}
});
test('unauthorized request cannot read or overwrite favorites',async()=>{
 const db=env(),req=new Request('https://worker.invalid/account',{headers:{}});
 const res=await accountRoute(req,db,async()=>({}));assert.equal(res.status,401);
 assert.throws(()=>cleanAccountData({followedTeams:[''],favoriteMatches:[]}),/invalid_preferences/);
});
