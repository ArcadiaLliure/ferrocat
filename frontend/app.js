/* Motor de client de Ferrocat: múltiples línies, OD MITMS, mapa procedural/OSM i zero reruns de Streamlit. */
const COLORS_LINIA = ['#e63946','#2a9d8f','#f4a300','#8338ec','#3a86ff','#06d6a0','#ff6b35','#c9184a'];
const BASE_VB = {x:0,y:0,w:800,h:660};
const MARGE_PROJECCIO = 30;
const ADAPTATION_COST_MKM = 2;
const CAR_OCCUPANCY = 1.25;
const MAX_DIVERSION = 0.65;
const TIMETABLE_FACTOR = 0.30;
const CAR_FIXED_MIN = 4;

let linies = [];
let comptadorLinies = 0;
let lineaActivaId = null;
let mostrarFluxos = true;
let mostrarComarques = true;
let layerMode = 'procedural';
let vb = {...BASE_VB};
let hoveredId = null;

const parametres = {
  velocitatTren:80,
  frequencia:2,
  velocitatCotxe:65,
  tempsAcces:6,
  tempsParada:1,
  intensitatMobilitat:1.12,      // factor de traça ferroviària
  sensibilitatDistancia:1.20,    // factor de carretera
  sensibilitat:0.08,             // beta logit
  biaix:0.8,
  fraccioCotxeActual:0.75,
  costPerKm:12,
  emissioPerKm:0.15,
  diesPerAny:250,
  radiCaptacio:8,
};

// SEGURETAT: sessionStorage és una entrada controlada per l'usuari. L'estat
// persistit ha de passar per esquemes i allowlists explícits abans que pugui
// influir en atributs HTML/SVG o en els càlculs.
const STATE_KEY = 'ferrocat-state-v1.0';
const VALID_COLORS = new Set(COLORS_LINIA);
const VALID_LAYER_MODES = new Set(['procedural','osm']);
const LINE_ID_RE = /^linia-\d+$/;
const MAX_LINES = 100;
const MAX_STATIONS_PER_LINE = Math.max(1, MUNICIPIS.length);
const MAX_LINE_NAME_LENGTH = 80;
const MAX_LINE_COUNTER = 1_000_000;
const PARAM_LIMITS = Object.freeze({
  velocitatTren:[40,160],
  frequencia:[0.5,6],
  velocitatCotxe:[30,110],
  tempsAcces:[2,15],
  tempsParada:[0.5,3],
  intensitatMobilitat:[1,1.6],
  sensibilitatDistancia:[1,1.8],
  sensibilitat:[0.02,0.2],
  biaix:[-1,3],
  fraccioCotxeActual:[0.4,1],
  costPerKm:[4,30],
  emissioPerKm:[0.08,0.25],
  diesPerAny:[1,366],
  radiCaptacio:[2,20],
});
const PARAM_DEFAULTS = Object.freeze({...parametres});

const MUNICIPI_PER_ID = Object.fromEntries(MUNICIPIS.map(m => [String(m.id), m]));
const OD_MAP = new Map(OD_PAIRS.map(([a,b,v]) => [`${a}|${b}`, Number(v)]));
const svg = parentElement.querySelector('#mapa');
const hoverBox = parentElement.querySelector('#hover-box');
const layerSelect = parentElement.querySelector('#layer-select');
const osmAttribution = parentElement.querySelector('#osm-attribution');

function byId(id){
  return parentElement.querySelector(`#${id}`);
}

function setLayerHTML(id, html){
  const el=byId(id);
  if(!el){ console.warn(`[Ferrocat] Falta #${id}`); return false; }
  // Aquest renderitzador manté cadenes SVG/HTML per rendiment. El text variable
  // passa per esc(); els atributs no textuals provenen d'estat validat o de
  // càlculs numèrics. No hi passis mai estat del navegador sense sanejar.
  el.innerHTML=html;
  return true;
}

function fmt(n){ return Math.round(Number(n)||0).toLocaleString('ca-ES'); }
function fmt1(n){ return (Number(n)||0).toFixed(1); }
function dataLabel(){
  const days = Array.isArray(META?.days) ? META.days : [];
  if(days.length === 1) return days[0];
  if(days.length > 1) return `${days[0]} → ${days[days.length-1]}`;
  return 'darrera matriu disponible';
}
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function finiteNumber(value,fallback,min=-Infinity,max=Infinity){
  if(typeof value!=='number' || !Number.isFinite(value))return fallback;
  if(value<min || value>max)return fallback;
  return value;
}
function finiteInput(value,fallback,min=-Infinity,max=Infinity){
  const n=Number(value);
  return Number.isFinite(n) && n>=min && n<=max ? n : fallback;
}
function sanitizeLineName(value,fallback='Línia'){
  const text=(value===null || value===undefined)?'':String(value);
  const trimmed=text.trim().slice(0,MAX_LINE_NAME_LENGTH);
  return trimmed || String(fallback).slice(0,MAX_LINE_NAME_LENGTH);
}
function sanitizeParameters(raw){
  const out={...PARAM_DEFAULTS};
  if(!raw || typeof raw!=='object' || Array.isArray(raw))return out;
  Object.entries(PARAM_LIMITS).forEach(([key,[min,max]])=>{
    out[key]=finiteNumber(raw[key],PARAM_DEFAULTS[key],min,max);
  });
  return out;
}
function sanitizeViewBox(raw){
  if(!raw || typeof raw!=='object' || Array.isArray(raw))return {...BASE_VB};
  const minW=BASE_VB.w/16,maxW=BASE_VB.w*2.5;
  const w=finiteNumber(raw.w,BASE_VB.w,minW,maxW);
  const expectedH=w*(BASE_VB.h/BASE_VB.w);
  const h=finiteNumber(raw.h,expectedH,expectedH-0.001,expectedH+0.001);
  return {
    x:finiteNumber(raw.x,BASE_VB.x),
    y:finiteNumber(raw.y,BASE_VB.y),
    w,
    h,
  };
}
function sanitizeLines(raw){
  if(!Array.isArray(raw))return [];
  const out=[],seenIds=new Set();
  for(const candidate of raw.slice(0,MAX_LINES)){
    if(!candidate || typeof candidate!=='object' || Array.isArray(candidate))continue;
    const id=typeof candidate.id==='string'?candidate.id:'';
    if(!LINE_ID_RE.test(id) || seenIds.has(id))continue;
    const color=VALID_COLORS.has(candidate.color)?candidate.color:null;
    if(!color)continue;
    const stationIds=[],seenStations=new Set();
    if(Array.isArray(candidate.estacions)){
      for(const rawId of candidate.estacions.slice(0,MAX_STATIONS_PER_LINE)){
        const stationId=String(rawId);
        if(!MUNICIPI_PER_ID[stationId] || seenStations.has(stationId))continue;
        seenStations.add(stationId);stationIds.push(stationId);
      }
    }
    if(!stationIds.length)continue;
    const fallbackName=`Línia ${id.split('-')[1]}`;
    out.push({
      id,
      nom:sanitizeLineName(candidate.nom,fallbackName),
      color,
      estacions:stationIds,
      existingKm:finiteNumber(candidate.existingKm,0,0,100000),
    });
    seenIds.add(id);
  }
  return out;
}
function sanitizeState(raw){
  if(!raw || typeof raw!=='object' || Array.isArray(raw))return null;
  const safeLines=sanitizeLines(raw.linies);
  const ids=new Set(safeLines.map(l=>l.id));
  const maxId=safeLines.reduce((mx,l)=>Math.max(mx,Number(l.id.split('-')[1])||0),0);
  const storedCounter=Math.floor(finiteNumber(raw.comptadorLinies,0,0,MAX_LINE_COUNTER));
  const active=typeof raw.lineaActivaId==='string' && ids.has(raw.lineaActivaId)
    ? raw.lineaActivaId : null;
  return {
    linies:safeLines,
    comptadorLinies:Math.max(maxId,storedCounter),
    lineaActivaId:active,
    mostrarFluxos:typeof raw.mostrarFluxos==='boolean'?raw.mostrarFluxos:true,
    mostrarComarques:typeof raw.mostrarComarques==='boolean'?raw.mostrarComarques:true,
    layerMode:VALID_LAYER_MODES.has(raw.layerMode)?raw.layerMode:'procedural',
    vb:sanitizeViewBox(raw.vb),
    parametres:sanitizeParameters(raw.parametres),
  };
}
function saveState(){
  try{
    const safe=sanitizeState({
      linies,comptadorLinies,lineaActivaId,mostrarFluxos,mostrarComarques,
      layerMode,vb,parametres
    });
    if(safe)sessionStorage.setItem(STATE_KEY,JSON.stringify(safe));
  }catch(err){
    console.warn('[Ferrocat] No s’ha pogut desar l’estat local.',err);
  }
}
function restoreState(){
  try{
    const raw=sessionStorage.getItem(STATE_KEY);
    if(!raw)return;
    const safe=sanitizeState(JSON.parse(raw));
    if(!safe){sessionStorage.removeItem(STATE_KEY);return;}
    linies=safe.linies;
    comptadorLinies=safe.comptadorLinies;
    lineaActivaId=safe.lineaActivaId;
    mostrarFluxos=safe.mostrarFluxos;
    mostrarComarques=safe.mostrarComarques;
    layerMode=safe.layerMode;
    vb=safe.vb;
    Object.assign(parametres,safe.parametres);
  }catch(err){
    sessionStorage.removeItem(STATE_KEY);
    console.warn('[Ferrocat] Estat local invàlid ignorat.',err);
  }
}
restoreState();

// Web Mercator amb escala uniforme: OSM, municipis i geometria comarcal
// queden alineats sense distorsió.
function mercatorNorm(lon,lat){
  const x=(Number(lon)+180)/360;
  const cl=clamp(Number(lat),-85.05112878,85.05112878);
  const r=cl*Math.PI/180;
  const y=(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2;
  return [x,y];
}
const geoPts=[];
MUNICIPIS.forEach(m=>geoPts.push([Number(m.lon),Number(m.lat)]));
COMARQUES.forEach(c=>{
  const g=c.geom;
  const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
  polys.forEach(poly=>poly.forEach(ring=>ring.forEach(([lon,lat])=>geoPts.push([Number(lon),Number(lat)]))));
});
const mercPts=geoPts.map(([lon,lat])=>mercatorNorm(lon,lat));
const minMX=Math.min(...mercPts.map(p=>p[0])),maxMX=Math.max(...mercPts.map(p=>p[0]));
const minMY=Math.min(...mercPts.map(p=>p[1])),maxMY=Math.max(...mercPts.map(p=>p[1]));
const scale=Math.min((BASE_VB.w-2*MARGE_PROJECCIO)/(maxMX-minMX),(BASE_VB.h-2*MARGE_PROJECCIO)/(maxMY-minMY));
const drawW=(maxMX-minMX)*scale, drawH=(maxMY-minMY)*scale;
const offsetX=(BASE_VB.w-drawW)/2, offsetY=(BASE_VB.h-drawH)/2;
function projectarPunt(lon,lat){
  const [mx,my]=mercatorNorm(lon,lat);
  return [offsetX+(mx-minMX)*scale, offsetY+(my-minMY)*scale];
}
function unproject(x,y){
  const mx=minMX+(x-offsetX)/scale, my=minMY+(y-offsetY)/scale;
  const lon=mx*360-180, n=Math.PI-2*Math.PI*my;
  return [lon,180/Math.PI*Math.atan(Math.sinh(n))];
}
MUNICIPIS.forEach(m=>{m.id=String(m.id);const [x,y]=projectarPunt(m.lon,m.lat);m.x=x;m.y=y;});
COMARQUES.forEach(c=>{
  const cv=ring=>ring.map(([lon,lat])=>projectarPunt(lon,lat));
  c.anellsProjectats=c.geom.type==='Polygon'?[c.geom.coordinates.map(cv)]:c.geom.coordinates.map(poly=>poly.map(cv));
});

function distanciaKm(a,b){
  const R=6371.0088,toRad=x=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon);
  const aa=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(aa));
}

function construirCaptacions(estacions){
  const rows=[];
  MUNICIPIS.forEach(m=>{
    let best=null;
    estacions.forEach((e,idx)=>{
      const d=distanciaKm(m,e);
      if(d<=parametres.radiCaptacio && (!best||d<best.d))best={idx,d};
    });
    if(best)rows.push({m,stationIdx:best.idx,d:best.d});
  });
  return rows;
}
function assignacioZones(captacions){
  const own=new Map();
  captacions.forEach(r=>{
    const z=String(r.m.zone||'');if(!z)return;
    if(!own.has(z))own.set(z,new Map());
    const x=own.get(z);x.set(r.stationIdx,(x.get(r.stationIdx)||0)+Number(r.m.pob||0));
  });
  const result=new Map();let shared=0;
  own.forEach((stations,z)=>{
    if(stations.size>1)shared++;
    let best=null,bp=-1;stations.forEach((pop,idx)=>{if(pop>bp){bp=pop;best=idx;}});
    result.set(z,best);
  });
  return {result,shared};
}
function odEntreEstacions(zoneMap){
  const pairs=new Map();
  OD_PAIRS.forEach(([za,zb,trips])=>{
    const i=zoneMap.get(String(za)),j=zoneMap.get(String(zb));
    if(i===undefined||j===undefined||i===j)return;
    const a=Math.min(i,j),b=Math.max(i,j),k=`${a}|${b}`;
    pairs.set(k,(pairs.get(k)||0)+Number(trips||0));
  });
  return pairs;
}
function probabilitatCanvi(delta){
  const z=clamp(parametres.biaix+parametres.sensibilitat*delta,-30,30);
  return MAX_DIVERSION/(1+Math.exp(z));
}
function calcularMetriquesLinia(linia){
  const estacions=linia.estacions.map(id=>MUNICIPI_PER_ID[String(id)]).filter(Boolean);
  const n=estacions.length;
  const seg=[];
  for(let i=0;i<n-1;i++)seg.push(distanciaKm(estacions[i],estacions[i+1])*parametres.intensitatMobilitat);
  const prefix=[0];seg.forEach(d=>prefix.push(prefix[prefix.length-1]+d));
  const longitudKm=seg.reduce((a,b)=>a+b,0);
  const tempsTotalViatge=n>=2?longitudKm/parametres.velocitatTren*60+Math.max(0,n-2)*parametres.tempsParada:0;
  const captacions=construirCaptacions(estacions);
  const poblacioDirecta=estacions.reduce((s,m)=>s+Number(m.pob||0),0);
  const poblacioCaptacio=captacions.reduce((s,r)=>s+Number(r.m.pob||0),0);
  const zones=assignacioZones(captacions);
  const od=odEntreEstacions(zones.result);
  const headway=60/Math.max(parametres.frequencia,.1);
  const schedulePenalty=Math.min(30,headway*TIMETABLE_FACTOR);
  let observed=0,captured=0,vehicles=0,vkm=0;
  const fluxos=[];
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
    const obs=Number(od.get(`${i}|${j}`)||0);if(obs<=0)continue;
    const railKm=prefix[j]-prefix[i];
    const railIvt=railKm/parametres.velocitatTren*60+Math.max(0,j-i-1)*parametres.tempsParada;
    const railGeneral=railIvt+2*parametres.tempsAcces+schedulePenalty;
    const roadKm=distanciaKm(estacions[i],estacions[j])*parametres.sensibilitatDistancia;
    const carTime=roadKm/parametres.velocitatCotxe*60+CAR_FIXED_MIN;
    const carPerson=obs*parametres.fraccioCotxeActual;
    const p=probabilitatCanvi(railGeneral-carTime);
    const cap=carPerson*p, veh=cap/CAR_OCCUPANCY, pairVkm=veh*roadKm;
    observed+=obs;captured+=cap;vehicles+=veh;vkm+=pairVkm;
    fluxos.push({origen:estacions[i],desti:estacions[j],desplaçamentsCapturats:cap,probabilitatTren:p});
  }
  const existing=clamp(Number(linia.existingKm||0),0,longitudKm);
  const newKm=Math.max(0,longitudKm-existing);
  const costEstimat=newKm*parametres.costPerKm+existing*ADAPTATION_COST_MKM;
  const co2TonesAny=vkm*parametres.emissioPerKm*parametres.diesPerAny/1000;
  const costPerVehicle = vehicles > 0.5 ? (costEstimat * 1e6) / vehicles : null;
  return {
    estacions,n,longitudKm,tempsTotalViatge,poblacioDirecta,poblacioCaptacio,
    totalOD:observed,
    totalDesplaçamentsCapturats:captured,
    totalCotxesEliminats:vehicles,
    co2TonesAny,costEstimat,costPerVehicle,
    fluxos,sharedZones:zones.shared
  };
}

function seleccionarMunicipi(id){
  id=String(id);
  if(!MUNICIPI_PER_ID[id])return;
  if(lineaActivaId===null){
    if(linies.length>=MAX_LINES || comptadorLinies>=MAX_LINE_COUNTER)return;
    comptadorLinies++;
    const nova={id:'linia-'+comptadorLinies,nom:'Línia '+comptadorLinies,color:COLORS_LINIA[(comptadorLinies-1)%COLORS_LINIA.length],estacions:[id],existingKm:0};
    linies.push(nova);lineaActivaId=nova.id;
  }else{
    const l=linies.find(x=>x.id===lineaActivaId);if(!l){lineaActivaId=null;return;}
    if(l.estacions.includes(id) || l.estacions.length>=MAX_STATIONS_PER_LINE)return;l.estacions.push(id);
  }
  saveState();render();
}
function aturarEdicio(){lineaActivaId=null;saveState();render();}
function desferUltimaEstacio(){
  if(lineaActivaId===null)return;const l=linies.find(x=>x.id===lineaActivaId);if(!l)return;
  l.estacions.pop();if(!l.estacions.length){linies=linies.filter(x=>x.id!==l.id);lineaActivaId=null;}
  saveState();render();
}
function esborrarLinia(id){linies=linies.filter(l=>l.id!==id);if(lineaActivaId===id)lineaActivaId=null;saveState();render();}
function editarLinia(id){lineaActivaId=id;saveState();render();}
function renombrarLinia(id,nom){const l=linies.find(x=>x.id===id);if(l){l.nom=sanitizeLineName(nom,l.nom);saveState();render();}}

function zoomFactor(){return BASE_VB.w/vb.w;}
function actualitzaViewBox(){svg.setAttribute('viewBox',`${vb.x} ${vb.y} ${vb.w} ${vb.h}`);renderMapa();}
function puntSvg(cx,cy){const r=svg.getBoundingClientRect();return [vb.x+(cx-r.left)/r.width*vb.w,vb.y+(cy-r.top)/r.height*vb.h];}
function zoom(factor,cx,cy){
  const [px,py]=puntSvg(cx,cy),nw=clamp(vb.w*factor,BASE_VB.w/16,BASE_VB.w*2.5),nh=nw*(BASE_VB.h/BASE_VB.w);
  vb.x=px-(px-vb.x)*(nw/vb.w);vb.y=py-(py-vb.y)*(nh/vb.h);vb.w=nw;vb.h=nh;saveState();actualitzaViewBox();
}
function screenPos(m){const p=svg.createSVGPoint();p.x=m.x;p.y=m.y;const c=svg.getScreenCTM();if(!c)return null;const s=p.matrixTransform(c);return {x:s.x,y:s.y};}
function nearestInPixels(cx,cy,maxPx=26){
  let best=null,bd=maxPx*maxPx;MUNICIPIS.forEach(m=>{const s=screenPos(m);if(!s)return;const dx=s.x-cx,dy=s.y-cy,d=dx*dx+dy*dy;if(d<=bd){bd=d;best=m;}});return best;
}

let dragging=false,dragMoved=false,start=null,vbStart=null;
svg.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.15:1/1.15,e.clientX,e.clientY)},{passive:false});
svg.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY};vbStart={...vb};dragging=true;dragMoved=false;svg.setPointerCapture(e.pointerId);});
svg.addEventListener('pointermove',e=>{
  if(dragging){const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.hypot(dx,dy)>4)dragMoved=true;if(dragMoved){const r=svg.getBoundingClientRect();vb.x=vbStart.x-dx/r.width*vbStart.w;vb.y=vbStart.y-dy/r.height*vbStart.h;actualitzaViewBox();}return;}
  const m=nearestInPixels(e.clientX,e.clientY,28),id=m?.id||null;if(id!==hoveredId){hoveredId=id;if(m){hoverBox.style.display='block';hoverBox.textContent=`${m.nom} · ${fmt(m.pob)} hab. · ${m.com}`;}else hoverBox.style.display='none';renderHover();}
});
svg.addEventListener('pointerup',e=>{const moved=dragMoved;dragging=false;dragMoved=false;try{svg.releasePointerCapture(e.pointerId)}catch{}if(!moved){const m=nearestInPixels(e.clientX,e.clientY,28);if(m)seleccionarMunicipi(m.id);}else saveState();});
svg.addEventListener('pointercancel',()=>{dragging=false;dragMoved=false;});
svg.addEventListener('mouseleave',()=>{if(!dragging){hoveredId=null;hoverBox.style.display='none';renderHover();}});

byId('btn-zoom-in').onclick=()=>{const r=svg.getBoundingClientRect();zoom(1/1.4,r.left+r.width/2,r.top+r.height/2);};
byId('btn-zoom-out').onclick=()=>{const r=svg.getBoundingClientRect();zoom(1.4,r.left+r.width/2,r.top+r.height/2);};
byId('btn-zoom-reset').onclick=()=>{vb={...BASE_VB};saveState();actualitzaViewBox();};

byId('cerca-input').addEventListener('input',e=>{const q=e.target.value.trim().toLocaleLowerCase('ca');if(q.length<2)return;const m=MUNICIPIS.find(x=>x.nom.toLocaleLowerCase('ca').startsWith(q));if(m){vb.w=90;vb.h=90*(BASE_VB.h/BASE_VB.w);vb.x=m.x-vb.w/2;vb.y=m.y-vb.h/2;saveState();actualitzaViewBox();}});

function renderComarques(){
  const capa=byId('capa-comarques');
  if(!capa){ console.warn('[Ferrocat] Falta #capa-comarques'); return; }
  if(!mostrarComarques){capa.innerHTML='';return;}let s='';
  COMARQUES.forEach(c=>c.anellsProjectats.forEach(poly=>{const d=poly.map(r=>'M '+r.map(([x,y])=>`${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')+' Z').join(' ');s+=`<path class="comarca-poligon"
  d="${d}"
  fill="rgba(173,216,230,0.025)"
  stroke="rgba(173,216,230,0.34)"
  stroke-width="1.1"
  vector-effect="non-scaling-stroke"
  pointer-events="none"><title>${esc(c.nom)}</title></path>`;}));capa.innerHTML=s;
}
function renderHover(){
  const capa=byId('capa-hover');
  if(!capa){ console.warn('[Ferrocat] Falta #capa-hover'); return; }
  const m=hoveredId?MUNICIPI_PER_ID[hoveredId]:null;
  if(!m){capa.innerHTML='';return;}
  const r=11/Math.max(zoomFactor(),.01);
  capa.innerHTML=`<circle class="hover-ring" cx="${m.x}" cy="${m.y}" r="${r}"/>`;
}

function lonLatToTile(lon,lat,z){const n=2**z,r=lat*Math.PI/180;return [(lon+180)/360*n,(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n];}
function tileToLonLat(x,y,z){const n=2**z,lon=x/n*360-180,a=Math.PI-2*Math.PI*y/n;return [lon,180/Math.PI*Math.atan(Math.sinh(a))];}
function renderOSM(){
  const capa=byId('capa-osm'),grid=byId('grid-bg'),bg=byId('map-bg');
  if(!capa || !grid || !bg){ console.warn('[Ferrocat] Capes OSM incompletes'); return; }
  if(layerMode!=='osm'){
    capa.innerHTML='';
    grid.style.display='';
    bg.setAttribute('fill','#0d2a4a');
    bg.style.fill='#0d2a4a';
    osmAttribution.style.display='none';
    return;
  }
  grid.style.display='none';bg.setAttribute('fill','#e9eef1');osmAttribution.style.display='block';
  const [lo1,la1]=unproject(vb.x,vb.y),[lo2,la2]=unproject(vb.x+vb.w,vb.y+vb.h);const west=Math.min(lo1,lo2),east=Math.max(lo1,lo2),south=Math.min(la1,la2),north=Math.max(la1,la2);
  const z=clamp(Math.round(7+Math.log2(Math.max(1,zoomFactor()))),6,15);let [tx0,ty0]=lonLatToTile(west,north,z),[tx1,ty1]=lonLatToTile(east,south,z);const n=2**z;
  const minX=clamp(Math.floor(tx0)-1,0,n-1),maxX=clamp(Math.floor(tx1)+1,0,n-1),minY=clamp(Math.floor(ty0)-1,0,n-1),maxY=clamp(Math.floor(ty1)+1,0,n-1);let s='',count=0;
  for(let x=minX;x<=maxX&&count<90;x++)for(let y=minY;y<=maxY&&count<90;y++){count++;const [a,b]=tileToLonLat(x,y,z),[c,d]=tileToLonLat(x+1,y+1,z),[x1,y1]=projectarPunt(a,b),[x2,y2]=projectarPunt(c,d);s+=`<image href="https://tile.openstreetmap.org/${z}/${x}/${y}.png" x="${Math.min(x1,x2)}" y="${Math.min(y1,y2)}" width="${Math.abs(x2-x1)}" height="${Math.abs(y2-y1)}" preserveAspectRatio="none"/>`;}
  capa.innerHTML=s;
}

function labelThreshold(){const z=zoomFactor();if(z>=12)return 0;if(z>=9)return 250;if(z>=7)return 700;if(z>=5)return 1800;if(z>=3.5)return 4500;if(z>=2.4)return 10000;if(z>=1.6)return 22000;return 50000;}
function overlap(a,b,p=3){return !(a.x2+p<b.x1||a.x1-p>b.x2||a.y2+p<b.y1||a.y1-p>b.y2);}
function chooseLabels(stations){
  const z=zoomFactor(),thr=labelThreshold(),font=z>=4?10.5:10,cands=MUNICIPIS.filter(m=>stations.has(m.id)||m.pob>=thr).sort((a,b)=>(stations.has(b.id)?1:0)-(stations.has(a.id)?1:0)||b.pob-a.pob),boxes=[],out=[];
  for(const m of cands){const sx=(m.x-vb.x)/vb.w*BASE_VB.w,sy=(m.y-vb.y)/vb.h*BASE_VB.h;if(sx<-100||sx>900||sy<-30||sy>690)continue;const st=stations.has(m.id),dx=st?11:7,w=Math.max(25,m.nom.length*font*.60),h=font*1.3,box={x1:sx+dx,y1:sy-h*.75,x2:sx+dx+w,y2:sy+h*.35};if(!st&&boxes.some(b=>overlap(box,b,4)))continue;out.push({m,st,font,dx});boxes.push(box);const max=z>=10?220:z>=7?150:z>=5?100:z>=3?65:z>=2?42:28;if(out.length>=max)break;}return out;
}

function renderMapa(){
  svg.setAttribute('viewBox',`${vb.x} ${vb.y} ${vb.w} ${vb.h}`);renderOSM();renderComarques();const metrics=linies.map(l=>({linia:l,m:calcularMetriquesLinia(l)})),z=zoomFactor(),inv=1/Math.max(z,.01);
  let flux='';if(mostrarFluxos)metrics.forEach(({linia,m})=>m.fluxos.forEach(f=>{if(f.desplaçamentsCapturats<5)return;const w=Math.max(.6,Math.min(7,Math.log10(f.desplaçamentsCapturats+1)*2.6))/Math.max(1,Math.sqrt(z));flux+=`<line class="flux-linia" x1="${f.origen.x}" y1="${f.origen.y}" x2="${f.desti.x}" y2="${f.desti.y}" stroke="${linia.color}" stroke-width="${w.toFixed(2)}" opacity=".42"/>`;}));setLayerHTML('capa-fluxos', flux);
  let lines='';linies.forEach(l=>{const pts=l.estacions.map(id=>MUNICIPI_PER_ID[id]).filter(Boolean);if(pts.length>=2){const d='M '+pts.map(p=>`${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L '),w=(l.id===lineaActivaId?5:4)/Math.max(1,Math.sqrt(z));lines+=`<path class="linia-traça" d="${d}" stroke="${l.color}" stroke-width="${w}"/>`;for(let k=0;k<pts.length-1;k++){const dist=distanciaKm(pts[k],pts[k+1])*parametres.intensitatMobilitat,min=dist/parametres.velocitatTren*60,mx=(pts[k].x+pts[k+1].x)/2,my=(pts[k].y+pts[k+1].y)/2;lines+=`<g transform="translate(${mx} ${my}) scale(${inv})"><text class="etiqueta-tram" text-anchor="middle" y="-5">${dist.toFixed(1)} km · ${Math.max(1,Math.round(min))} min</text></g>`;}}});setLayerHTML('capa-linies', lines);
  const stationIds=new Set(),owners=new Map();linies.forEach(l=>l.estacions.forEach(id=>{stationIds.add(id);if(!owners.has(id))owners.set(id,l);}));let pts='';MUNICIPIS.forEach(m=>{if(stationIds.has(m.id)){const o=owners.get(m.id);pts+=`<g transform="translate(${m.x} ${m.y}) scale(${inv})"><circle class="estacio-punt" r="6" stroke="${o.color}" stroke-width="2.5"/></g>`;}else{const r=Math.max(1.3,Math.min(13,Math.sqrt(Math.max(m.pob,1))/110+1.3));pts+=`<circle class="municipi-punt" cx="${m.x}" cy="${m.y}" r="${r}" fill="rgba(220,232,244,0.55)"/>`;}});
  chooseLabels(stationIds).forEach(({m,st,font,dx})=>{pts+=`<g transform="translate(${m.x+dx/z} ${m.y+3.5/z}) scale(${inv})"><text class="etiqueta ${st?'etiqueta-estacio':''}" font-size="${font}px">${esc(m.nom)}</text></g>`;});const active=linies.find(l=>l.id===lineaActivaId);if(active?.estacions?.length){const last=MUNICIPI_PER_ID[active.estacions.at(-1)];pts+=`<g transform="translate(${last.x} ${last.y}) scale(${inv})"><circle class="badge-actiu" r="12"/></g>`;}setLayerHTML('capa-municipis', pts);renderHover();
}

function renderLlistaLinies(){
  const box=byId('llista-linies');

  if(!linies.length){
    box.innerHTML='<p class="buida">Encara no has dibuixat cap línia. Clica un municipi al mapa per començar-ne una.</p>';
    return;
  }

  box.innerHTML=linies.map(l=>{
    const m=calcularMetriquesLinia(l);
    const activa=l.id===lineaActivaId;
    const nomsEstacions=m.estacions.map(e=>e.nom).join(' → ');

    return `
      <div class="linia-item ${activa?'actiu':''}" style="border-left-color:${l.color}">
        <div class="linia-capçalera">
          <input type="text" data-role="rename" data-id="${l.id}" value="${esc(l.nom)}">
          <div class="mini-botons">
            <button class="secundari" data-action="edit" data-id="${l.id}">
              ${activa?'Editant':'Edita'}
            </button>
            <button class="perillos" data-action="delete" data-id="${l.id}">Esborra</button>
          </div>
        </div>

        <div class="linia-source">
          <span class="source-badge">MITMS OD</span>
          <span>${esc(dataLabel())}</span>
        </div>

        <div class="linia-route">${esc(nomsEstacions || 'Primera estació seleccionada')}</div>

        <div class="linia-metrics">
          <div>Estacions: <b>${m.n}</b></div>
          <div>Longitud: <b>${fmt1(m.longitudKm)} km</b></div>

          <div>Temps cap a cap: <b>${fmt(m.tempsTotalViatge)} min</b></div>
          <div>Pobl. directa: <b>${fmt(m.poblacioDirecta)} hab.</b></div>

          <div>Pobl. influència: <b>${fmt(m.poblacioCaptacio)} hab.</b></div>
          <div class="metric-observed">OD observat/dia: <b>${fmt(m.totalOD)}</b></div>

          <div>Captats pel tren/dia: <b>${fmt(m.totalDesplaçamentsCapturats)}</b></div>
          <div>Vehicles evitats/dia: <b>${fmt(m.totalCotxesEliminats)}</b></div>

          <div>CO₂ estalviat: <b>${fmt(m.co2TonesAny)} t/any</b></div>
          <div>Cost estimat: <b>${fmt(m.costEstimat)} M€</b></div>
        </div>

        <div class="existing-row">
          <span>Via existent</span>
          <span>
            <input type="number"
                   data-role="existing"
                   data-id="${l.id}"
                   min="0"
                   max="${m.longitudKm.toFixed(1)}"
                   step=".5"
                   value="${clamp(finiteNumber(l.existingKm,0,0,100000),0,m.longitudKm).toFixed(1)}"> km
          </span>
        </div>

        <p class="linia-method">
          <b>OD observat/dia</b> prové de la matriu origen–destinació del MITMS.
          <b>Captats pel tren</b>, <b>vehicles evitats</b> i <b>CO₂</b> són resultats
          del model modal aplicat sobre aquesta demanda observada; no s'estimen
          els viatges a partir de la població.
        </p>

        ${m.sharedZones
          ? `<p class="linia-warning">${m.sharedZones} zones MITMS agregades toquen més d'una estació; s'assignen a l'estació que concentra més població dins l'àrea de captació.</p>`
          : ''}
      </div>`;
  }).join('');

  box.querySelectorAll('[data-action="edit"]').forEach(
    b=>b.onclick=()=>editarLinia(b.dataset.id)
  );
  box.querySelectorAll('[data-action="delete"]').forEach(
    b=>b.onclick=()=>esborrarLinia(b.dataset.id)
  );
  box.querySelectorAll('[data-role="rename"]').forEach(
    i=>i.onchange=()=>renombrarLinia(i.dataset.id,i.value)
  );
  box.querySelectorAll('[data-role="existing"]').forEach(i=>i.onchange=()=>{
    const l=linies.find(x=>x.id===i.dataset.id);
    if(l){
      const maxKm=calcularMetriquesLinia(l).longitudKm;
      l.existingKm=finiteInput(i.value,0,0,maxKm);
      saveState();
      render();
    }
  });
}
function renderResumGlobal(){const box=byId('resum-global');if(!linies.length){box.innerHTML='<p class="buida" style="grid-column:1/3">Dibuixa alguna línia per veure-hi el resum.</p>';return;}const ms=linies.map(calcularMetriquesLinia),stations=new Set();linies.forEach(l=>l.estacions.forEach(id=>stations.add(id)));const pop=[...stations].reduce((s,id)=>s+Number(MUNICIPI_PER_ID[id]?.pob||0),0),sum=k=>ms.reduce((s,m)=>s+Number(m[k]||0),0),items=[['Línies dibuixades',linies.length],['Km de xarxa',fmt1(sum('longitudKm'))],['Població directa',fmt(pop)],['Suma OD observat/dia',fmt(sum('totalOD'))],['Captats pel tren/dia',fmt(sum('totalDesplaçamentsCapturats'))],['Vehicles evitats/dia',fmt(sum('totalCotxesEliminats'))],['CO₂ estalviat (t/any)',fmt(sum('co2TonesAny'))],['Cost estimat (M€)',fmt(sum('costEstimat'))]];box.innerHTML=items.map(([l,n])=>`<div class="resum-item"><span class="num">${n}</span><span class="lbl">${l}</span></div>`).join('');}
function render(){renderMapa();renderLlistaLinies();renderResumGlobal();}

const defs=[['velocitatTren','v-velocitatTren',v=>v+' km/h'],['frequencia','v-frequencia',v=>v+' trens/h'],['velocitatCotxe','v-velocitatCotxe',v=>v+' km/h'],['tempsAcces','v-tempsAcces',v=>v+' min'],['tempsParada','v-tempsParada',v=>v+' min'],['intensitatMobilitat','v-intensitatMobilitat',v=>'x'+v],['sensibilitatDistancia','v-sensibilitatDistancia',v=>'x'+v],['sensibilitat','v-sensibilitat',v=>v],['biaix','v-biaix',v=>v],['fraccioCotxeActual','v-fraccioCotxeActual',v=>Math.round(v*100)+'%'],['costPerKm','v-costPerKm',v=>v+' M€'],['emissioPerKm','v-emissioPerKm',v=>v+' kg/km'],['radiCaptacio','v-radiCaptacio',v=>v+' km']];
defs.forEach(([k,label,format])=>{
  const input=byId('s-'+k), out=byId(label);
  if(!input || !out){
    console.warn('[Ferrocat] Control no trobat:', k, 'input=', !!input, 'label=', !!out);
    return;
  }
  input.value=parametres[k];
  const upd=()=>{
    const [min,max]=PARAM_LIMITS[k];
    parametres[k]=finiteInput(input.value,PARAM_DEFAULTS[k],min,max);
    input.value=parametres[k];
    out.textContent=format(input.value);
    saveState();
    render();
  };
  input.addEventListener('input',upd);
  out.textContent=format(input.value);
});
const chkFluxos=byId('chk-fluxos'), chkComarques=byId('chk-comarques');
if(chkFluxos){chkFluxos.checked=mostrarFluxos;chkFluxos.onchange=e=>{mostrarFluxos=e.target.checked;saveState();renderMapa();};}
if(chkComarques){chkComarques.checked=mostrarComarques;chkComarques.onchange=e=>{mostrarComarques=e.target.checked;saveState();renderMapa();};}
const btnStop=byId('btn-atura-edicio'),btnUndo=byId('btn-desfes'),btnReset=byId('btn-reset');
if(btnStop)btnStop.onclick=aturarEdicio;
if(btnUndo)btnUndo.onclick=desferUltimaEstacio;
if(btnReset)btnReset.onclick=()=>{linies=[];lineaActivaId=null;comptadorLinies=0;saveState();render();};
if(layerSelect){layerSelect.value=layerMode;layerSelect.onchange=e=>{layerMode=VALID_LAYER_MODES.has(e.target.value)?e.target.value:'procedural';layerSelect.value=layerMode;saveState();renderMapa();};}
render();
