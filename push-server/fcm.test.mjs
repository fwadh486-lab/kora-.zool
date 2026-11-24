import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {nativeMessage,nativeConfigured,nativeConfigStatus,probeNativeAuthorization,sendNative} from './fcm.mjs';

test('FCM sends native Android channel payload and retains transient failures',async()=>{
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const env={FCM_SERVICE_ACCOUNT:JSON.stringify({project_id:'test-project',client_email:'sender@example.invalid',private_key:privateKey.export({format:'pem',type:'pkcs8'})})};
  assert.equal(nativeConfigured(env),true);assert.equal(nativeConfigured({}),false);
  assert.equal(nativeConfigStatus({}),'missing');
  assert.equal(nativeConfigStatus({FCM_SERVICE_ACCOUNT:'{'}),'invalid_json');
  assert.equal(nativeConfigStatus({FCM_SERVICE_ACCOUNT:'{"project_info":{}}'}),'invalid_account');
  assert.equal(nativeConfigStatus({FCM_SERVICE_ACCOUNT:'\uFEFF'+env.FCM_SERVICE_ACCOUNT}),'ready');
  assert.equal(nativeConfigStatus({FCM_SERVICE_ACCOUNT:JSON.stringify(env.FCM_SERVICE_ACCOUNT)}),'ready');
  const message={title:'هدف',body:'1–0',url:'https://example.invalid/',tag:'goal-1'};
  assert.equal(nativeMessage('token',message).message.android.notification.channel_id,'korazol_matches');
  const rich=nativeMessage('token',{...message,image:'https://img.thesports.com/football/player/p.png'},true).message;
  assert.equal(rich.notification,undefined);assert.equal(rich.data.title,'هدف');assert.equal(rich.data.type,'general');assert.match(rich.data.image,/player\/p.png$/);assert.equal(rich.android.priority,'HIGH');
  for(const category of ['goal-home','goal-away','kickoff','secondhalf','halftime','fulltime','yellow','red']){
    const categorized=nativeMessage('token',{...message,type:category},true).message;
    assert.equal(categorized.data.type,category);
    assert.equal(categorized.notification,undefined);
    assert.equal(categorized.android.priority,'HIGH');
  }
  assert.equal(nativeMessage('token',{...message,type:'not-real'},true).message.data.type,'general');
  assert.equal(nativeMessage('token',{...message,type:'yellow'}).message.data.type,'yellow');
  assert.equal(nativeMessage('token',{...message,type:'yellow'}).message.android.notification.channel_id,'korazol_matches');
  const original=globalThis.fetch;let code=200;let detail='';let authCalls=0;
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes('oauth2.googleapis.com')){authCalls++;assert.ok(options.body.get('assertion').split('.').length===3);return Response.json({access_token:'mock',expires_in:3600});}
    assert.equal(options.headers.authorization,'Bearer mock');assert.match(String(url),/test-project\/messages:send$/);const request=JSON.parse(options.body);if(request.validate_only){assert.equal(request.message.topic,'korazol-validation-only');assert.equal(request.message.token,undefined);}else assert.equal(request.message.notification.title,'هدف');
    return Response.json({error:{details:[{errorCode:detail}]}},{status:code});
  };
  try{assert.equal(await probeNativeAuthorization(env,'wrong','sender@example.invalid'),'project_mismatch');assert.equal(await probeNativeAuthorization(env,'test-project','wrong'),'account_mismatch');assert.equal(await probeNativeAuthorization(env,'test-project','sender@example.invalid'),'authorized');assert.equal(await sendNative(env,'token',message),200);code=403;detail='SENDER_ID_MISMATCH';assert.equal(await sendNative(env,'token',message),460);code=404;detail='';assert.equal(await sendNative(env,'token',message),593);detail='UNREGISTERED';assert.equal(await sendNative(env,'token',message),410);assert.equal(authCalls,1);}finally{globalThis.fetch=original;}
});
