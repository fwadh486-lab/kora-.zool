import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('new event types stay checked and are persisted even when old preferences exist',async()=>{
  const storage=new Map([['korazol_push_types_v1','["goal","kickoff","fulltime"]'],['korazol_push_types_v2','["goal","kickoff","fulltime"]']]);
  const element=()=>({style:{},listeners:{},addEventListener(type,fn){this.listeners[type]=fn}});
  const byId=new Map(['backgroundPushButton','backgroundPushTest','backgroundPushStatus','pushAllLive','preferenceSyncStatus'].map(id=>[id,element()]));
  const inputs=['goal','kickoff','yellow','red','halftime','fulltime'].map(pushType=>({...element(),dataset:{pushType},checked:false}));
  const document={documentElement:{lang:'ar'},getElementById:id=>byId.get(id),querySelectorAll:()=>inputs,addEventListener(){}};
  const window={addEventListener(){}};
  vm.runInNewContext(readFileSync(new URL('../push-client.js',import.meta.url),'utf8'),{
    document,window,navigator:{},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    fetch:async()=>({ok:false}),setInterval(){},setTimeout(){return 1},clearTimeout(){},AbortSignal
  });
  await new Promise(resolve=>setImmediate(resolve));
  for(const type of ['yellow','red','halftime']){
    const input=inputs.find(item=>item.dataset.pushType===type);assert.equal(input.checked,false);
    input.checked=true;input.listeners.change();assert.equal(input.checked,true);
  }
  assert.deepEqual(JSON.parse(storage.get('korazol_push_types_v2')).sort(),['goal','kickoff','yellow','red','halftime','fulltime'].sort());
  const yellow=inputs.find(input=>input.dataset.pushType==='yellow');yellow.checked=false;yellow.listeners.change();assert.equal(yellow.checked,false);
  assert.equal(JSON.parse(storage.get('korazol_push_types_v2')).includes('yellow'),false);
});
