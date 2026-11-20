import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('push event runs without a window and restricts notification links to the app',async()=>{
  const handlers={},shown=[];
  const self={addEventListener:(type,handler)=>handlers[type]=handler,registration:{scope:'https://fwadh486-lab.github.io/kora-.zool/',showNotification:async(title,options)=>shown.push({title,options})},location:{origin:'https://fwadh486-lab.github.io'}};
  vm.runInNewContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),{self,URL,Date});
  let pending;
  handlers.push({data:{json:()=>({title:'هدف!',body:'2 - 1',tag:'goal-1',url:'https://evil.example/'})},waitUntil:p=>pending=p});
  await pending;
  assert.equal(shown.length,1);
  assert.equal(shown[0].title,'هدف!');
  assert.equal(shown[0].options.data.url,self.registration.scope);
  assert.match(shown[0].options.icon,/kora-zol-icon-192.png$/);
  handlers.push({data:{json:()=>({title:'نهاية المباراة',url:self.registration.scope+'?team=Arsenal'})},waitUntil:p=>pending=p});
  await pending;
  assert.equal(shown[1].options.data.url,self.registration.scope+'?team=Arsenal');
});
