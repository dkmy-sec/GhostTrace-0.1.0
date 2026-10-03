'use strict';
const $ = id => document.getElementById(id);
const COLORS = {page:'#d8e8f5', unknown:'#71a8b8', tracker:'#f2ba70', broker:'#f18dab', fingerprinting:'#b69cf6', suspected:'#ecad77', alias:'#8cbcf1'};
const LABELS = {tracker:'Known tracker', broker:'Broker affiliation', fingerprinting:'Fingerprinting association', suspected:'Identifier signal', alias:'Listed DNS alias'};
let key='', data={nodes:[],edges:[],timeline:[],sites:[],map_points:[],stats:{}}, demo=false, demoEvents=[], selected='', selectedIP='', paused=false;
let world=null, refreshing=false, timer=null, knownSites=[], generation=0;
const number = n => Number(n || 0).toLocaleString();
function element(tag, cls, text) { const e=document.createElement(tag); if(cls)e.className=cls; if(text!==undefined)e.textContent=text; return e; }
function color(flags=[]) { return COLORS[flags.includes('broker')?'broker':flags.includes('tracker')?'tracker':flags.includes('suspected')?'suspected':'unknown']; }
function tag(flags) { const kind=flags.includes('broker')?'broker':flags.includes('tracker')?'tracker':flags.includes('suspected')?'suspected':flags.includes('alias')?'alias':'unknown'; return element('span','tag '+kind,LABELS[kind] || 'Unclassified'); }
function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(timer); timer=setTimeout(()=>$('toast').hidden=true,2800); }
async function api(path, body) {
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)throw new Error('Collector returned '+response.status);
  return response.json();
}
function filters() { return {hours:$('hours-filter').value,site:$('site-filter').value,q:$('search').value.trim(),mode:$('mode-filter').value}; }
function aggregate(events) {
  const nodes=new Map(),edges=new Map(),points=new Map(),sites=new Set(),countries=new Set();
  for(const e of events){
    sites.add(e.site); if(e.ip && e.geo.country_code)countries.add(e.geo.country_code);
    if(!nodes.has(e.domain))nodes.set(e.domain,{domain:e.domain,count:0,sites:new Set(),ips:new Set(),flags:new Set(),attribution:e.attribution,geo:e.geo,last_seen:e.ts,states:{},events:[]});
    const n=nodes.get(e.domain); n.count++;n.sites.add(e.site);e.attribution.flags.forEach(f=>n.flags.add(f));
    if(e.ip)n.ips.add(e.ip); if(n.geo.lat===null && e.geo.lat!==null)n.geo=e.geo;
    n.states[e.state]=(n.states[e.state]||0)+1;if(n.events.length<25)n.events.push(e);
    const ek=e.site+'\0'+e.domain;const edge=edges.get(ek)||{site:e.site,domain:e.domain,count:0};edge.count++;edges.set(ek,edge);
    if(e.ip&&e.geo.lat!==null){const pk=e.domain+'\0'+e.ip;const point=points.get(pk)||{domain:e.domain,ip:e.ip,geo:e.geo,flags:e.attribution.flags,count:0};point.count++;points.set(pk,point);}
  }
  const list=[...nodes.values()].map(n=>({...n,sites:[...n.sites],ips:[...n.ips],flags:[...n.flags]})).sort((a,b)=>b.count-a.count);
  return {nodes:list,edges:[...edges.values()],sites:[...sites].sort(),map_points:[...points.values()],timeline:events.slice(0,150),stats:{requests:events.length,destinations:list.length,trackers:list.filter(n=>n.flags.includes('tracker')).length,brokers:list.filter(n=>n.flags.includes('broker')).length,countries:countries.size,sites:sites.size,unmapped:events.filter(e=>!e.ip||e.geo.lat===null).length}};
}
function demoSnapshot() {
  const f=filters(),q=f.q.toLowerCase();
  return aggregate(demoEvents.filter(e=>(!f.site||e.site===f.site)&&(!q||[e.site,e.domain,e.ip].some(v=>v.toLowerCase().includes(q)))&&(f.mode==='all'||e.attribution.flags.includes(f.mode))&&e.ts>=Date.now()-Number(f.hours)*3600000));
}
async function refresh() {
  if(refreshing)return;refreshing=true;const current=++generation;
  try{
    if(demo){data=demoSnapshot();render();return;}
    const f=filters(); const [snapshot,status]=await Promise.all([api('/api/dashboard?'+new URLSearchParams(f)),api('/api/status')]);
    if(current!==generation)return;
    data=snapshot;paused=status.paused;
    const connected=Date.now()-status.last_seen<50000;
    $('connection').classList.toggle('connected',connected);
    $('connection').lastElementChild.textContent=connected?(paused?'Recording paused':'Extension connected'):'Waiting for extension';
    $('pause-button').textContent=paused?'▶ Resume recording':'Ⅱ Pause recording';
    $('banner').hidden=!paused&&!data.window_capped;
    $('banner').textContent=paused?'Recording is paused. Your saved observations remain available.':data.window_capped?'This window contains the newest 20,000 observations. Narrow the time or site filter to explore more.':'';
    $('live-mark').textContent=paused?'● PAUSED':connected?'● LIVE':'● READY';
    $('freshness').textContent=connected?'Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Pair extension to start';
    render();
  }catch(error){$('connection').classList.remove('connected');$('connection').lastElementChild.textContent='Collector unavailable';$('banner').hidden=false;$('banner').textContent='The collector is unavailable. Keep its terminal window running, then refresh this page.';}
  finally{refreshing=false;}
}
function render() {
  for(const name of ['requests','destinations','trackers','brokers','countries'])$('stat-'+name).textContent=number(data.stats[name]);
  if(!$('site-filter').value)knownSites=data.sites;
  const current=$('site-filter').value;
  const choices=[...new Set([...knownSites,...data.sites])].sort();
  $('site-filter').replaceChildren(element('option','','All visited sites'));
  $('site-filter').firstChild.value='';
  for(const site of choices){const option=element('option','',site);option.value=site;$('site-filter').append(option);}
  $('site-filter').value=current;
  $('graph-empty').hidden=data.nodes.length>0;
  $('graph-hint').hidden=data.nodes.length===0;
  $('map-empty').hidden=data.map_points.length>0;
  $('map-empty').textContent=data.stats.requests?'No mapped response IPs in this view. Cached and failed requests may have no IP.':'Observed IPs will light up the map.';
  $('table-empty').hidden=data.nodes.length>0;
  $('timeline-empty').hidden=data.timeline.length>0;
  $('domain-count').textContent=number(data.nodes.length)+' domains';
  const body=$('destination-rows');body.replaceChildren();
  for(const node of data.nodes.slice(0,200)){
    const tr=element('tr',selected===node.domain?'selected':'');tr.tabIndex=0;
    const td=element('td');td.append(element('span','domain-text',node.domain),element('span','owner-text',node.attribution.owner));
    const label=element('td');label.append(tag(node.flags));
    tr.append(td,label,element('td','',number(node.sites.length)),element('td','',number(node.count)));
    tr.addEventListener('click',()=>inspect(node.domain));tr.addEventListener('keydown',e=>{if(e.key==='Enter')inspect(node.domain);});body.append(tr);
  }
  const trail=$('timeline-list');trail.replaceChildren();
  for(const e of data.timeline.slice(0,40)){
    const item=element('div','timeline-item');item.tabIndex=0;item.setAttribute('role','button');
    const dot=element('span','dot');dot.style.background=color(e.attribution.flags);
    const text=element('div');text.append(element('strong','',e.domain),element('p','',e.site+' · '+e.type+' · '+e.state));
    const stamp=element('time','',new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
    item.append(dot,text,stamp);item.addEventListener('click',()=>inspect(e.domain,e.ip));item.addEventListener('keydown',ev=>{if(ev.key==='Enter')inspect(e.domain,e.ip);});trail.append(item);
  }
  graph.update(data);renderMap();
  if(selected&&!$('details').hidden){if(data.nodes.some(n=>n.domain===selected))renderDetails();else closeDetails();}
}

// Canvas layout uses observed page→destination relationships. No fabricated ownership edges.
class ConnectionGraph {
  constructor(canvas){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.nodes=[];this.edges=[];this.positions=new Map();this.zoom=1;this.pan={x:0,y:0};this.drag=null;this.hover='';this.width=500;this.height=313;this.frames=0;
    new ResizeObserver(()=>this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown',e=>this.down(e));canvas.addEventListener('pointermove',e=>this.move(e));canvas.addEventListener('pointerup',e=>this.up(e));canvas.addEventListener('pointercancel',()=>this.drag=null);
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.max(.4,Math.min(2.8,this.zoom*(e.deltaY>0?.9:1.1)));this.draw();},{passive:false});
    const animate=()=>{if(this.frames>0&&!document.hidden){this.step();this.frames--;this.draw();}requestAnimationFrame(animate);};requestAnimationFrame(animate);
  }
  resize(){const r=this.canvas.getBoundingClientRect();if(!r.width)return;this.width=r.width;this.height=r.height;const d=Math.min(window.devicePixelRatio||1,2);this.canvas.width=r.width*d;this.canvas.height=r.height*d;this.ctx.setTransform(d,0,0,d,0,0);this.frames=45;this.draw();}
  update(snapshot){
    const domains=snapshot.nodes.slice(0,60),wanted=new Set(domains.map(n=>n.domain));
    const pages=[...new Set(snapshot.edges.filter(e=>wanted.has(e.domain)).map(e=>e.site))].slice(0,14);
    const pset=new Set(pages);const raw=[...pages.map((p,i)=>({id:'s:'+p,domain:p,page:true,count:1,flags:[],index:i})),...domains.map((n,i)=>({...n,id:'d:'+n.domain,index:i,page:false}))];
    this.nodes=raw.map(n=>{
      let pos=this.positions.get(n.id);
      if(!pos){const angle=n.index*2.39996;pos={x:n.page?-this.width*.32:this.width*.12+Math.cos(angle)*this.width*.18,y:n.page?(n.index-(pages.length-1)/2)*Math.min(48,this.height/(pages.length+1)):Math.sin(angle)*this.height*.32,vx:0,vy:0};this.positions.set(n.id,pos);}
      return {...n,pos,r:n.page?7:Math.min(12,4+Math.log2(n.count+1)*.85)};
    });
    const lookup=new Map(this.nodes.map(n=>[n.id,n]));this.edges=snapshot.edges.filter(e=>wanted.has(e.domain)&&pset.has(e.site)).map(e=>({...e,a:lookup.get('s:'+e.site),b:lookup.get('d:'+e.domain)}));
    const live=new Set(this.nodes.map(n=>n.id));for(const id of this.positions.keys())if(!live.has(id))this.positions.delete(id);
    this.frames=40;this.draw();
    $('graph-hint').textContent=snapshot.nodes.length>60?'Top 60 destinations · Drag nodes · Scroll to zoom':'Drag nodes · Scroll to zoom · Click to inspect';
  }
  step(){
    for(const n of this.nodes){n.pos.vx*=.75;n.pos.vy*=.75;}
    for(let i=0;i<this.nodes.length;i++)for(let j=i+1;j<this.nodes.length;j++){
      const a=this.nodes[i],b=this.nodes[j];let dx=a.pos.x-b.pos.x,dy=a.pos.y-b.pos.y;const dist=Math.max(12,Math.hypot(dx,dy));const push=260/(dist*dist);a.pos.vx+=dx/dist*push*5;b.pos.vx-=dx/dist*push*5;a.pos.vy+=dy/dist*push*5;b.pos.vy-=dy/dist*push*5;
    }
    for(const n of this.nodes){
      if(this.drag?.node===n)continue;
      const goal=n.page?-this.width*.32:this.width*.15;
      n.pos.vx+=(goal-n.pos.x)*.006;n.pos.vy+=-n.pos.y*.003;
      n.pos.x=Math.max(-this.width*.43,Math.min(this.width*.38,n.pos.x+n.pos.vx));n.pos.y=Math.max(-this.height*.38,Math.min(this.height*.36,n.pos.y+n.pos.vy));
    }
  }
  coord(e){const r=this.canvas.getBoundingClientRect();return {x:(e.clientX-r.left-this.width/2-this.pan.x)/this.zoom,y:(e.clientY-r.top-this.height/2-this.pan.y)/this.zoom};}
  hit(e){const p=this.coord(e);return [...this.nodes].reverse().find(n=>Math.hypot(n.pos.x-p.x,n.pos.y-p.y)<n.r+9);}
  down(e){const node=this.hit(e),p=this.coord(e);this.drag={node,x:p.x,y:p.y,clientX:e.clientX,clientY:e.clientY,start:{...this.pan},moved:false};this.canvas.setPointerCapture(e.pointerId);}
  move(e){
    if(this.drag){if(Math.abs(e.clientX-this.drag.clientX)+Math.abs(e.clientY-this.drag.clientY)>5)this.drag.moved=true;
      if(this.drag.node){const p=this.coord(e);this.drag.node.pos.x=p.x;this.drag.node.pos.y=p.y;}else{this.pan={x:this.drag.start.x+e.clientX-this.drag.clientX,y:this.drag.start.y+e.clientY-this.drag.clientY};}
      this.draw();return;
    }
    const node=this.hit(e);this.canvas.style.cursor=node?'pointer':'grab';const h=node?.id||'';if(h!==this.hover){this.hover=h;this.draw();}
  }
  up(e){const drag=this.drag;this.drag=null;if(drag?.node&&!drag.moved){if(drag.node.page){$('site-filter').value=drag.node.domain;void refresh();}else inspect(drag.node.domain);}this.draw();}
  fit(){this.zoom=1;this.pan={x:0,y:0};this.frames=40;this.draw();}
  draw(){
    const ctx=this.ctx;ctx.clearRect(0,0,this.width,this.height);ctx.save();
    ctx.fillStyle='#203044';for(let x=15;x<this.width;x+=24)for(let y=15;y<this.height;y+=24){ctx.beginPath();ctx.arc(x,y,.65,0,Math.PI*2);ctx.fill();}
    ctx.translate(this.width/2+this.pan.x,this.height/2+this.pan.y);ctx.scale(this.zoom,this.zoom);
    for(const edge of this.edges){const active=edge.b.domain===selected||edge.b.id===this.hover||edge.a.id===this.hover;ctx.strokeStyle=active?color(edge.b.flags)+'bb':'#37546a55';ctx.lineWidth=active?1.2:.55;ctx.beginPath();ctx.moveTo(edge.a.pos.x,edge.a.pos.y);ctx.bezierCurveTo(edge.a.pos.x+45,edge.a.pos.y,edge.b.pos.x-45,edge.b.pos.y,edge.b.pos.x,edge.b.pos.y);ctx.stroke();}
    ctx.font='9px ui-monospace,Consolas,monospace';
    for(const node of this.nodes){const active=node.domain===selected||node.id===this.hover;const c=node.page?COLORS.page:color(node.flags);ctx.fillStyle=c;
      if(active){ctx.shadowColor=c;ctx.shadowBlur=13;}
      ctx.beginPath();ctx.arc(node.pos.x,node.pos.y,node.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
      if(active){ctx.strokeStyle=c+'88';ctx.lineWidth=1;ctx.beginPath();ctx.arc(node.pos.x,node.pos.y,node.r+5,0,Math.PI*2);ctx.stroke();}
      ctx.fillStyle=active?'#eef6ff':node.page?'#a7bfd3':'#7f9bb2';ctx.textAlign='center';
      const label=node.domain.length>29?node.domain.slice(0,26)+'…':node.domain;
      ctx.fillText(label,node.pos.x,node.pos.y+node.r+13);
    }
    ctx.restore();
  }
}
const graph=new ConnectionGraph($('graph'));

// Geographic shapes are bundled Natural Earth data; no external tile server or map SDK.
function project(lon,lat){return [(lon+180)/360*1000,(85-lat)/155*520];}
function ringPath(ring){let path='';for(let i=0;i<ring.length;i++){const p=project(ring[i][0],ring[i][1]);path+=(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1);}return path+'Z';}
function buildMap(){
  const ns='http://www.w3.org/2000/svg',group=$('countries');group.replaceChildren();
  for(const f of world.features){
    if(f.properties.code==='AQ')continue;
    const rings=f.geometry.type==='Polygon'?f.geometry.coordinates:f.geometry.coordinates.flat();
    const shape=document.createElementNS(ns,'path');shape.setAttribute('d',rings.map(ringPath).join(''));shape.dataset.code=f.properties.code;
    const title=document.createElementNS(ns,'title');title.textContent=f.properties.name;shape.append(title);group.append(shape);
  }
  const grid=$('graticule');
  for(let lon=-150;lon<=150;lon+=30){const p=project(lon,0);const l=document.createElementNS(ns,'line');l.setAttribute('x1',p[0]);l.setAttribute('x2',p[0]);l.setAttribute('y1',0);l.setAttribute('y2',520);l.setAttribute('stroke','#21364455');grid.append(l);}
  for(let lat=-60;lat<=60;lat+=30){const p=project(0,lat);const l=document.createElementNS(ns,'line');l.setAttribute('y1',p[1]);l.setAttribute('y2',p[1]);l.setAttribute('x1',0);l.setAttribute('x2',1000);l.setAttribute('stroke','#21364455');grid.append(l);}
  renderMap();
}
function renderMap(){
  if(!world)return;const active=new Set(data.map_points.map(p=>p.geo.country_code));
  const chosen=new Set(data.map_points.filter(p=>p.domain===selected).map(p=>p.geo.country_code));
  for(const path of $('countries').children){path.classList.toggle('active',active.has(path.dataset.code));path.classList.toggle('selected',chosen.has(path.dataset.code));}
  const ns='http://www.w3.org/2000/svg',group=$('map-dots');group.replaceChildren();const buckets={};
  for(const point of data.map_points.slice(0,200)){
    const country=point.geo.country_code,index=buckets[country]||0;buckets[country]=index+1;
    const p=project(point.geo.lon,point.geo.lat),angle=index*2.39996,radius=index?Math.min(36,Math.sqrt(index)*8):0;
    const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx',p[0]+Math.cos(angle)*radius);circle.setAttribute('cy',p[1]+Math.sin(angle)*radius);circle.setAttribute('r',Math.min(8,3.5+Math.log2(point.count+1)*.6));circle.setAttribute('fill',color(point.flags));circle.classList.add('map-marker');if(point.domain===selected)circle.classList.add('selected');circle.setAttribute('tabindex','0');circle.setAttribute('role','button');
    const title=document.createElementNS(ns,'title');title.textContent=point.domain+' · '+point.ip+' · '+point.geo.country+' (country estimate)';circle.append(title);circle.setAttribute('aria-label',title.textContent);circle.addEventListener('click',()=>inspect(point.domain,point.ip));circle.addEventListener('keydown',e=>{if(e.key==='Enter')inspect(point.domain,point.ip);});group.append(circle);
  }
}
function inspect(domain,ip=''){selected=domain;selectedIP=ip;$('details').hidden=false;renderDetails();graph.draw();renderMap();for(const tr of $('destination-rows').children)tr.classList.toggle('selected',tr.firstChild.firstChild.textContent===domain);}
function closeDetails(){selected='';selectedIP='';$('details').hidden=true;graph.draw();renderMap();}
function renderDetails(){
  const node=data.nodes.find(n=>n.domain===selected);if(!node)return;
  const root=$('detail-content');root.replaceChildren();root.append(element('div','eyebrow teal','DESTINATION DETAILS'),element('h2','',node.domain),element('p','owner',node.attribution.owner));
  const tags=element('div','tags');for(const f of node.flags)tags.append(element('span','tag '+f,LABELS[f]));if(!node.flags.length)tags.append(tag([]));root.append(tags);
  const row=(a,b)=>{const r=element('div','detail-row');r.append(element('span','',a),element('strong','',String(b)));root.append(r);};
  root.append(element('h3','','Observed activity'));row('Observations',number(node.count));row('Visited sites',node.sites.length);row('Observed IPs',node.ips.length || 'None in this window');
  for(const [state,count]of Object.entries(node.states))row(state,number(count));
  const point=data.map_points.find(p=>p.domain===selected&&(!selectedIP||p.ip===selectedIP));const geo=point?.geo||node.geo;
  root.append(element('h3','','Network & location'));row('IP',selectedIP || node.ips[0] || 'Unavailable');row('Country estimate',geo.country);row('Map precision',geo.precision==='country'?'Country-level; display marker only':geo.precision);if(geo.network)row('Network operator',geo.network);if(geo.asn)row('ASN','AS'+geo.asn);
  root.append(element('p','small muted','Network operator describes the IP’s network, not necessarily the website’s owner.'));
  root.append(element('h3','','Why it was flagged'));
  const reasons=[...new Map(node.events.flatMap(e=>e.attribution.reasons).map(r=>[r.kind+'|'+r.detail,r])).values()];
  if(!reasons.length)root.append(element('p','small muted','No current dataset match or identifier signal. Unclassified does not mean safe.'));
  for(const reason of reasons){const card=element('div','evidence-card');card.append(element('strong','',reason.kind),element('p','',reason.detail));if(/^https:\/\//.test(reason.url)){const a=element('a','',reason.source+' ↗');a.href=reason.url;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}else card.append(element('span','small muted',reason.source));root.append(card);}
  if(node.attribution.categories.length){root.append(element('h3','','Dataset categories'),element('p','small muted',node.attribution.categories.join(' · ')));}
  root.append(element('h3','','Pages that introduced this destination'));const ul=element('ul','site-list');for(const site of node.sites)ul.append(element('li','',site));root.append(ul);
}

$('close-details').addEventListener('click',closeDetails);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDetails();});
const pair=()=>{$('pair-dialog').showModal();};
$('pair-button').addEventListener('click',pair);$('empty-pair').addEventListener('click',pair);
$('guide-button').addEventListener('click',()=>$('guide-dialog').showModal());
$('overview').addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>$(button.dataset.close).close());
$('copy-key').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(key);$('copy-key').textContent='Copied';setTimeout(()=>$('copy-key').textContent='Copy key',2200);}catch{$('pairing-key').type='text';$('pairing-key').select();toast('Select and copy the pairing key.');}});
$('fit-graph').addEventListener('click',()=>graph.fit());
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{
  for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('selected',b===button);
  document.querySelector('.graph-panel').hidden=button.dataset.view==='map';document.querySelector('.map-panel').hidden=button.dataset.view==='graph';$('visuals').classList.toggle('single',button.dataset.view!=='both');graph.resize();
});
for(const id of ['site-filter','mode-filter','hours-filter'])$(id).addEventListener('change',()=>void refresh());
let searchTimer;$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>void refresh(),180);});
$('pause-button').addEventListener('click',async()=>{try{await api('/api/settings',{paused:!paused});await refresh();}catch{toast('Collector unavailable.');}});
$('clear-button').addEventListener('click',()=>{if(demo){toast('Demo data is simulated. Exit demo to manage your records.');return;}$('clear-dialog').showModal();});
$('confirm-clear').addEventListener('click',async()=>{try{await api('/api/clear',{});knownSites=[];closeDetails();$('clear-dialog').close();await refresh();toast('Local observations cleared.');}catch{toast('Could not clear observations.');}});
$('export-button').addEventListener('click',async()=>{
  if(demo){toast('Exit demo to export your recorded connections.');return;}
  try{const response=await fetch('/api/export',{headers:{Authorization:'Bearer '+key}});if(!response.ok)throw new Error();const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='GhostTrace_connections.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{toast('Could not export observations.');}
});
$('demo-button').addEventListener('click',async()=>{
  if(refreshing)return;
  demo=!demo;selected='';$('details').hidden=true;$('site-filter').value='';$('mode-filter').value='all';$('search').value='';knownSites=[];
  $('demo-button').textContent=demo?'Exit demo':'Explore demo';$('pause-button').disabled=demo;$('export-button').disabled=demo;
  if(demo){
    try{const sample=await (await fetch('/assets/demo.json')).json();const now=Date.now();demoEvents=sample.events.map(e=>({...e,ts:now-e.age_ms}));knownSites=[...new Set(demoEvents.map(e=>e.site))];$('banner').hidden=false;$('banner').textContent='DEMO PREVIEW · Simulated browsing requests. These examples are separate from your recorded activity.';$('connection').classList.remove('connected');$('connection').lastElementChild.textContent='Demo preview';$('freshness').textContent='Simulated activity';$('live-mark').textContent='● DEMO';}catch{demo=false;toast('Demo unavailable.');}
  }
  await refresh();
});
async function init(){
  if(window.GHOSTTRACE_PREVIEW){
    const sample=window.GHOSTTRACE_PREVIEW,now=Date.now();demo=true;world=sample.world;
    demoEvents=sample.demo.events.map(e=>({...e,ts:now-e.age_ms}));knownSites=[...new Set(demoEvents.map(e=>e.site))];
    $('demo-button').textContent='Standalone demo';$('demo-button').disabled=true;$('pause-button').disabled=true;$('export-button').disabled=true;$('copy-key').disabled=true;
    $('pairing-key').placeholder='Available in the running local collector';
    $('banner').hidden=false;$('banner').textContent='STANDALONE DEMO · Simulated connections. Live capture is included in the GhostTrace ZIP and requires the extension plus local collector.';
    $('connection').lastElementChild.textContent='Preview only';$('freshness').textContent='Simulated activity';$('live-mark').textContent='● DEMO';
    buildMap();await refresh();return;
  }
  try{const setup=await (await fetch('/api/setup')).json();if(!setup.key)throw new Error();key=setup.key;$('pairing-key').value=key;world=await (await fetch('/assets/world.geojson')).json();buildMap();await refresh();setInterval(()=>void refresh(),2500);}catch{$('banner').hidden=false;$('banner').textContent='Start GhostTrace with start_ghosttrace.bat, then open http://127.0.0.1:8765.';}
}
void init();
