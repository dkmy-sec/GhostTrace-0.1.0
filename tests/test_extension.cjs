/* Execute the actual worker in a simulated Chrome API runtime. No real browsing. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../extension');
const clone=x=>JSON.parse(JSON.stringify(x));
const local={settings:{port:8765,key:'test-pairing-key-abcdefghijklmnopqrstuvwxyz',enabled:true,excluded:['excluded.example']}},session={};
const bridge={online:false,paused:false,batches:[]};
function event(){const listeners=[];return{addListener(fn){listeners.push(fn)},emit(...args){for(const fn of listeners)fn(...args)},listeners};}
function storage(target){return{async get(keys){if(keys===undefined)return clone(target);if(typeof keys==='string')keys=[keys];return Object.fromEntries(keys.filter(k=>k in target).map(k=>[k,clone(target[k])]))},async set(values){Object.assign(target,clone(values));}};}
function worker(){
 const chrome={storage:{local:storage(local),session:storage(session)},webRequest:{},webNavigation:{onCommitted:event()},tabs:{onRemoved:event(),async query(){return[]}},alarms:{create(){},onAlarm:event()},runtime:{id:'a'.repeat(32),onStartup:event(),onMessage:event()},action:{setBadgeText(){},setBadgeBackgroundColor(){}}};
 for(const name of ['onBeforeRequest','onSendHeaders','onHeadersReceived','onCompleted','onBeforeRedirect','onErrorOccurred'])chrome.webRequest[name]=event();
 const ctx=vm.createContext({chrome,URL,AbortSignal,crypto:{randomUUID:crypto.randomUUID},console,fetch:async(url,options)=>{
  if(!bridge.online)throw new Error('Offline fixture');
  const body=JSON.parse(options.body);
  if(url.endsWith('/api/events'))bridge.batches.push(body.events);
  return {ok:true,status:200,async json(){return url.endsWith('/api/heartbeat')?{paused:bridge.paused}:{accepted:body.events?.length||0,paused:bridge.paused}}};
 }});ctx.self=ctx;ctx.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),ctx)};
 vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx);
 const drain=async()=>{await vm.runInContext('ready',ctx);for(let n=0;n<12;n++){await Promise.resolve();await vm.runInContext('serial',ctx);await new Promise(resolve=>setImmediate(resolve));}};
 const message=m=>new Promise(resolve=>chrome.runtime.onMessage.emit(m,{id:chrome.runtime.id},resolve));
 return{chrome,drain,message};
}
function request(id,url='https://google-analytics.com/private/SECRET_PATH?fbclid=SECRET_QUERY',extra={}){return{requestId:id,url,tabId:3,type:'script',method:'GET',timeStamp:Date.now(),initiator:'https://news.example',...extra};}
(async()=>{
 let w=worker();await w.drain();
 w.chrome.webNavigation.onCommitted.emit({frameId:0,tabId:3,url:'https://news.example/SECRET_PAGE'});
 let d=request('one');w.chrome.webRequest.onBeforeRequest.emit(d);
 w.chrome.webRequest.onSendHeaders.emit({...d,requestHeaders:[{name:'Cookie',value:'SECRET_COOKIE'}]});
 w.chrome.webRequest.onHeadersReceived.emit({...d,responseHeaders:[{name:'Set-Cookie',value:'SECRET_SET_COOKIE'}]});
 w.chrome.webRequest.onCompleted.emit({...d,ip:'8.8.8.8',statusCode:200});await w.drain();
 assert.equal(local.queue.length,1);assert.equal(local.queue[0].site,'news.example');assert.equal(local.queue[0].state,'response');
 assert.equal(local.queue[0].evidence.cookie_sent,true);assert.equal(local.queue[0].evidence.cookie_set,true);assert.deepEqual(local.queue[0].evidence.identifier_params,['fbclid']);
 assert.ok(!JSON.stringify(local).includes('SECRET'));assert.ok(!JSON.stringify(session).includes('SECRET'));
 // Queue survives worker recreation, then drains to the authenticated local bridge.
 bridge.online=true;w=worker();await w.drain();await w.message({action:'flush'});assert.equal(local.queue.length,0);assert.equal(bridge.batches.flat().length,1);
 // Redirect hops have unique identities and their own response metadata.
 d=request('redirect','https://news.example/redirect',{type:'main_frame'});w.chrome.webRequest.onBeforeRequest.emit(d);w.chrome.webRequest.onBeforeRedirect.emit({...d,statusCode:302,ip:'8.8.8.8'});
 d={...d,url:'https://shop.example/land'};w.chrome.webRequest.onBeforeRequest.emit(d);w.chrome.webRequest.onCompleted.emit({...d,statusCode:200,ip:'1.1.1.1'});await w.drain();await w.message({action:'flush'});
 const redirect=bridge.batches.flat().filter(e=>e.id.includes('.redirect.'));assert.equal(redirect.length,2);assert.notEqual(redirect[0].id,redirect[1].id);assert.deepEqual(redirect.map(e=>e.state),['redirect','response']);
 // Exclusions and private-window flags skip requests; cache and client blocks are distinct.
 w.chrome.webNavigation.onCommitted.emit({frameId:0,tabId:3,url:'https://excluded.example'});d=request('excluded');w.chrome.webRequest.onBeforeRequest.emit(d);w.chrome.webRequest.onCompleted.emit(d);await w.drain();
 assert.ok(!local.queue.some(e=>e.id.includes('excluded')));
 w.chrome.webNavigation.onCommitted.emit({frameId:0,tabId:3,url:'https://news.example'});
 for(const id of ['cache','blocked','private']){
  d=request(id,'https://google-analytics.com/a',{incognito:id==='private'});w.chrome.webRequest.onBeforeRequest.emit(d);
  if(id==='blocked')w.chrome.webRequest.onErrorOccurred.emit({...d,error:'net::ERR_BLOCKED_BY_CLIENT'});
  else w.chrome.webRequest.onCompleted.emit({...d,ip:'8.8.8.8',fromCache:id==='cache'});
 }
 await w.drain();await w.message({action:'flush'});
 const recorded=bridge.batches.flat();assert.equal(recorded.find(e=>e.id.includes('.cache.')).state,'cached');assert.equal(recorded.find(e=>e.id.includes('.cache.')).ip,'');assert.equal(recorded.find(e=>e.id.includes('.blocked.')).state,'client-blocked');assert.ok(!recorded.some(e=>e.id.includes('.private.')));
 bridge.paused=true;await w.message({action:'flush'});d=request('paused');w.chrome.webRequest.onBeforeRequest.emit(d);w.chrome.webRequest.onCompleted.emit(d);await w.drain();assert.equal(local.queue.length,0);
 await w.message({action:'save',settings:{port:8765,key:local.settings.key,enabled:false,excluded:''}});assert.equal(local.settings.enabled,false);assert.equal(local.queue.length,0);
 console.log('Passed: worker capture lifecycle, header redaction, offline queue/restart, redirect identities, site exclusion, cache/blocked states, private-window exclusion, pause, and disable.');
})().catch(error=>{console.error(error);process.exitCode=1;});
