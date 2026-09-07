/* Ferrocat 1.4: rail GTFS unified + service LOD + station reuse cost model. */
const COLORS=['#e63946','#2a9d8f','#f4a300','#8338ec','#3a86ff','#06d6a0','#ff6b35','#c9184a','#4361ee','#ff006e','#90be6d','#f94144'];
const BASE={x:0,y:0,w:800,h:660}, MARGIN=30, CAR_OCC=1.25, MAX_DIV=0.65, TIMETABLE=.30, CAR_FIXED=4, EXISTING_COST=2;
const STATE_KEY='ferrocat-state-v1.4.4-functional';
const OLD_STATE_KEY='ferrocat-state-v1.4-functional';
const SEARCH_CORRIDOR_M=25000;
const muniById=Object.fromEntries(MUNICIPIS.map(m=>[String(m.id),m]));
const params={velocitatTren:80,frequencia:2,velocitatCotxe:65,tempsAcces:6,tempsParada:1,intensitatMobilitat:1.12,sensibilitatDistancia:1.2,sensibilitat:.08,biaix:.8,fraccioCotxeActual:.75,radiCaptacio:8,costPerKm:12,tunnelCost:80,viaductCost:35,stationCost:8,stationReuseRadius:.75,maxGradient:35,emissioPerKm:.15,diesPerAny:250};
const limits={velocitatTren:[40,160],frequencia:[.5,6],velocitatCotxe:[30,110],tempsAcces:[2,15],tempsParada:[.5,3],intensitatMobilitat:[1,1.6],sensibilitatDistancia:[1,1.8],sensibilitat:[.02,.2],biaix:[-1,3],fraccioCotxeActual:[.4,1],radiCaptacio:[2,20],costPerKm:[4,30],tunnelCost:[30,160],viaductCost:[15,80],stationCost:[1,50],stationReuseRadius:[.1,3],maxGradient:[20,45],emissioPerKm:[.08,.25]};
let state={lines:[],counter:0,activeId:null,tool:'stations',layer:'procedural',layers:{comarques:true,rail:false,renfe:true,fgc:true,tmb:true,tram:true,roads:true,topo:false,flows:true},vb:{...BASE}};
let hoverId=null,dragging=false,dragMoved=false,dragStart=null,vbStart=null,searchIndex=-1,searchMatches=[];
const svg=parentElement.querySelector('#mapa');
const byId=id=>parentElement.querySelector('#'+id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmt=n=>Math.round(Number(n)||0).toLocaleString('ca-ES');
const fmt1=n=>(Number(n)||0).toFixed(1);
const finite=(v,d,a=-Infinity,b=Infinity)=>Number.isFinite(Number(v))?clamp(Number(v),a,b):d;
function setHTML(id,html){const e=byId(id);if(e)e.innerHTML=html;}
function dataLabel(){const d=Array.isArray(META?.days)?META.days:[];return d.length===1?d[0]:(d.length?`${d[0]} → ${d.at(-1)}`:'darrera matriu disponible');}

const STATIC_BASE='/app/static';
const roadTileCache=new Map();
let roadLodCurrent=null,roadRenderTimer=null,roadForcePending=false;
let terrainContours=(TERRAIN_CONTOURS&&typeof TERRAIN_CONTOURS==='object')?TERRAIN_CONTOURS:null,terrainContoursPromise=null,terrainRenderGeneration=0;
let roadManifest=(ROAD_MANIFEST&&typeof ROAD_MANIFEST==='object'&&Object.keys(ROAD_MANIFEST).length)?ROAD_MANIFEST:null,roadManifestPromise=null,roadRenderGeneration=0;

async function fetchJsonStatic(path){
  const r=await fetch(`${STATIC_BASE}/${path}`,{cache:'force-cache'});
  if(!r.ok)throw new Error(`${r.status} ${r.statusText}: ${path}`);
  return r.json();
}
function intersectsBbox(a,b){return !(a[2]<b[0]||a[0]>b[2]||a[3]<b[1]||a[1]>b[3]);}

/* ---------------- projection ---------------- */
function merc(lon,lat){const x=(+lon+180)/360,cl=clamp(+lat,-85.05112878,85.05112878),r=cl*Math.PI/180;return [x,(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2];}
const geo=[];MUNICIPIS.forEach(m=>geo.push([+m.lon,+m.lat]));COMARQUES.forEach(c=>{const g=c.geom,ps=g.type==='Polygon'?[g.coordinates]:g.coordinates;ps.forEach(p=>p.forEach(r=>r.forEach(q=>geo.push([+q[0],+q[1]]))))});RAIL_EDGES.slice(0,5000).forEach(e=>(e.coords||[]).forEach(q=>geo.push(q)));
const mp=geo.map(q=>merc(q[0],q[1])),mnx=Math.min(...mp.map(p=>p[0])),mxx=Math.max(...mp.map(p=>p[0])),mny=Math.min(...mp.map(p=>p[1])),mxy=Math.max(...mp.map(p=>p[1]));
const scale=Math.min((BASE.w-2*MARGIN)/(mxx-mnx),(BASE.h-2*MARGIN)/(mxy-mny)),dw=(mxx-mnx)*scale,dh=(mxy-mny)*scale,ox=(BASE.w-dw)/2,oy=(BASE.h-dh)/2;
function project(lon,lat){const [x,y]=merc(lon,lat);return [ox+(x-mnx)*scale,oy+(y-mny)*scale];}
function unproject(x,y){const mx=mnx+(x-ox)/scale,my=mny+(y-oy)/scale,lon=mx*360-180,n=Math.PI-2*Math.PI*my;return [lon,180/Math.PI*Math.atan(Math.sinh(n))];}
MUNICIPIS.forEach(m=>{m.id=String(m.id);[m.x,m.y]=project(m.lon,m.lat)});COMARQUES.forEach(c=>{const cv=r=>r.map(q=>project(q[0],q[1]));c.pg=c.geom.type==='Polygon'?[c.geom.coordinates.map(cv)]:c.geom.coordinates.map(p=>p.map(cv))});
function hav(a,b){const R=6371.0088,d=Math.PI/180,dlat=(b.lat-a.lat)*d,dlon=(b.lon-a.lon)*d,q=Math.sin(dlat/2)**2+Math.cos(a.lat*d)*Math.cos(b.lat*d)*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(q));}
function havLL(a,b){return hav({lon:a[0],lat:a[1]},{lon:b[0],lat:b[1]});}
function geometryLength(coords){let s=0;for(let i=1;i<coords.length;i++)s+=havLL(coords[i-1],coords[i]);return s;}

const REAL_STATIONS=(RAIL_STATIONS||[]).filter(s=>Number.isFinite(+s.lon)&&Number.isFinite(+s.lat)).map(s=>({
  ...s,lon:+s.lon,lat:+s.lat,
  _norm:String(s.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
}));
function proposedStationNorm(m){
  return String(m?.nom||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function stationAssessment(municipalStations){
  if(!municipalStations.length)return {newCount:0,reusedCount:0,cost:0,matches:[],newStations:[]};

  const candidates=[];
  for(let i=0;i<municipalStations.length;i++){
    const m=municipalStations[i],mn=proposedStationNorm(m);
    for(const s of REAL_STATIONS){
      if(!s.reusable_heavy_rail)continue;
      const d=hav(m,s);
      const nameMatch=mn&&s._norm&&(s._norm===mn||s._norm.includes(mn)||mn.includes(s._norm));
      if(d<=params.stationReuseRadius||(nameMatch&&d<=3)){
        candidates.push({proposal:i,station:s,d});
      }
    }
  }

  candidates.sort((a,b)=>a.d-b.d);
  const usedProposal=new Set(),usedStation=new Set(),matches=[];
  for(const c of candidates){
    if(usedProposal.has(c.proposal)||usedStation.has(c.station.id))continue;
    usedProposal.add(c.proposal);
    usedStation.add(c.station.id);
    matches.push({
      proposal:c.proposal,
      municipality:municipalStations[c.proposal].nom,
      station:c.station.name,
      operators:c.station.operators||[],
      distanceKm:c.d
    });
  }

  const newStations=municipalStations
    .map((m,i)=>({m,i}))
    .filter(x=>!usedProposal.has(x.i))
    .map(x=>x.m.nom);

  return {
    newCount:newStations.length,
    reusedCount:matches.length,
    cost:newStations.length*params.stationCost,
    matches,
    newStations
  };
}

/* ---------------- persisted state ---------------- */
function sanitizeLine(x){
  if(!x||typeof x!=='object')return null;
  const id=/^linia-\d+$/.test(x.id||'')?x.id:null;
  if(!id)return null;
  const stations=Array.isArray(x.stations)?[...new Set(x.stations.map(String).filter(id=>muniById[id]))].slice(0,MUNICIPIS.length):[];
  const alignment=Array.isArray(x.alignment)
    ?x.alignment.filter(p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(+p[0])&&Number.isFinite(+p[1]))
      .slice(0,2500).map(p=>[+p[0],+p[1]])
    :[];
  if(!stations.length&&!alignment.length)return null;
  const fallback=COLORS[(+id.split('-')[1]-1)%COLORS.length];
  const color=/^#[0-9a-fA-F]{6}$/.test(String(x.color||''))?String(x.color):fallback;
  return {
    id,
    name:String(x.name||`Línia ${id.split('-')[1]}`).slice(0,100),
    color,
    stations,
    alignment,
    sourceServiceId:x.sourceServiceId?String(x.sourceServiceId):null,
    sourceAgency:x.sourceAgency?String(x.sourceAgency):null,
    sourceRoute:x.sourceRoute?String(x.sourceRoute):null,
    analysis:null
  };
}
function save(){try{sessionStorage.setItem(STATE_KEY,JSON.stringify({schemaVersion:3,state:{...state,lines:state.lines.map(l=>({...l,analysis:null}))},params}))}catch(e){console.warn('[Ferrocat] state save',e)}}
function restore(){
  try{
    let rawText=sessionStorage.getItem(STATE_KEY),raw=rawText?JSON.parse(rawText):null,migrating=false;
    if(!raw){
      const legacy=sessionStorage.getItem(OLD_STATE_KEY);
      if(legacy){raw=JSON.parse(legacy);migrating=true;}
    }
    if(!raw)return;
    const s=raw.state||{},ls=Array.isArray(s.lines)?s.lines.map(sanitizeLine).filter(Boolean).slice(0,100):[];
    const ids=new Set(ls.map(l=>l.id));
    const restoredLayers=migrating?{...state.layers,...(s.layers||{}),rail:false}:{...state.layers,...(s.layers||{})};
    state={
      lines:ls,
      counter:Math.max(finite(s.counter,0,0,1e6),...ls.map(l=>+l.id.split('-')[1]||0)),
      activeId:ids.has(s.activeId)?s.activeId:null,
      tool:['stations','trace'].includes(s.tool)?s.tool:'stations',
      layer:['procedural','osm'].includes(s.layer)?s.layer:'procedural',
      layers:restoredLayers,
      vb:s.vb&&Number.isFinite(+s.vb.w)?{x:+s.vb.x,y:+s.vb.y,w:clamp(+s.vb.w,BASE.w/16,BASE.w*2.5),h:clamp(+s.vb.h,BASE.h/16,BASE.h*2.5)}:{...BASE}
    };
    Object.keys(params).forEach(k=>{if(raw.params&&limits[k])params[k]=finite(raw.params[k],params[k],...limits[k])});
    if(migrating)save();
  }catch(e){
    console.warn('[Ferrocat] state restore',e);
  }
}restore();

/* ---------------- mobility model ---------------- */
function catchments(stations){const rows=[];MUNICIPIS.forEach(m=>{let best=null;stations.forEach((e,i)=>{const d=hav(m,e);if(d<=params.radiCaptacio&&(!best||d<best.d))best={i,d}});if(best)rows.push({m,i:best.i})});return rows;}
function zoneAssignment(rows){const z=new Map();rows.forEach(r=>{const k=String(r.m.zone||'');if(!k)return;if(!z.has(k))z.set(k,new Map());const q=z.get(k);q.set(r.i,(q.get(r.i)||0)+(+r.m.pob||0))});const out=new Map();let shared=0;z.forEach((v,k)=>{if(v.size>1)shared++;let bi=null,bp=-1;v.forEach((p,i)=>{if(p>bp){bp=p;bi=i}});out.set(k,bi)});return {out,shared};}
function odPairs(zmap){const p=new Map();OD_PAIRS.forEach(([a,b,v])=>{const i=zmap.get(String(a)),j=zmap.get(String(b));if(i===undefined||j===undefined||i===j)return;const x=Math.min(i,j),y=Math.max(i,j),k=`${x}|${y}`;p.set(k,(p.get(k)||0)+(+v||0))});return p;}
function modal(delta){return MAX_DIV/(1+Math.exp(clamp(params.biaix+params.sensibilitat*delta,-30,30)));}
function lineCoords(l){if(l.analysis?.optimizedCoords?.length>1)return l.analysis.optimizedCoords;if(l.alignment?.length>1)return l.alignment;return l.stations.map(id=>{const m=muniById[id];return m?[+m.lon,+m.lat]:null}).filter(Boolean);}
function nearestRailDistanceBase(pt){let best=Infinity;for(const e of RAIL_EDGES){const c=e._p||(e._p=(e.coords||[]).map(q=>project(q[0],q[1])));for(let i=1;i<c.length;i++){best=Math.min(best,pointSeg(pt,c[i-1],c[i]));if(best<1)return best}}return best;}
function pointSeg(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;if(!l)return Math.hypot(p[0]-a[0],p[1]-a[1]);const t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l,0,1),x=a[0]+t*dx,y=a[1]+t*dy;return Math.hypot(p[0]-x,p[1]-y);}
function infrastructureKm(coords){let existing=0,total=0;for(let i=1;i<coords.length;i++){const km=havLL(coords[i-1],coords[i]);total+=km;const a=project(...coords[i-1]),b=project(...coords[i]),mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];if(RAIL_EDGES.length&&nearestRailDistanceBase(mid)<3)existing+=km;}return {existing,total};}
function metrics(l){
  const st=l.stations.map(id=>muniById[id]).filter(Boolean),n=st.length,coords=lineCoords(l);
  const len=coords.length>1?geometryLength(coords):0;
  const rows=catchments(st),popDirect=st.reduce((s,m)=>s+(+m.pob||0),0),popCatch=rows.reduce((s,r)=>s+(+r.m.pob||0),0);
  const za=zoneAssignment(rows),od=odPairs(za.out),headway=60/Math.max(params.frequencia,.1),sched=Math.min(30,headway*TIMETABLE);
  let observed=0,captured=0,vehicles=0,vkm=0,flows=[];
  const prefix=[0];
  if(st.length){for(let i=1;i<st.length;i++)prefix.push(prefix.at(-1)+hav(st[i-1],st[i])*params.intensitatMobilitat)}
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
    const obs=+(od.get(`${i}|${j}`)||0);if(!obs)continue;
    const railKm=prefix[j]-prefix[i],rail=railKm/params.velocitatTren*60+Math.max(0,j-i-1)*params.tempsParada+2*params.tempsAcces+sched;
    const roadKm=hav(st[i],st[j])*params.sensibilitatDistancia,car=roadKm/params.velocitatCotxe*60+CAR_FIXED,p=modal(rail-car),cap=obs*params.fraccioCotxeActual*p,veh=cap/CAR_OCC;
    observed+=obs;captured+=cap;vehicles+=veh;vkm+=veh*roadKm;flows.push({a:st[i],b:st[j],v:cap});
  }
  const infra=infrastructureKm(coords);
  const tunnelKm=(l.analysis?.structures||[]).filter(s=>s.kind==='tunnel').reduce((s,x)=>s+x.lengthKm,0);
  const viaductKm=(l.analysis?.structures||[]).filter(s=>s.kind==='viaduct').reduce((s,x)=>s+x.lengthKm,0);
  const existing=Math.min(infra.existing,Math.max(0,len-tunnelKm-viaductKm));
  const surface=Math.max(0,len-existing-tunnelKm-viaductKm);
  const station=stationAssessment(st);
  const trackCost=existing*EXISTING_COST+surface*params.costPerKm+tunnelKm*params.tunnelCost+viaductKm*params.viaductCost;
  const cost=trackCost+station.cost;
  return {
    n,len,st,popDirect,popCatch,observed,captured,vehicles,
    co2:vkm*params.emissioPerKm*params.diesPerAny/1000,
    cost,trackCost,stationCost:station.cost,
    stationNew:station.newCount,stationReused:station.reusedCount,
    stationMatches:station.matches,stationNewNames:station.newStations,
    shared:za.shared,flows,existing,surface,tunnelKm,viaductKm,
    maxGradient:l.analysis?.maxGradient||null
  };
}
/* ---------------- coarse terrain / A* ---------------- */
function llToUtm31(lon,lat){const a=6378137,f=1/298.257223563,k0=.9996,e=Math.sqrt(f*(2-f)),ep2=e*e/(1-e*e),r=lat*Math.PI/180,L=lon*Math.PI/180,L0=3*Math.PI/180,N=a/Math.sqrt(1-e*e*Math.sin(r)**2),T=Math.tan(r)**2,C=ep2*Math.cos(r)**2,A=Math.cos(r)*(L-L0),M=a*((1-e*e/4-3*e**4/64-5*e**6/256)*r-(3*e*e/8+3*e**4/32+45*e**6/1024)*Math.sin(2*r)+(15*e**4/256+45*e**6/1024)*Math.sin(4*r)-(35*e**6/3072)*Math.sin(6*r));const x=500000+k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120),y=k0*(M+N*Math.tan(r)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720));return [x,y];}
function utm31ToLL(x,y){const a=6378137,f=1/298.257223563,k0=.9996,e=Math.sqrt(f*(2-f)),ep2=e*e/(1-e*e),M=y/k0,mu=M/(a*(1-e*e/4-3*e**4/64-5*e**6/256)),e1=(1-Math.sqrt(1-e*e))/(1+Math.sqrt(1-e*e)),J1=3*e1/2-27*e1**3/32,J2=21*e1*e1/16-55*e1**4/32,J3=151*e1**3/96,J4=1097*e1**4/512,fp=mu+J1*Math.sin(2*mu)+J2*Math.sin(4*mu)+J3*Math.sin(6*mu)+J4*Math.sin(8*mu),C1=ep2*Math.cos(fp)**2,T1=Math.tan(fp)**2,N1=a/Math.sqrt(1-e*e*Math.sin(fp)**2),R1=a*(1-e*e)/Math.pow(1-e*e*Math.sin(fp)**2,1.5),D=(x-500000)/(N1*k0),lat=fp-(N1*Math.tan(fp)/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720),lon=3*Math.PI/180+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)/Math.cos(fp);return [lon*180/Math.PI,lat*180/Math.PI];}
function terrainReady(){return TERRAIN_COARSE&&Array.isArray(TERRAIN_COARSE.values)&&TERRAIN_COARSE.values.length>0;}
function terrainCell(ll){if(!terrainReady())return null;const [x,y]=llToUtm31(ll[0],ll[1]),b=TERRAIN_COARSE.bbox,res=+TERRAIN_COARSE.resolution_m,w=+TERRAIN_COARSE.width,h=+TERRAIN_COARSE.height,col=Math.floor((x-b[0])/res),row=Math.floor((b[3]-y)/res);return col>=0&&row>=0&&col<w&&row<h?[col,row]:null;}
function elev(c){const [x,y]=c,w=+TERRAIN_COARSE.width,v=+TERRAIN_COARSE.values[y*w+x];return v===+TERRAIN_COARSE.nodata?null:v;}
class Heap{constructor(){this.a=[]}push(x){this.a.push(x);let i=this.a.length-1;while(i){let p=(i-1)>>1;if(this.a[p][0]<=x[0])break;this.a[i]=this.a[p];i=p}this.a[i]=x}pop(){if(!this.a.length)return null;const root=this.a[0],last=this.a.pop();if(this.a.length){let i=0;this.a[0]=last;while(true){let l=i*2+1,r=l+1,b=i;if(l<this.a.length&&this.a[l][0]<this.a[b][0])b=l;if(r<this.a.length&&this.a[r][0]<this.a[b][0])b=r;if(b===i)break;[this.a[i],this.a[b]]=[this.a[b],this.a[i]];i=b}}return root}get length(){return this.a.length}}
function distPointSegCells(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(!l2)return Math.hypot(p[0]-a[0],p[1]-a[1]);const u=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2,0,1);return Math.hypot(p[0]-(a[0]+u*dx),p[1]-(a[1]+u*dy));}
function distToTrace(c,t){
  if(!t?.length)return Infinity;
  if(t.length===1)return Math.hypot(c[0]-t[0][0],c[1]-t[0][1]);
  let d=Infinity;
  for(let i=1;i<t.length;i++)d=Math.min(d,distPointSegCells(c,t[i-1],t[i]));
  return d;
}
function terrainRoute(l,allowTunnel=false){if(!terrainReady())return null;let trace=(l.alignment?.length>1?l.alignment:l.stations.map(id=>[+muniById[id].lon,+muniById[id].lat])).map(terrainCell).filter(Boolean);if(trace.length<2)return null;const start=trace[0],goal=trace.at(-1),res=+TERRAIN_COARSE.resolution_m,w=+TERRAIN_COARSE.width,h=+TERRAIN_COARSE.height,corridor=Math.max(6,Math.round(SEARCH_CORRIDOR_M/res)),heap=new Heap(),key=(x,y)=>y*w+x,best=new Map([[key(...start),0]]),parent=new Map();heap.push([0,0,start]);let found=null,iterations=0;while(heap.length&&iterations++<250000){const cur=heap.pop(),g=cur[1],[x,y]=cur[2],k=key(x,y);if(g!==best.get(k))continue;if(x===goal[0]&&y===goal[1]){found=[x,y];break}const z=elev([x,y]);if(z===null)continue;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;if(distToTrace([nx,ny],trace)>corridor)continue;const nz=elev([nx,ny]);if(nz===null)continue;const step=Math.hypot(dx,dy)*res,grade=Math.abs(nz-z)/step*1000;if(grade>params.maxGradient&&!allowTunnel)continue;let cost=step+distToTrace([nx,ny],trace)*res*.04;if(grade>25)cost+=(grade-25)*8;if(grade>params.maxGradient)cost+=step*4+(grade-params.maxGradient)*120;const nk=key(nx,ny),ng=g+cost;if(ng<(best.get(nk)??Infinity)){best.set(nk,ng);parent.set(nk,k);heap.push([ng+Math.hypot(goal[0]-nx,goal[1]-ny)*res,ng,[nx,ny]])}}}if(!found)return null;const cells=[];let k=key(...found);while(true){cells.push([k%w,Math.floor(k/w)]);if(k===key(...start))break;k=parent.get(k);if(k===undefined)return null}cells.reverse();return cells;}
function analyzeTerrain(l){if(!terrainReady())return {warning:'No hi ha DEM runtime. Executa python -m pipelines.download_terrain'};let cells=terrainRoute(l,false),surface=!!cells,usedTunnel=false;if(!cells){cells=terrainRoute(l,true);usedTunnel=true}if(!cells)return {warning:`No s’ha pogut trobar un camí continu al DEM dins d’un corredor de ±${Math.round(SEARCH_CORRIDOR_M/1000)} km al voltant del traçat. Revisa el traçat o amplia el marge de cerca.`};const res=+TERRAIN_COARSE.resolution_m,terr=cells.map(elev),dist=[0];for(let i=1;i<cells.length;i++)dist.push(dist.at(-1)+Math.hypot(cells[i][0]-cells[i-1][0],cells[i][1]-cells[i-1][1])*res);const rail=[...terr],g=params.maxGradient/1000;for(let pass=0;pass<6;pass++){for(let i=1;i<rail.length;i++){const ds=dist[i]-dist[i-1];rail[i]=clamp(rail[i],rail[i-1]-g*ds,rail[i-1]+g*ds)}for(let i=rail.length-2;i>=0;i--){const ds=dist[i+1]-dist[i];rail[i]=clamp(rail[i],rail[i+1]-g*ds,rail[i+1]+g*ds)}rail[0]=terr[0];rail[rail.length-1]=terr.at(-1)}const kind=terr.map((z,i)=>z-rail[i]>25?'tunnel':rail[i]-z>18?'viaduct':'surface'),structures=[];let s=0;for(let i=1;i<=kind.length;i++){if(i===kind.length||kind[i]!==kind[s]){const len=(dist[i-1]-dist[s])/1000;if(kind[s]!=='surface'&&len>=.25)structures.push({kind:kind[s],startKm:dist[s]/1000,endKm:dist[i-1]/1000,lengthKm:len});s=i}}if(usedTunnel&&!structures.some(x=>x.kind==='tunnel')){let peak=0,pd=-Infinity;terr.forEach((z,i)=>{if(z-rail[i]>pd){pd=z-rail[i];peak=i}});let a=Math.max(0,peak-2),b=Math.min(cells.length-1,peak+2);structures.push({kind:'tunnel',startKm:dist[a]/1000,endKm:dist[b]/1000,lengthKm:(dist[b]-dist[a])/1000})}let maxG=0;for(let i=1;i<rail.length;i++)maxG=Math.max(maxG,Math.abs(rail[i]-rail[i-1])/(dist[i]-dist[i-1])*1000);const b=TERRAIN_COARSE.bbox,coords=cells.map(([x,y])=>utm31ToLL(b[0]+(x+.5)*res,b[3]-(y+.5)*res));return {surfaceFeasible:surface,usedTunnel,optimizedCoords:coords,terrain:terr,rail,distKm:dist.map(x=>x/1000),structures,maxGradient:maxG,warning:usedTunnel?'No s’ha trobat una alternativa superficial raonable dins del corredor: es proposen obres subterrànies.':null};}

/* ---------------- line editing ---------------- */
function newLine(seedStation=null,seedPoint=null){state.counter++;const l={id:`linia-${state.counter}`,name:`Línia ${state.counter}`,color:COLORS[(state.counter-1)%COLORS.length],stations:seedStation?[seedStation]:[],alignment:seedPoint?[seedPoint]:[],analysis:null};state.lines.push(l);state.activeId=l.id;return l;}
function activeLine(){return state.lines.find(l=>l.id===state.activeId)||null;}
function addStation(id){let l=activeLine();if(!l)l=newLine(id,null);else if(!l.stations.includes(id))l.stations.push(id);l.analysis=null;save();render();}
function addTracePoint(ll){let l=activeLine();if(!l)l=newLine(null,ll);else l.alignment.push(ll);l.analysis=null;save();render();}
function undo(){const l=activeLine();if(!l)return;if(state.tool==='trace'&&l.alignment.length)l.alignment.pop();else if(l.stations.length)l.stations.pop();l.analysis=null;if(!l.stations.length&&!l.alignment.length){state.lines=state.lines.filter(x=>x!==l);state.activeId=null}save();render();}
function finishTrace(){const l=activeLine();if(!l)return;if(terrainReady()&&lineCoords(l).length>1)l.analysis=analyzeTerrain(l);state.activeId=null;save();render();}

/* ---------------- map interactions ---------------- */
function zoomFactor(){return BASE.w/state.vb.w}function screenPosXY(x,y){const p=svg.createSVGPoint();p.x=x;p.y=y;const c=svg.getScreenCTM();if(!c)return null;const s=p.matrixTransform(c);return [s.x,s.y]}
function nearestMuni(cx,cy,r=28){let best=null,bd=r*r;for(const m of MUNICIPIS){const s=screenPosXY(m.x,m.y);if(!s)continue;const d=(s[0]-cx)**2+(s[1]-cy)**2;if(d<bd){bd=d;best=m}}return best}
function svgPoint(cx,cy){const r=svg.getBoundingClientRect();return [state.vb.x+(cx-r.left)/r.width*state.vb.w,state.vb.y+(cy-r.top)/r.height*state.vb.h]}
function zoom(f,cx,cy){const [px,py]=svgPoint(cx,cy),nw=clamp(state.vb.w*f,BASE.w/16,BASE.w*2.5),nh=nw*BASE.h/BASE.w;state.vb.x=px-(px-state.vb.x)*(nw/state.vb.w);state.vb.y=py-(py-state.vb.y)*(nh/state.vb.h);state.vb.w=nw;state.vb.h=nh;save();renderMap()}
svg.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.15:1/1.15,e.clientX,e.clientY)},{passive:false});
let alignmentDrag=null;

svg.addEventListener('pointerdown',e=>{
  const handleIndex=e.target?.dataset?.alignIndex;
  if(handleIndex!==undefined){
    const l=activeLine();
    const idx=Number(handleIndex);
    if(l?.alignment?.[idx]){
      alignmentDrag={lineId:l.id,index:idx};
      dragMoved=false;
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
  dragging=true;dragMoved=false;dragStart=[e.clientX,e.clientY];vbStart={...state.vb};svg.setPointerCapture(e.pointerId)
});

svg.addEventListener('pointermove',e=>{
  if(alignmentDrag){
    const l=state.lines.find(x=>x.id===alignmentDrag.lineId);
    if(l?.alignment?.[alignmentDrag.index]){
      const [x,y]=svgPoint(e.clientX,e.clientY);
      l.alignment[alignmentDrag.index]=unproject(x,y);
      l.analysis=null;
      dragMoved=true;
      renderScenario();
      renderLines();
      renderSummary();
    }
    return;
  }

  if(dragging){
    const dx=e.clientX-dragStart[0],dy=e.clientY-dragStart[1];
    if(Math.hypot(dx,dy)>4)dragMoved=true;
    if(dragMoved){
      const r=svg.getBoundingClientRect();
      state.vb.x=vbStart.x-dx/r.width*vbStart.w;
      state.vb.y=vbStart.y-dy/r.height*vbStart.h;
      renderMap()
    }
    return
  }

  const m=nearestMuni(e.clientX,e.clientY),hb=byId('hover-box');
  hoverId=m?.id||null;
  if(m){
    hb.style.display='block';
    hb.textContent=`${m.nom} · ${fmt(m.pob)} hab. · ${m.com}`
  }else hb.style.display='none';
  renderHover()
});

svg.addEventListener('pointerup',e=>{
  if(alignmentDrag){
    alignmentDrag=null;
    dragMoved=false;
    try{svg.releasePointerCapture(e.pointerId)}catch{}
    save();
    render();
    return;
  }

  const moved=dragMoved;dragging=false;dragMoved=false;
  try{svg.releasePointerCapture(e.pointerId)}catch{}
  if(moved){save();scheduleRoads(true,0);void renderTopo();return}

  const serviceId=e.target?.dataset?.serviceId;
  if(serviceId){importServiceAsEditable(serviceId);return}

  if(state.tool==='stations'){
    const m=nearestMuni(e.clientX,e.clientY);if(m)addStation(m.id)
  }else{
    const [x,y]=svgPoint(e.clientX,e.clientY);addTracePoint(unproject(x,y))
  }
});
svg.addEventListener('mouseleave',()=>{if(!dragging){hoverId=null;byId('hover-box').style.display='none';renderHover()}});

/* ---------------- render layers ---------------- */
function renderOSM(){const base=byId('map-bg'),grid=byId('grid-bg'),layer=byId('capa-osm'),attr=byId('osm-attribution');if(state.layer!=='osm'){layer.innerHTML='';grid.style.display='';base.setAttribute('fill','#0d2a4a');attr.style.display='none';return}grid.style.display='none';base.setAttribute('fill','#e8edf0');attr.style.display='block';const z=clamp(Math.round(7+Math.log2(Math.max(1,zoomFactor()))),6,15),tile=(lon,lat)=>{const n=2**z,r=lat*Math.PI/180;return [(lon+180)/360*n,(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n]},untile=(x,y)=>{const n=2**z,a=Math.PI-2*Math.PI*y/n;return [x/n*360-180,180/Math.PI*Math.atan(Math.sinh(a))]},a=unproject(state.vb.x,state.vb.y),b=unproject(state.vb.x+state.vb.w,state.vb.y+state.vb.h),west=Math.min(a[0],b[0]),east=Math.max(a[0],b[0]),south=Math.min(a[1],b[1]),north=Math.max(a[1],b[1]),t0=tile(west,north),t1=tile(east,south),n=2**z;let html='',count=0;for(let x=clamp(Math.floor(t0[0])-1,0,n-1);x<=clamp(Math.floor(t1[0])+1,0,n-1)&&count<90;x++)for(let y=clamp(Math.floor(t0[1])-1,0,n-1);y<=clamp(Math.floor(t1[1])+1,0,n-1)&&count<90;y++){count++;const p=untile(x,y),q=untile(x+1,y+1),u=project(...p),v=project(...q);html+=`<image href="https://tile.openstreetmap.org/${z}/${x}/${y}.png" x="${Math.min(u[0],v[0])}" y="${Math.min(u[1],v[1])}" width="${Math.abs(v[0]-u[0])}" height="${Math.abs(v[1]-u[1])}" preserveAspectRatio="none"/>`}layer.innerHTML=html}
let comarquesRendered=false;
function renderComarques(){if(!state.layers.comarques){setHTML('capa-comarques','');comarquesRendered=false;return}if(comarquesRendered)return;let h='';COMARQUES.forEach(c=>c.pg.forEach(poly=>{const d=poly.map(r=>'M '+r.map(p=>p.map(v=>v.toFixed(1)).join(' ')).join(' L ')+' Z').join(' ');h+=`<path class="comarca" d="${d}"><title>${esc(c.nom)}</title></path>`}));setHTML('capa-comarques',h);comarquesRendered=true}
let railDisusedRendered=false;
function renderRail(force=false){
  if(!state.layers.rail){setHTML('capa-rail','');railDisusedRendered=false;return}
  if(railDisusedRendered&&!force)return;
  let h='';
  for(const e of RAIL_EDGES){
    if(String(e.estat||'').toLowerCase()!=='dus')continue;
    const p=e._p||(e._p=(e.coords||[]).map(q=>project(q[0],q[1])));
    if(p.length<2)continue;
    const name=e.nom||'línia ferroviària en desús';
    h+=`<path class="rail-existing" d="M ${p.map(q=>`${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L ')}"><title>${esc(name)}</title></path>`;
  }
  setHTML('capa-rail',h);
  railDisusedRendered=true;
}
function roadLod(){
  const z=zoomFactor();
  if(roadLodCurrent===null){
    roadLodCurrent=z<1.20?0:z<1.45?1:z<1.80?2:3;
    return roadLodCurrent;
  }

  // LOD3 entra ja en una escala comarcal útil.
  if(roadLodCurrent===0 && z>=1.28)roadLodCurrent=1;
  else if(roadLodCurrent===1){
    if(z<1.12)roadLodCurrent=0;
    else if(z>=1.55)roadLodCurrent=2;
  }else if(roadLodCurrent===2){
    if(z<1.36)roadLodCurrent=1;
    else if(z>=1.95)roadLodCurrent=3;
  }else if(roadLodCurrent===3 && z<1.68)roadLodCurrent=2;

  return roadLodCurrent;
}
function roadClass(t){
  t=String(t||'').toLowerCase();
  if(['aub','auf'].includes(t))return 'road-motorway';
  if(['vpb','vpf'].includes(t))return 'road-preferent';
  if(t==='vcb')return 'road-basic';
  if(t==='vcc')return 'road-comarcal';
  if(t==='vcl')return 'road-local';
  return 'road-minor';
}
function roadDisplayMeta(row){
  const t=String(row?.t||row?.tipus||'').toLowerCase();
  const code=String(row?.n||row?.nom||row?.name||'').trim().toUpperCase();
  const normalized=code.replace(/\s+/g,'');

  // IMPORTANT: la classificació ICGC mana sobre el nom.
  // Una C-13 no es converteix en autovia només perquè comença per C.
  if(['aub','auf','vpb','vpf'].includes(t)){
    return {kind:'Autopista / autovia',stroke:'#2f64b3',width:4.8,opacity:.98,casing:6.9,rank:5,label:code||'Autopista / autovia'};
  }
  if(t==='vcb'){
    return {kind:'Carretera principal',stroke:'#d93025',width:3.15,opacity:.97,casing:4.75,rank:4,label:code||'Carretera principal'};
  }
  if(['vcc','vcl','vcf','vnc'].includes(t)){
    return {kind:'Carretera local / secundària',stroke:'#e3c321',width:t==='vcc'?1.95:1.45,opacity:t==='vcc'?.92:.78,casing:t==='vcc'?2.9:0,rank:t==='vcc'?3:2,label:code||'Carretera local'};
  }

  // Només si no tenim classe ICGC interpretem el codi.
  if(/^(A|AP)-\d/.test(normalized)){
    return {kind:'Autopista / autovia',stroke:'#2f64b3',width:4.8,opacity:.98,casing:6.9,rank:5,label:code};
  }
  if(/^N-?\d/.test(normalized)){
    return {kind:'Carretera principal',stroke:'#d93025',width:3.15,opacity:.97,casing:4.75,rank:4,label:code};
  }
  if(/^(LV|TV|GV|BV|BP|CP|GIP|TP|LP)-/.test(normalized)){
    return {kind:'Carretera local',stroke:'#e3c321',width:1.45,opacity:.80,casing:0,rank:2,label:code};
  }

  return {kind:'Via secundària',stroke:'#d9cc64',width:1.15,opacity:.60,casing:0,rank:1,label:code||'Via secundària'};
}
function roadKindLabel(t){
  return roadDisplayMeta({t}).kind;
}
function roadStyle(row){
  return roadDisplayMeta(row);
}
async function loadRoadManifest(){
  if(roadManifest)return roadManifest;
  if(!roadManifestPromise){
    roadManifestPromise=fetchJsonStatic('roads/manifest.json')
      .then(x=>(roadManifest=x));
  }
  return roadManifestPromise;
}
async function loadRoadTile(lod,x,y){
  const key=`${lod}:${x}:${y}`;
  if(roadTileCache.has(key))return roadTileCache.get(key);

  const mf=await loadRoadManifest();
  const info=mf?.lods?.[String(lod)]||{};
  const tileName=`${x}_${y}`;

  // L'índex evita demanar teseles inexistents i elimina els 404 antics.
  if(
    Array.isArray(info.available_tiles) &&
    !info.available_tiles.includes(tileName)
  ){
    const empty=Promise.resolve([]);
    roadTileCache.set(key,empty);
    return empty;
  }

  const promise=fetchJsonStatic(
    `roads/lod${lod}/${tileName}.json`
  ).catch(err=>{
    if(String(err).includes('404'))return [];
    console.warn('[Ferrocat] road tile',key,err);
    return [];
  });

  roadTileCache.set(key,promise);
  return promise;
}
function polylineLengthPx(points){
  let s=0;
  for(let i=1;i<points.length;i++)s+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
  return s;
}
function visibleSubpath(points){
  if(!points||points.length<2)return [];
  const padX=state.vb.w*.02,padY=state.vb.h*.02;
  const minX=state.vb.x-padX,maxX=state.vb.x+state.vb.w+padX;
  const minY=state.vb.y-padY,maxY=state.vb.y+state.vb.h+padY;
  const groups=[];let cur=[];
  const segVisible=(a,b)=>{
    const sx0=Math.min(a[0],b[0]),sx1=Math.max(a[0],b[0]);
    const sy0=Math.min(a[1],b[1]),sy1=Math.max(a[1],b[1]);
    return !(sx1<minX||sx0>maxX||sy1<minY||sy0>maxY);
  };
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(segVisible(a,b)){
      if(!cur.length)cur.push(a);
      cur.push(b);
    }else if(cur.length){
      groups.push(cur);cur=[];
    }
  }
  if(cur.length)groups.push(cur);
  if(!groups.length)return [];
  groups.sort((a,b)=>polylineLengthPx(b)-polylineLengthPx(a));
  return groups[0];
}
function lineLabelAnchor(points){
  const visible=visibleSubpath(points);
  if(visible.length<2)return null;
  const total=polylineLengthPx(visible);
  if(total<1)return null;
  const target=total/2;let acc=0;
  for(let i=1;i<visible.length;i++){
    const a=visible[i-1],b=visible[i],seg=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(seg<=0)continue;
    if(acc+seg>=target){
      const r=(target-acc)/seg;
      const x=a[0]+(b[0]-a[0])*r,y=a[1]+(b[1]-a[1])*r;
      let angle=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;
      if(angle>90||angle<-90)angle+=180;
      return {x,y,angle,total};
    }
    acc+=seg;
  }
  return null;
}
function inlineLabelHtml(entries,{font=10,stroke='#091a2d',fill='#f5f7fb',pad=6,max=18,minLength=110,uppercase=false}={}){
  const boxes=[];let shown=0,h='';
  const inv=1/Math.max(.01,zoomFactor());
  for(const entry of entries){
    if(!entry?.text||!entry?.points)continue;
    const info=lineLabelAnchor(entry.points);
    if(!info||info.total<minLength)continue;
    const text=uppercase?String(entry.text).toUpperCase():String(entry.text);
    const sx=(info.x-state.vb.x)/state.vb.w*800;
    const sy=(info.y-state.vb.y)/state.vb.h*660;
    if(sx<-60||sx>860||sy<-30||sy>690)continue;
    const w=Math.max(28,text.length*font*.60);
    const box=[sx-w/2-pad,sy-font-pad,sx+w/2+pad,sy+font*.55+pad];
    if(boxes.some(b=>boxesOverlap(box,b,5)))continue;
    boxes.push(box);
    h+=`<g transform="translate(${info.x.toFixed(2)} ${info.y.toFixed(2)}) rotate(${info.angle.toFixed(1)}) scale(${inv})" pointer-events="none">
      <text x="0" y="0" text-anchor="middle" dominant-baseline="central"
        style="font-family:'IBM Plex Mono',monospace;font-size:${font}px;font-weight:700;letter-spacing:.1px;fill:${fill};stroke:${stroke};stroke-width:2.8;paint-order:stroke fill;user-select:none">${esc(text)}</text>
    </g>`;
    shown++;
    if(shown>=max)break;
  }
  return h;
}
function roadGeometryToSvg(rows){
  let h='';
  const visible=(rows||[]).slice(0,45000)
    .map(e=>({e,st:roadStyle(e)}))
    .sort((a,b)=>a.st.rank-b.st.rank);

  for(const item of visible){
    const e=item.e,st=item.st;
    const coords=e.c||e.coords||[];
    if(!coords||coords.length<2)continue;
    const p=coords.map(q=>project(q[0],q[1]));
    if(p.length<2)continue;
    const d='M '+p.map(q=>`${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L ');
    const label=st.label;

    if(st.casing){
      h+=`<path d="${d}" fill="none" stroke="#081c33"
        stroke-width="${st.casing}" opacity=".88"
        vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    }

    h+=`<path class="road ${roadClass(e.t||e.tipus)}"
      d="${d}" fill="none" stroke="${st.stroke}"
      stroke-width="${st.width}" opacity="${st.opacity}"
      vector-effect="non-scaling-stroke">
      <title>${esc(label)} · ${esc(st.kind)}</title>
    </path>`;
  }
  return h;
}

function roadLabelsToSvg(rows){
  const z=zoomFactor();
  if(z<6.2)return '';

  const labelEntries=[];
  for(const e of (rows||[]).slice(0,45000)){
    const st=roadStyle(e);
    const label=st.label;
    if(!label)continue;
    const coords=e.c||e.coords||[];
    if(!coords||coords.length<2)continue;
    const p=coords.map(q=>project(q[0],q[1]));
    if(p.length<2)continue;
    labelEntries.push({text:label,points:p,rank:st.rank});
  }

  labelEntries.sort(
    (a,b)=>(b.rank||0)-(a.rank||0)||b.points.length-a.points.length
  );

  return inlineLabelHtml(labelEntries,{
    font:z>=10?10:z>=7.5?9.5:9,
    max:z>=10?16:z>=7.5?10:6,
    minLength:z>=10?85:z>=7.5?120:165,
    uppercase:true
  });
}

function roadRowsToSvg(rows){
  return roadGeometryToSvg(rows)+roadLabelsToSvg(rows);
}
let roadOverviewRendered=false,roadDetailActive=false,roadLastRenderKey='';
let roadProgressiveKey='',roadProgressiveRows=[];

function scheduleRoads(force=false,delay=38){
  roadForcePending=roadForcePending||force;
  if(roadRenderTimer!==null)clearTimeout(roadRenderTimer);

  roadRenderTimer=setTimeout(()=>{
    roadRenderTimer=null;
    const f=roadForcePending;
    roadForcePending=false;
    void renderRoads(f);
  },delay);
}

function roadTileBounds(mf,margin=0){
  const ts=+mf.tile_size_m,ox=+mf.origin_x,oy=+mf.origin_y;
  const corners=[
    unproject(state.vb.x,state.vb.y),
    unproject(state.vb.x+state.vb.w,state.vb.y),
    unproject(state.vb.x,state.vb.y+state.vb.h),
    unproject(state.vb.x+state.vb.w,state.vb.y+state.vb.h)
  ].map(q=>llToUtm31(q[0],q[1]));

  const xs=corners.map(q=>q[0]),ys=corners.map(q=>q[1]);

  return {
    minX:clamp(Math.floor((Math.min(...xs)-ox)/ts)-margin,0,mf.nx-1),
    maxX:clamp(Math.floor((Math.max(...xs)-ox)/ts)+margin,0,mf.nx-1),
    minY:clamp(Math.floor((Math.min(...ys)-oy)/ts)-margin,0,mf.ny-1),
    maxY:clamp(Math.floor((Math.max(...ys)-oy)/ts)+margin,0,mf.ny-1)
  };
}

function sortedRoadTiles(bounds){
  const cx=(bounds.minX+bounds.maxX)/2;
  const cy=(bounds.minY+bounds.maxY)/2;
  const out=[];

  for(let x=bounds.minX;x<=bounds.maxX;x++){
    for(let y=bounds.minY;y<=bounds.maxY;y++){
      out.push({x,y,d:(x-cx)*(x-cx)+(y-cy)*(y-cy)});
    }
  }

  out.sort((a,b)=>a.d-b.d);
  return out;
}

function roadLayer(){
  return byId('capa-carreteres');
}

function beginProgressiveRoadLayer(renderKey){
  const layer=roadLayer();
  if(!layer)return;

  // Substituïm immediatament qualsevol detall vell pel LOD0 global.
  // Així mai queden teseles d'una finestra anterior fent veure que "falta"
  // mitja Catalunya.
  const overview=Array.isArray(ROADS)&&ROADS.length
    ? roadGeometryToSvg(ROADS)
    : '';

  layer.innerHTML=
    `<g data-road-overview opacity=".42">${overview}</g>`+
    `<g data-road-detail></g>`+
    `<g data-road-labels></g>`;

  roadProgressiveKey=renderKey;
  roadProgressiveRows=[];
}

function appendRoadTile(renderKey,tileKey,rows){
  if(renderKey!==roadProgressiveKey)return;
  const layer=roadLayer();
  const detail=layer?.querySelector('[data-road-detail]');
  if(!detail)return;

  const ns='http://www.w3.org/2000/svg';
  const group=document.createElementNS(ns,'g');
  group.setAttribute('data-road-tile',tileKey);
  group.innerHTML=roadGeometryToSvg(rows);
  detail.appendChild(group);

  if(Array.isArray(rows)&&rows.length){
    roadProgressiveRows.push(...rows);
  }
}

function finishProgressiveRoadLayer(renderKey){
  if(renderKey!==roadProgressiveKey)return;
  const layer=roadLayer();
  if(!layer)return;

  const overview=layer.querySelector('[data-road-overview]');
  if(overview)overview.remove();

  const labels=layer.querySelector('[data-road-labels]');
  if(labels)labels.innerHTML=roadLabelsToSvg(roadProgressiveRows);
}

async function prefetchRoadTiles(lod,bounds){
  const jobs=[];
  for(let x=bounds.minX;x<=bounds.maxX;x++){
    for(let y=bounds.minY;y<=bounds.maxY;y++){
      jobs.push(loadRoadTile(lod,x,y));
    }
  }
  await Promise.allSettled(jobs);
}

async function renderRoads(force=false){
  const generation=++roadRenderGeneration;

  if(!state.layers.roads){
    setHTML('capa-carreteres','');
    roadOverviewRendered=false;
    roadDetailActive=false;
    roadLastRenderKey='';
    roadProgressiveKey='';
    return;
  }

  // Durant l'arrossegament no fem I/O; pointerup força càrrega immediata.
  if(dragging)return;

  const lod=roadLod();

  if(lod===0 && Array.isArray(ROADS) && ROADS.length){
    if(!roadOverviewRendered||roadDetailActive||force){
      setHTML('capa-carreteres',roadRowsToSvg(ROADS));
      roadOverviewRendered=true;
      roadDetailActive=false;
      roadLastRenderKey='overview';
      roadProgressiveKey='';
    }
    return;
  }

  try{
    const mf=await loadRoadManifest();
    if(generation!==roadRenderGeneration||!state.layers.roads)return;

    // Primer només les teseles que toquen realment el viewport.
    // L'anell exterior es precarrega DESPRÉS i no bloqueja la pintura.
    const core=roadTileBounds(mf,0);
    const renderKey=`${lod}:${core.minX}:${core.maxX}:${core.minY}:${core.maxY}`;

    if(!force && roadDetailActive && renderKey===roadLastRenderKey)return;

    beginProgressiveRoadLayer(renderKey);

    const tiles=sortedRoadTiles(core);

    // Centre -> exterior. Cada tesela es pinta tan bon punt arriba.
    const promises=tiles.map(async tile=>{
      const rows=await loadRoadTile(lod,tile.x,tile.y);
      if(
        generation!==roadRenderGeneration ||
        !state.layers.roads ||
        renderKey!==roadProgressiveKey
      )return;

      appendRoadTile(
        renderKey,
        `${lod}:${tile.x}:${tile.y}`,
        Array.isArray(rows)?rows:[]
      );
    });

    await Promise.allSettled(promises);

    if(
      generation!==roadRenderGeneration ||
      !state.layers.roads ||
      renderKey!==roadProgressiveKey
    )return;

    finishProgressiveRoadLayer(renderKey);

    roadOverviewRendered=false;
    roadDetailActive=true;
    roadLastRenderKey=renderKey;

    // Precàrrega de l'anell adjacent sense bloquejar el que veu l'usuari.
    const ring=roadTileBounds(mf,1);
    void prefetchRoadTiles(lod,ring);

    // Si encara no som a LOD3, precàrrega també el mateix viewport
    // del següent nivell. El següent zoom sol ser pràcticament instantani.
    if(lod<3){
      void prefetchRoadTiles(lod+1,core);
    }

  }catch(err){
    if(generation===roadRenderGeneration){
      if(Array.isArray(ROADS)&&ROADS.length){
        setHTML('capa-carreteres',roadRowsToSvg(ROADS));
        roadOverviewRendered=true;
        roadDetailActive=false;
        roadLastRenderKey='overview-fallback';
        roadProgressiveKey='';
      }
      console.warn(
        '[Ferrocat] Error carregant carreteres detallades; es manté LOD0.',
        err
      );
    }
  }
}
function offsetSegment(a,b,offsetBase){const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1,nx=-dy/l,ny=dx/l;return [[a[0]+nx*offsetBase,a[1]+ny*offsetBase],[b[0]+nx*offsetBase,b[1]+ny*offsetBase]]}

function simplifyLine(points,epsilon){
  if(points.length<3)return points;
  const sq=epsilon*epsilon;
  const out=[points[0]];
  let anchor=points[0];
  for(let i=1;i<points.length-1;i++){
    const p=points[i];
    const dx=p[0]-anchor[0],dy=p[1]-anchor[1];
    if(dx*dx+dy*dy>=sq){out.push(p);anchor=p;}
  }
  out.push(points.at(-1));
  return out;
}
function pathD(points){
  return points.length<2?'':'M '+points.map(q=>`${q[0].toFixed(2)} ${q[1].toFixed(2)}`).join(' L ');
}
const FGC_LINE_COLORS={L8:'#e3a0c8',S3:'#6c9ea8',S4:'#9a8500',S8:'#47b7d8',S9:'#e65474',R5:'#34a4bd',R50:'#2d8197',R6:'#b0b0b4',R60:'#6d6f79',RL1:'#9d9fa6',RL2:'#74c928',R12:'#f0bf00',R13:'#cf5da0',R14:'#775fb7'};
const TMB_LINE_COLORS={L1:'#d71920',L2:'#8a3ab9',L3:'#1f9d45',L4:'#f3c300',L5:'#1f77d0',L9N:'#d98c18',L9S:'#d98c18',L10N:'#22b6ea',L10S:'#22b6ea',L11:'#8bd146',FM:'#0a7b57'};
function cleanRouteCode(v){return String(v||'').trim().replace(/\s+/g,'').toUpperCase();}
function renfeFamily(svc){
  const short=cleanRouteCode(svc.route_short_name||svc.name||'');
  const text=`${short} ${(svc.route_long_name||svc.name||'')}`.toUpperCase();
  if(/^R\d+/.test(short)||/^RG\d+/.test(short)||/^RT\d+/.test(short)||/^RL\d+/.test(short)||String(svc.dataset||'').includes('cercanias'))return 'rodalies';
  if(/\bAVE\b|\bAVLO\b/.test(text))return 'ave';
  if(/\bMD\b|MEDIA DISTANCIA|REGIONAL|REGIO/.test(text))return 'media_distancia';
  return 'llarga_distancia';
}
function serviceStyleMeta(svc){
  const agency=String(svc.agency||'').toLowerCase();
  const code=cleanRouteCode(svc.route_short_name||svc.name||'');
  const longName=String(svc.route_long_name||svc.name||'').trim();
  if(agency==='renfe'){
    const fam=renfeFamily(svc);
    if(fam==='rodalies')return {color:'#f28c00',width:2.15,casing:3.3,opacity:.95,label:code||'RODALIES'};
    if(fam==='ave')return {color:'#b07ad9',width:2.3,casing:3.5,opacity:.96,label:code||'AVE'};
    if(fam==='media_distancia')return {color:'#9aa0a6',width:1.95,casing:3.0,opacity:.92,label:code||'MD'};
    return {color:'#cf2e2e',width:2.1,casing:3.2,opacity:.94,label:code||'LD'};
  }
  if(agency==='fgc'){
    let color=FGC_LINE_COLORS[code]||null;
    if(!color && /NURIA|NÚRIA/.test(longName.toUpperCase()))color='#1976ff';
    if(!color && /MONTSERRAT/.test(longName.toUpperCase()))color='#2e8b57';
    return {color:color||'#2a9d8f',width:2.05,casing:3.2,opacity:.96,label:code||longName||'FGC'};
  }
  if(agency==='tmb'){
    return {color:TMB_LINE_COLORS[code]||'#d71920',width:2.25,casing:3.45,opacity:.97,label:code||longName||'TMB'};
  }
  if(agency==='tram'){
    return {color:'#159b59',width:2.2,casing:3.35,opacity:.97,label:code||longName||'TRAM'};
  }
  return {color:svc.color||'#ffffff',width:1.8,casing:2.8,opacity:.92,label:code||longName||agency.toUpperCase()};
}
function stableHash(text){
  let h=2166136261>>>0;
  for(const ch of String(text||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return h>>>0;
}
function routeDisplayName(svc){
  const generic=new Set(['RENFE','RENFE OPERADORA','FGC','TMB','TRAM','']);
  const short=String(svc.route_short_name||'').trim();
  const longName=String(svc.route_long_name||'').trim();
  const routeId=String(svc.route_id||'').trim();
  const rawName=String(svc.name||'').trim();
  if(short&&!generic.has(short.toUpperCase()))return short;
  if(longName&&!generic.has(longName.toUpperCase()))return longName;
  if(routeId&&!generic.has(routeId.toUpperCase()))return routeId;
  if(rawName&&!generic.has(rawName.toUpperCase()))return rawName;
  return `${String(svc.agency||'').toUpperCase()} ${routeId||'servei'}`.trim();
}
function offsetPolyline(points,offsetPx){
  if(!points||points.length<2||Math.abs(offsetPx)<.05)return points;
  const rect=svg.getBoundingClientRect();
  const mapPerPx=state.vb.w/Math.max(300,rect.width);
  const off=offsetPx*mapPerPx;
  const out=[];
  for(let i=0;i<points.length;i++){
    const p=points[i];
    const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];
    const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
    out.push([p[0]-dy/len*off,p[1]+dx/len*off]);
  }
  return out;
}
function serviceLanePx(svc){
  const key=`${svc.agency}|${svc.route_id||svc.route_short_name||svc.name}`;
  const lane=(stableHash(key)%9)-4;
  return lane*.95;
}
const SERVICE_CACHE=RAIL_SERVICES.map((svc,idx)=>{
  const agency=String(svc.agency||'').toLowerCase();

  // Rodalies/Cercanías: conservem el fallback que ja funcionava visualment.
  // AV/LD/MD: NO acceptem unir estacions amb rectes llargues.
  if(
    agency==='renfe' &&
    String(svc.dataset||'').toLowerCase()==='renfe_ld' &&
    String(svc.geometry_source||'').toLowerCase()==='stop_sequence_fallback'
  )return null;
  const hasPrecomputedLod=Array.isArray(svc.lods)&&svc.lods.length;
  const ll=hasPrecomputedLod
    ? svc.lods.map(coords=>(coords||[]).map(q=>[+q[0],+q[1]]))
    : [svc.coords||[],svc.coords||[],svc.coords||[],svc.coords||[]].map(coords=>(coords||[]).map(q=>[+q[0],+q[1]]));
  const projected=ll.map(coords=>coords.map(q=>project(q[0],q[1])));
  const id=String(svc.id||svc.route_id||idx);
  const style=serviceStyleMeta(svc);
  return {
    agency,
    mode:String(svc.mode||'heavy_rail').toLowerCase(),
    id,
    route_id:String(svc.route_id||''),
    route_short_name:String(svc.route_short_name||''),
    route_long_name:String(svc.route_long_name||''),
    dataset:String(svc.dataset||''),
    name:routeDisplayName(svc),
    operator:String(svc.operator||agency.toUpperCase()),
    minZoom:Number.isFinite(+svc.min_zoom)?+svc.min_zoom:0,
    ll,
    projected,
    style,
    lanePx:serviceLanePx(svc)
  };
}).filter(svc=>svc.projected.some(p=>p.length>1));

const SERVICE_BY_ID=new Map(SERVICE_CACHE.map(s=>[s.id,s]));

function serviceEditableName(svc){
  const code=String(svc.route_short_name||'').trim();
  const longName=String(svc.route_long_name||'').trim();
  if(code&&longName&&!longName.toUpperCase().includes(code.toUpperCase()))return `${code} — ${longName}`;
  return code||longName||svc.name||`${svc.operator} ${svc.route_id}`;
}
function decimateAlignment(coords,maxPoints=1200){
  if(coords.length<=maxPoints)return coords.map(p=>[+p[0],+p[1]]);
  const step=(coords.length-1)/(maxPoints-1),out=[];
  for(let i=0;i<maxPoints;i++){
    const p=coords[Math.round(i*step)];
    out.push([+p[0],+p[1]]);
  }
  return out;
}
function importServiceAsEditable(serviceId){
  const svc=SERVICE_BY_ID.get(String(serviceId));
  if(!svc)return;
  const existing=state.lines.find(l=>l.sourceServiceId===svc.id);
  if(existing){
    state.activeId=existing.id;
    state.tool='trace';
    save();render();
    const sel=byId('tool-select');if(sel)sel.value='trace';
    return;
  }
  const detailed=(svc.ll[3]?.length>1?svc.ll[3]:svc.ll[2]?.length>1?svc.ll[2]:svc.ll[1]?.length>1?svc.ll[1]:svc.ll[0])||[];
  if(detailed.length<2)return;
  state.counter++;
  const l={
    id:`linia-${state.counter}`,
    name:serviceEditableName(svc).slice(0,100),
    color:svc.style.color,
    stations:[],
    alignment:decimateAlignment(detailed,220),
    sourceServiceId:svc.id,
    sourceAgency:svc.agency,
    sourceRoute:svc.route_id||svc.route_short_name||svc.name,
    analysis:null
  };
  state.lines.push(l);
  state.activeId=l.id;
  state.tool='trace';
  save();
  const sel=byId('tool-select');if(sel)sel.value='trace';
  render();
}

let lastServiceRenderKey='';
function serviceLod(){
  const z=zoomFactor();
  // No fem servir mai el LOD0 d'1 km dels runtimes antics:
  // era massa agressiu per representar una via ferroviària.
  return z<1.75?1:(z<3.5?2:3);
}
function serviceEnabled(agency){
  if(agency==='renfe')return !!state.layers.renfe;
  if(agency==='fgc')return !!state.layers.fgc;
  if(agency==='tmb')return !!state.layers.tmb;
  if(agency==='tram')return !!state.layers.tram;
  return false;
}
function renderServices(force=false){
  const lod=serviceLod(),z=zoomFactor();
  const urbanBand=z>=3.8?2:(z>=3?1:0);
  const key=`${state.layers.renfe?1:0}${state.layers.fgc?1:0}${state.layers.tmb?1:0}${state.layers.tram?1:0}:${lod}:${urbanBand}:${state.vb.w.toFixed(1)}`;
  if(!force&&key===lastServiceRenderKey)return;
  lastServiceRenderKey=key;

  if(!state.layers.renfe&&!state.layers.fgc&&!state.layers.tmb&&!state.layers.tram){
    setHTML('capa-serveis','');return;
  }

  let h='';
  const labels=[];
  const importedIds=new Set(state.lines.map(l=>l.sourceServiceId).filter(Boolean));
  for(const svc of SERVICE_CACHE){
    if(importedIds.has(svc.id))continue;
    if(!serviceEnabled(svc.agency)||z<svc.minZoom)continue;
    const useLod=Math.min(lod,svc.projected.length-1);
    const basePoints=svc.projected[useLod];
    if(!basePoints||basePoints.length<2)continue;

    // Stable screen-space lateral lane: shared infrastructure stays visible.
    const points=offsetPolyline(basePoints,svc.lanePx);
    const path=pathD(points);
    if(!path)continue;

    const st=svc.style;
    if(st.casing){
      h+=`<path d="${path}" fill="none" stroke="#08172a" stroke-width="${st.casing}" opacity=".90" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    }
    h+=`<path class="service-stripe service-${svc.agency}" data-service-id="${esc(svc.id)}"
      d="${path}" stroke="${esc(st.color)}" stroke-width="${st.width}" opacity="${st.opacity}"
      vector-effect="non-scaling-stroke" pointer-events="stroke" style="cursor:pointer">
      <title>${esc(svc.name)} · ${esc(svc.operator)} · Clica per convertir-la en línia editable</title>
    </path>`;

    // No generic operator labels. Only the actual route/service name.
    if(z>=6.8&&svc.name)labels.push({text:svc.name,points,rank:st.width});
  }

  labels.sort((a,b)=>(b.rank||0)-(a.rank||0));
  h+=inlineLabelHtml(labels,{
    font:z>=10?10:z>=8?9.5:9,
    max:z>=10?14:z>=8?9:5,
    minLength:z>=10?70:z>=8?105:150,
    uppercase:false
  });
  setHTML('capa-serveis',h);
}
function scenarioSegmentGroups(){const map=new Map();state.lines.forEach(l=>{const c=lineCoords(l);for(let i=1;i<c.length;i++){const a=c[i-1],b=c[i],ka=`${a[0].toFixed(5)},${a[1].toFixed(5)}`,kb=`${b[0].toFixed(5)},${b[1].toFixed(5)}`,key=ka<kb?ka+'|'+kb:kb+'|'+ka;if(!map.has(key))map.set(key,{a:project(...a),b:project(...b),lines:[]});map.get(key).lines.push(l)}});return map}
function renderScenario(){
  const groups=scenarioSegmentGroups(),
        pxBase=state.vb.w/Math.max(300,svg.getBoundingClientRect().width),
        stripe=2.7,gap=.6;
  let h='';

  groups.forEach(g=>{
    const ls=[...g.lines].sort((a,b)=>a.id.localeCompare(b.id)),n=ls.length;
    ls.forEach((l,i)=>{
      const off=(i-(n-1)/2)*(stripe+gap)*pxBase,[a,b]=offsetSegment(g.a,g.b,off);
      h+=`<path class="scenario-stripe" d="M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}"
        stroke="${l.color}" stroke-width="${stripe+(l.id===state.activeId?.4:0)}"/>`
    })
  });

  const l=activeLine();
  if(l?.alignment?.length){
    const p=l.alignment.map(q=>project(...q));
    h+=`<path class="trace-line" d="M ${p.map(q=>q.join(' ')).join(' L ')}"/>`;

    // Màxim ~70 nodes visibles: suficient per editar sense matar el DOM.
    const stride=Math.max(1,Math.ceil(p.length/70));
    for(let i=0;i<p.length;i+=stride){
      const q=p[i];
      h+=`<circle class="alignment-handle" data-align-index="${i}"
        cx="${q[0]}" cy="${q[1]}" r="${4/Math.max(.01,zoomFactor())}"/>`;
    }
    if((p.length-1)%stride!==0){
      const i=p.length-1,q=p[i];
      h+=`<circle class="alignment-handle" data-align-index="${i}"
        cx="${q[0]}" cy="${q[1]}" r="${4/Math.max(.01,zoomFactor())}"/>`;
    }
  }

  setHTML('capa-linies',h)
}
function renderFlows(){if(!state.layers.flows){setHTML('capa-fluxos','');return}let h='';state.lines.forEach(l=>metrics(l).flows.forEach(f=>{if(f.v<5)return;const a=[f.a.x,f.a.y],b=[f.b.x,f.b.y],w=clamp(Math.log10(f.v+1)*1.5,.6,5);h+=`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${l.color}" stroke-width="${w}" opacity=".35" stroke-dasharray="6 7" vector-effect="non-scaling-stroke"/>`}));setHTML('capa-fluxos',h)}
function labelThreshold(){
  const z=zoomFactor();
  return z>=12?0:z>=9?250:z>=7?700:z>=5?1800:z>=3.5?4500:z>=2.4?10000:z>=1.6?22000:50000;
}
function labelsLimit(){
  const z=zoomFactor();
  return z>=10?220:z>=7?150:z>=5?100:z>=3?65:z>=2?42:28;
}
function boxesOverlap(a,b,p=4){
  return !(a[2]+p<b[0]||a[0]-p>b[2]||a[3]+p<b[1]||a[1]-p>b[3]);
}
function renderMunicipis(){
  const stations=new Map();
  state.lines.forEach(l=>l.stations.forEach(id=>{if(!stations.has(id))stations.set(id,l)}));
  const z=Math.max(.01,zoomFactor()),inv=1/z;
  let h='';
  MUNICIPIS.forEach(m=>{
    const sx=(m.x-state.vb.x)/state.vb.w*800,sy=(m.y-state.vb.y)/state.vb.h*660;
    if(sx<-20||sx>820||sy<-20||sy>680)return;
    if(stations.has(m.id)){
      const l=stations.get(m.id);
      h+=`<g transform="translate(${m.x} ${m.y}) scale(${inv})"><circle class="station" r="5" stroke="${l.color}"/></g>`;
    }else{
      const r=clamp(Math.sqrt(Math.max(1,m.pob))/150+1.1,1.2,8);
      h+=`<g transform="translate(${m.x} ${m.y}) scale(${inv})"><circle class="municipi" r="${r}"/></g>`;
    }
  });

  const cand=MUNICIPIS
    .filter(m=>stations.has(m.id)||m.pob>=labelThreshold())
    .sort((a,b)=>(stations.has(b.id)?1:0)-(stations.has(a.id)?1:0)||b.pob-a.pob);

  const boxes=[];
  let shown=0;
  const max=labelsLimit();
  for(const m of cand){
    const sx=(m.x-state.vb.x)/state.vb.w*800,sy=(m.y-state.vb.y)/state.vb.h*660;
    if(sx<-100||sx>900||sy<-30||sy>690)continue;
    const isStation=stations.has(m.id);
    const font=isStation?11:10;
    const dx=isStation?11:7;
    const w=Math.max(24,m.nom.length*font*.61);
    const box=[sx+dx,sy-font*.85,sx+dx+w,sy+font*.35];
    if(!isStation&&boxes.some(b=>boxesOverlap(box,b,4)))continue;
    boxes.push(box);
    h+=`<g transform="translate(${m.x} ${m.y}) scale(${inv})"><text class="label ${isStation?'station-label':''}" x="${dx}" y="3.5" style="font-size:${font}px">${esc(m.nom)}</text></g>`;
    shown++;
    if(shown>=max)break;
  }
  setHTML('capa-municipis',h);
}
function renderHover(){const m=hoverId?muniById[hoverId]:null;setHTML('capa-hover',m?`<circle class="hover-ring" cx="${m.x}" cy="${m.y}" r="${11/zoomFactor()}"/>`:'')}
async function loadTerrainContours(){
  if(terrainContours)return terrainContours;
  if(TERRAIN_CONTOURS&&typeof TERRAIN_CONTOURS==='object'){
    terrainContours=TERRAIN_CONTOURS;
    return terrainContours;
  }
  if(!terrainContoursPromise)terrainContoursPromise=fetchJsonStatic('terrain/contours.json').then(x=>(terrainContours=x));
  return terrainContoursPromise;
}
async function renderTopo(){
  const generation=++terrainRenderGeneration;
  if(!state.layers.topo){setHTML('capa-topografia','');return}
  if(dragging)return;
  try{
    const data=await loadTerrainContours();
    if(generation!==terrainRenderGeneration||!state.layers.topo)return;
    const a=unproject(state.vb.x,state.vb.y),b=unproject(state.vb.x+state.vb.w,state.vb.y+state.vb.h);
    const view=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
    const z=zoomFactor(),step=z<2?500:(z<4?200:100);
    let h='',count=0;
    for(const f of (data.contours||[])){
      if((+f.e)%step!==0||!intersectsBbox(f.b,view))continue;
      if(!f._d){
        const p=(f.c||[]).map(q=>project(q[0],q[1]));
        if(p.length<2){f._d='';continue}
        f._d='M '+p.map(q=>`${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L ');
      }
      if(!f._d)continue;
      const major=(+f.e)%500===0;
      h+=`<path class="terrain-contour ${major?'terrain-major':'terrain-minor'}" d="${f._d}"><title>${f.e} m</title></path>`;
      if(++count>3000)break;
    }
    setHTML('capa-topografia',h);
  }catch(err){
    if(generation===terrainRenderGeneration){
      setHTML('capa-topografia','');
      console.warn('[Ferrocat] No s’han pogut carregar les corbes de nivell.',err);
    }
  }
}
const LAYER_DOM={
  comarques:'capa-comarques',
  rail:'capa-rail',
  renfe:'capa-serveis',
  fgc:'capa-serveis',
  tmb:'capa-serveis',
  tram:'capa-serveis',
  roads:'capa-carreteres',
  topo:'capa-topografia',
  flows:'capa-fluxos'
};
function applyLayerVisibility(){
  const direct=['comarques','rail','roads','topo','flows'];
  for(const k of direct){
    const el=byId(LAYER_DOM[k]);
    if(el)el.style.display=state.layers[k]?'':'none';
  }
  const services=byId('capa-serveis');
  if(services)services.style.display=(state.layers.renfe||state.layers.fgc||state.layers.tmb||state.layers.tram)?'':'none';
}
function renderMap(){
  svg.setAttribute('viewBox',`${state.vb.x} ${state.vb.y} ${state.vb.w} ${state.vb.h}`);
  applyLayerVisibility();
  renderOSM();
  void renderTopo();
  renderComarques();
  scheduleRoads(false,90);
  renderRail();
  renderServices();
  renderFlows();
  renderScenario();
  renderMunicipis();
  renderHover();
  applyLayerVisibility();
  renderStatus();
}

/* ---------------- sidebar / profiles ---------------- */
function profileSvg(a){if(!a?.terrain?.length)return '';const t=a.terrain,r=a.rail,d=a.distKm,min=Math.min(...t,...r),max=Math.max(...t,...r),w=330,h=86,p=8,x=i=>p+(d[i]/Math.max(.001,d.at(-1)))*(w-2*p),y=v=>h-p-(v-min)/Math.max(1,max-min)*(h-2*p),path=arr=>'M '+arr.map((v,i)=>`${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' L ');return `<svg class="profile" viewBox="0 0 ${w} ${h}"><path class="terrain" d="${path(t)}"/><path class="rail" d="${path(r)}"/><text x="8" y="10">terreny / rasant estimada</text></svg>`}
function renderLines(){
  const box=byId('llista-linies');
  if(!state.lines.length){box.innerHTML='<p class="buida">Clica un municipi o activa Traça per crear una línia.</p>';return}
  box.innerHTML=state.lines.map(l=>{
    const m=metrics(l),route=m.st.map(x=>x.nom).join(' → ')||`${l.alignment.length} punts de traçat`,structures=l.analysis?.structures||[],warn=l.analysis?.warning;
    const reuse=m.stationMatches.length
      ? `<div class="station-reuse"><b>Reutilitza:</b> ${m.stationMatches.map(x=>`${esc(x.municipality)} → ${esc(x.station)} (${fmt1(x.distanceKm)} km)`).join(' · ')}</div>`
      : '';
    const imported=l.sourceServiceId
      ? `<div class="source"><span class="badge">IMPORTADA</span> ${esc(String(l.sourceAgency||'').toUpperCase())} · ${esc(l.sourceRoute||'servei existent')}</div>`
      : '';
    return `<div class="line-card ${l.id===state.activeId?'active':''}" style="border-left-color:${l.color}">
      <div class="line-head"><input data-name="${l.id}" value="${esc(l.name)}"><div class="mini"><button class="secundari" data-edit="${l.id}">${l.id===state.activeId?'Editant':'Edita'}</button><button class="perillos" data-del="${l.id}">×</button></div></div>
      <div class="source"><span class="badge">MITMS OD</span> ${esc(dataLabel())}</div>
      ${imported}
      <div class="route">${esc(route)}</div>
      <div class="metrics">
        <div>Estacions <b>${m.n}</b></div><div>Longitud <b>${fmt1(m.len)} km</b></div>
        <div>Est. reutilitzades <b>${m.stationReused}</b></div><div>Est. noves <b>${m.stationNew}</b></div>
        <div>Cost estacions <b>${fmt1(m.stationCost)} M€</b></div><div>Cost via/obra <b>${fmt1(m.trackCost)} M€</b></div>
        <div>Via existent <b>${fmt1(m.existing)} km</b></div><div>Via nova <b>${fmt1(m.surface)} km</b></div>
        <div>Túnel <b>${fmt1(m.tunnelKm)} km</b></div><div>Viaducte <b>${fmt1(m.viaductKm)} km</b></div>
        <div>Pendent màx. <b>${m.maxGradient===null?'—':fmt1(m.maxGradient)+' ‰'}</b></div><div>Pobl. influència <b>${fmt(m.popCatch)}</b></div>
        <div>OD observat/dia <b>${fmt(m.observed)}</b></div><div>Captació estimada <b>${fmt(m.captured)}</b></div>
        <div>Vehicles evitats <b>${fmt(m.vehicles)}</b></div><div>CO₂ <b>${fmt(m.co2)} t/any</b></div>
        <div>Cost total <b>${fmt(m.cost)} M€</b></div>
      </div>
      ${reuse}
      ${structures.length?`<div class="segments">${structures.map(s=>`<div class="segment-row"><span>${s.kind==='tunnel'?'Túnel':'Viaducte'} ${fmt1(s.startKm)}–${fmt1(s.endKm)} km</span><b>${fmt1(s.lengthKm)} km</b></div>`).join('')}</div>`:''}
      ${warn?`<div class="warning ${l.analysis?.usedTunnel?'danger':''}">${esc(warn)}</div>`:(l.analysis?'<div class="warning ok">Alternativa superficial viable dins del corredor.</div>':'')}
      ${profileSvg(l.analysis)}
      <div class="fila-botons" style="margin-top:6px"><button class="secundari" data-analyze="${l.id}">Analitza topografia</button><button class="secundari" data-clear-align="${l.id}">Traçat estacions</button></div>
    </div>`;
  }).join('');

  box.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{state.activeId=b.dataset.edit;save();render()});
  box.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{state.lines=state.lines.filter(l=>l.id!==b.dataset.del);if(state.activeId===b.dataset.del)state.activeId=null;save();render()});
  box.querySelectorAll('[data-name]').forEach(i=>i.onchange=()=>{const l=state.lines.find(x=>x.id===i.dataset.name);if(l){l.name=String(i.value).slice(0,80);save();render()}});
  box.querySelectorAll('[data-analyze]').forEach(b=>b.onclick=()=>{const l=state.lines.find(x=>x.id===b.dataset.analyze);if(l){l.analysis=analyzeTerrain(l);render();save()}});
  box.querySelectorAll('[data-clear-align]').forEach(b=>b.onclick=()=>{const l=state.lines.find(x=>x.id===b.dataset.clearAlign);if(l){l.alignment=[];l.analysis=null;save();render()}});
}
function renderSummary(){if(!state.lines.length){setHTML('resum-global','<p class="buida">Sense línies.</p>');return}const ms=state.lines.map(metrics),sum=k=>ms.reduce((s,m)=>s+(+m[k]||0),0),items=[['Línies',state.lines.length],['Km xarxa',fmt1(sum('len'))],['Est. noves',fmt(sum('stationNew'))],['Est. reutilitzades',fmt(sum('stationReused'))],['OD observat',fmt(sum('observed'))],['Captació/dia',fmt(sum('captured'))],['Vehicles/dia',fmt(sum('vehicles'))],['Túnels km',fmt1(sum('tunnelKm'))],['CO₂ t/any',fmt(sum('co2'))],['Cost M€',fmt(sum('cost'))]];setHTML('resum-global',items.map(([l,n])=>`<div class="resum"><span class="num">${n}</span><span class="lbl">${l}</span></div>`).join(''))}

function renderDataAttributions(){
  const el=byId('data-attribution');
  if(!el)return;
  const items=Array.isArray(ATTRIBUTIONS?.items)?ATTRIBUTIONS.items:[];
  if(!items.length){el.innerHTML='';el.style.display='none';return;}
  el.style.display='block';
  el.innerHTML='<span class="lic">Dades:</span> '+items.map(x=>{
    const label=esc(x.short||x.label||x.id||'font');
    const url=String(x.url||'');
    return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`:label;
  }).join(' · ');
}
function renderStatus(){
  const countAgency=a=>RAIL_SERVICES.filter(s=>String(s.agency||'').toLowerCase()===a).length;
  const renfeN=countAgency('renfe'),fgcN=countAgency('fgc'),tmbN=countAgency('tmb'),tramN=countAgency('tram');
  const disusedN=RAIL_EDGES.filter(e=>String(e.estat||'').toLowerCase()==='dus').length;
  const roadsReady=(ROAD_MANIFEST&&Object.keys(ROAD_MANIFEST).length)||(Array.isArray(ROADS)&&ROADS.length);
  const topoReady=(TERRAIN_CONTOURS&&Array.isArray(TERRAIN_CONTOURS.contours))||terrainReady();
  const reusable=REAL_STATIONS.filter(s=>s.reusable_heavy_rail).length;
  setHTML('data-status',
    `MITMS OD: <b>${OD_PAIRS.length.toLocaleString('ca-ES')} parelles</b><br>`+
    `RTT model: <b>${RAIL_EDGES.length.toLocaleString('ca-ES')} trams</b> · en desús: <b>${disusedN.toLocaleString('ca-ES')}</b><br>`+
    `Renfe: <b>${renfeN.toLocaleString('ca-ES')}</b> · FGC: <b>${fgcN.toLocaleString('ca-ES')}</b><br>`+
    `TMB Metro: <b>${tmbN.toLocaleString('ca-ES')}</b> · TRAM: <b>${tramN.toLocaleString('ca-ES')}</b><br>`+
    `Parades/estacions: <b>${REAL_STATIONS.length.toLocaleString('ca-ES')}</b> · ferroviàries reutilitzables: <b>${reusable.toLocaleString('ca-ES')}</b><br>`+
    `${(tmbN===0||tramN===0||REAL_STATIONS.length===0)?'<span style="color:#c62828;font-weight:700">RUNTIME FERROVIARI INCOMPLET: executa PREPARAR_FERROCARRIL_COMPLETO.bat</span><br>':''}`+
    `Carreteres: <b>${roadsReady?'preparades':'no preparades'}</b>`+
    `${roadsReady&&ROAD_MANIFEST?.lods?` · LOD actual <b>${roadLod()}</b> · segments ${[0,1,2,3].map(i=>Number(ROAD_MANIFEST.lods?.[String(i)]?.segments||0).toLocaleString('ca-ES')).join('/')}`:''}<br>`+
    `Topografia: <b>${topoReady?'preparada':'no preparada'}</b><br>`+
    `DEM interactiu: <b>${terrainReady()?'sí ('+TERRAIN_COARSE.resolution_m+' m)':'no'}</b>`
  );
}
function render(){renderMap();renderLines();renderSummary();renderStatus();renderDataAttributions()}

/* ---------------- controls ---------------- */
const defs=[['velocitatTren','km/h'],['frequencia','trens/h'],['velocitatCotxe','km/h'],['tempsAcces','min'],['tempsParada','min'],['intensitatMobilitat','×'],['sensibilitatDistancia','×'],['sensibilitat',''],['biaix',''],['fraccioCotxeActual',''],['radiCaptacio','km'],['costPerKm','M€/km'],['tunnelCost','M€/km'],['viaductCost','M€/km'],['stationCost','M€'],['stationReuseRadius','km'],['maxGradient','‰'],['emissioPerKm','kg/km']];defs.forEach(([k,u])=>{const i=byId('s-'+k),o=byId('v-'+k);if(!i||!o)return;i.value=params[k];const update=()=>{params[k]=finite(i.value,params[k],...(limits[k]||[-Infinity,Infinity]));o.textContent=(k==='fraccioCotxeActual'?Math.round(params[k]*100)+'%':params[k]+' '+u).trim();save();render()};i.oninput=update;update()});
byId('layer-select').value=state.layer;byId('layer-select').onchange=e=>{state.layer=e.target.value;save();renderMap()};byId('tool-select').value=state.tool;byId('tool-select').onchange=e=>{state.tool=e.target.value;save();byId('trace-help').textContent=state.tool==='trace'?'Mode Traça: cada clic afegeix un punt. Finalitza per executar l’anàlisi topogràfica si hi ha DEM.':'Mode estacions: clica municipis per afegir parades.'};
const LAYER_CONTROLS=[['comarques','chk-comarques'],['rail','chk-rail'],['renfe','chk-renfe'],['fgc','chk-fgc'],['tmb','chk-tmb'],['tram','chk-tram'],['roads','chk-roads'],['topo','chk-topo'],['flows','chk-fluxos']];
function syncLayerControls(){
  for(const [k,id] of LAYER_CONTROLS){
    const x=byId(id);
    if(x)x.checked=!!state.layers[k];
  }
}
for(const [k,id] of LAYER_CONTROLS){
  const x=byId(id);if(!x)continue;
  x.checked=!!state.layers[k];
  x.onchange=e=>{
    state.layers[k]=Boolean(e.currentTarget.checked);
    save();
    applyLayerVisibility();
    renderMap();
    syncLayerControls();
  };
}
syncLayerControls();
byId('btn-stop').onclick=()=>{state.activeId=null;save();render()};byId('btn-undo').onclick=undo;byId('btn-finish-trace').onclick=finishTrace;byId('btn-reset').onclick=()=>{state.lines=[];state.activeId=null;state.counter=0;save();render()};
byId('btn-zoom-in').onclick=()=>{const r=svg.getBoundingClientRect();zoom(1/1.4,r.left+r.width/2,r.top+r.height/2)};byId('btn-zoom-out').onclick=()=>{const r=svg.getBoundingClientRect();zoom(1.4,r.left+r.width/2,r.top+r.height/2)};byId('btn-zoom-reset').onclick=()=>{state.vb={...BASE};save();renderMap()};
parentElement.addEventListener('keydown',e=>{if(e.key==='Escape'){state.activeId=null;save();render()}if(e.key==='Enter'&&state.tool==='trace')finishTrace()});

/* ---------------- search ---------------- */
const normalize=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function focusMunicipi(m){state.vb.w=90;state.vb.h=90*BASE.h/BASE.w;state.vb.x=m.x-state.vb.w/2;state.vb.y=m.y-state.vb.h/2;hoverId=m.id;save();renderMap();byId('hover-box').style.display='block';byId('hover-box').textContent=`${m.nom} · ${fmt(m.pob)} hab. · ${m.com}`}
function showSearch(){const box=byId('search-results');box.innerHTML=searchMatches.map((m,i)=>`<button class="${i===searchIndex?'focused':''}" data-i="${i}">${esc(m.nom)} · ${esc(m.com)}</button>`).join('');box.style.display=searchMatches.length?'block':'none';box.querySelectorAll('button').forEach(b=>b.onclick=()=>{focusMunicipi(searchMatches[+b.dataset.i]);box.style.display='none'})}
byId('cerca-input').addEventListener('input',e=>{const q=normalize(e.target.value.trim());searchIndex=-1;searchMatches=q.length<2?[]:MUNICIPIS.filter(m=>normalize(m.nom).includes(q)).sort((a,b)=>normalize(a.nom).startsWith(q)?-1:normalize(b.nom).startsWith(q)?1:b.pob-a.pob).slice(0,10);showSearch()});byId('cerca-input').addEventListener('keydown',e=>{if(!searchMatches.length)return;if(e.key==='ArrowDown'){e.preventDefault();searchIndex=(searchIndex+1)%searchMatches.length;showSearch()}else if(e.key==='ArrowUp'){e.preventDefault();searchIndex=(searchIndex-1+searchMatches.length)%searchMatches.length;showSearch()}else if(e.key==='Enter'){e.preventDefault();focusMunicipi(searchMatches[Math.max(0,searchIndex)]);byId('search-results').style.display='none'}});

console.info('[Ferrocat] datasets',{
  municipis:MUNICIPIS.length,
  comarques:COMARQUES.length,
  railEdges:RAIL_EDGES.length,
  servicesTotal:RAIL_SERVICES.length,
  renfe:RAIL_SERVICES.filter(s=>String(s.agency||'').toLowerCase()==='renfe').length,
  fgc:RAIL_SERVICES.filter(s=>String(s.agency||'').toLowerCase()==='fgc').length,
  tmb:RAIL_SERVICES.filter(s=>String(s.agency||'').toLowerCase()==='tmb').length,
  tram:RAIL_SERVICES.filter(s=>String(s.agency||'').toLowerCase()==='tram').length,
  railStations:REAL_STATIONS.length,
  roadsInline:Array.isArray(ROADS)?ROADS.length:0,
  roadManifest:ROAD_MANIFEST&&Object.keys(ROAD_MANIFEST).length?true:false,
  terrainContours:TERRAIN_CONTOURS?.contours?.length||0,
  terrainCoarse:terrainReady()?`${TERRAIN_COARSE.width}x${TERRAIN_COARSE.height}`:'no'
});
render();
