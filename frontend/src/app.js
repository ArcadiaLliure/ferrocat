/**
 * app.js (entry)
 * -----------------------------------------------------------------------
 * Punt d'entrada del component Ferrocat. Es bundleja amb esbuild a
 * dist/ferrocat.bundle.js (vegeu build.mjs) i s'injecta per app.py dins
 * `export default function(component){ ... }` de Streamlit Components V2.
 *
 * Aquest fitxer conserva la responsabilitat de mapa/UI (renderMapa,
 * picking, labels, OSM, sidebar). El càlcul de dominio (temps, cost,
 * captació, model modal) viu a ./domain/*, importat aquí com a funcions
 * pures. Aquesta separació és la que permet testejar el domini amb
 * Vitest sense cap DOM ni SVG (secció 35: "una funció de rendering NO
 * ha de calcular demanda; una funció de dominio NO ha de manipular DOM").
 * -----------------------------------------------------------------------
 */
import { distanciaKm } from './domain/mobility.js';
import { calcularMetriquesLinia } from './domain/metrics.js';
import { resumXarxa } from './domain/network.js';
import { segmentsFromStations, setInfrastructureType, migrarLineaASegments } from './domain/line.js';

const COLORS_LINIA = ['#e63946','#2a9d8f','#f4a300','#8338ec','#3a86ff','#06d6a0','#ff6b35','#c9184a'];
const BASE_VB = {x:0,y:0,w:800,h:660};
const MARGE_PROJECCIO = 30;

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
  intensitatMobilitat:1.12,
  sensibilitatDistancia:1.20,
  sensibilitat:0.08,
  biaix:0.8,
  fraccioCotxeActual:0.75,
  costPerKm:12,
  emissioPerKm:0.15,
  diesPerAny:250,
  radiCaptacio:8,
};

const MUNICIPI_PER_ID = Object.fromEntries(MUNICIPIS.map(m => [String(m.id), m]));
const svg = parentElement.querySelector('#mapa');
const hoverBox = parentElement.querySelector('#hover-box');
const layerSelect = parentElement.querySelector('#layer-select');
const osmAttribution = parentElement.querySelector('#osm-attribution');

function byId(id){ return parentElement.querySelector(`#${id}`); }
function setLayerHTML(id, html){
  const el=byId(id);
  if(!el){ console.warn(`[Catatrens] Falta #${id}`); return false; }
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

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'catatrens-state-v9';

function saveState(){
  try{
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      linies, comptadorLinies, lineaActivaId, mostrarFluxos, mostrarComarques,
      layerMode, vb, parametres
    }));
  }catch{}
}
function restoreState(){
  try{
    let s=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'null');
    if(!s){
      s=JSON.parse(sessionStorage.getItem('catatrens-state-v8')||'null');
    }
    if(!s)return;
    linies=Array.isArray(s.linies)?s.linies:linies;
    linies=linies.map(l=>({...l, segments: migrarLineaASegments(l)}));
    comptadorLinies=Number(s.comptadorLinies||0);
    lineaActivaId=s.lineaActivaId??null;
    mostrarFluxos=s.mostrarFluxos??true;
    mostrarComarques=s.mostrarComarques??true;
    layerMode=s.layerMode||'procedural';
    if(s.vb)vb=s.vb;
    if(s.parametres)Object.assign(parametres,s.parametres);
  }catch{}
}
restoreState();

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

function metriquesLinia(l){
  return calcularMetriquesLinia(l, MUNICIPIS, OD_PAIRS, parametres);
}

function seleccionarMunicipi(id){
  id=String(id);
  if(lineaActivaId===null){
    comptadorLinies++;
    const nova={id:'linia-'+comptadorLinies,nom:'Línia '+comptadorLinies,color:COLORS_LINIA[(comptadorLinies-1)%COLORS_LINIA.length],estacions:[id],segments:[]};
    linies.push(nova);lineaActivaId=nova.id;
  }else{
    const l=linies.find(x=>x.id===lineaActivaId);if(!l){lineaActivaId=null;return;}
    if(l.estacions.includes(id))return;
    l.estacions.push(id);
    l.segments=segmentsFromStations(l.estacions,l.segments);
  }
  saveState();render();
}
function aturarEdicio(){lineaActivaId=null;saveState();render();}
function desferUltimaEstacio(){
  if(lineaActivaId===null)return;const l=linies.find(x=>x.id===lineaActivaId);if(!l)return;
  l.estacions.pop();
  if(!l.estacions.length){linies=linies.filter(x=>x.id!==l.id);lineaActivaId=null;}
  else l.segments=segmentsFromStations(l.estacions,l.segments);
  saveState();render();
}
function esborrarLinia(id){linies=linies.filter(l=>l.id!==id);if(lineaActivaId===id)lineaActivaId=null;saveState();render();}
function editarLinia(id){lineaActivaId=id;saveState();render();}
function renombrarLinia(id,nom){const l=linies.find(x=>x.id===id);if(l){l.nom=nom||l.nom;saveState();render();}}
function canviarInfraestructuraTram(lineaId,fromId,toId,tipus){
  const l=linies.find(x=>x.id===lineaId);
  if(!l)return;
  l.segments=setInfrastructureType(l.segments||[],fromId,toId,tipus);
  saveState();render();
}

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
  if(!capa){ console.warn('[Catatrens] Falta #capa-comarques'); return; }
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
  if(!capa){ console.warn('[Catatrens] Falta #capa-hover'); return; }
  const m=hoveredId?MUNICIPI_PER_ID[hoveredId]:null;
  if(!m){capa.innerHTML='';return;}
  const r=11/Math.max(zoomFactor(),.01);
  capa.innerHTML=`<circle class="hover-ring" cx="${m.x}" cy="${m.y}" r="${r}"/>`;
}

function lonLatToTile(lon,lat,z){const n=2**z,r=lat*Math.PI/180;return [(lon+180)/360*n,(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n];}
function tileToLonLat(x,y,z){const n=2**z,lon=x/n*360-180,a=Math.PI-2*Math.PI*y/n;return [lon,180/Math.PI*Math.atan(Math.sinh(a))];}
function renderOSM(){
  const capa=byId('capa-osm'),grid=byId('grid-bg'),bg=byId('map-bg');
  if(!capa || !grid || !bg){ console.warn('[Catatrens] Capes OSM incompletes'); return; }
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
  svg.setAttribute('viewBox',`${vb.x} ${vb.y} ${vb.w} ${vb.h}`);renderOSM();renderComarques();
  const metrics=linies.map(l=>({linia:l,m:metriquesLinia(l)})),z=zoomFactor(),inv=1/Math.max(z,.01);
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
    const m=metriquesLinia(l);
    const activa=l.id===lineaActivaId;
    const nomsEstacions=m.estacions.map(e=>e.nom).join(' → ');
    const nomPerId=id=>MUNICIPI_PER_ID[id]?.nom||id;

    const tramsHtml=(m.segments||[]).map(s=>{
      const label=s.infrastructureType==='existing'?'Exist.':(s.infrastructureType==='upgrade'?'Millora':'Nou');
      return `<div class="tram-item">
        <span class="tram-label tram-${esc(s.infrastructureType)}">${label}</span>
        <span class="tram-route">${esc(nomPerId(s.fromStationId))} → ${esc(nomPerId(s.toStationId))}</span>
        <span class="tram-km">${fmt1(s.longitudKm)} km</span>
        <select data-role="tram-tipus" data-linia="${l.id}" data-from="${s.fromStationId}" data-to="${s.toStationId}">
          <option value="new" ${s.infrastructureType==='new'?'selected':''}>Nou</option>
          <option value="existing" ${s.infrastructureType==='existing'?'selected':''}>Existent</option>
          <option value="upgrade" ${s.infrastructureType==='upgrade'?'selected':''}>Millora</option>
        </select>
      </div>`;
    }).join('');

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

        <details class="trams-detall">
          <summary>Trams (${m.segments.length}) · ${fmt1(m.kmNous)} km nous · ${fmt1(m.kmExistents)} km existents</summary>
          <div class="trams-llista">${tramsHtml || '<p class="buida">Cap tram encara.</p>'}</div>
        </details>

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

  box.querySelectorAll('[data-action="edit"]').forEach(b=>b.onclick=()=>editarLinia(b.dataset.id));
  box.querySelectorAll('[data-action="delete"]').forEach(b=>b.onclick=()=>esborrarLinia(b.dataset.id));
  box.querySelectorAll('[data-role="rename"]').forEach(i=>i.onchange=()=>renombrarLinia(i.dataset.id,i.value));
  box.querySelectorAll('[data-role="tram-tipus"]').forEach(sel=>sel.onchange=()=>{
    canviarInfraestructuraTram(sel.dataset.linia, sel.dataset.from, sel.dataset.to, sel.value);
  });
}

function renderResumGlobal(){
  const box=byId('resum-global');
  const titol=byId('resum-global-titol');
  if(!linies.length){box.innerHTML='<p class="buida" style="grid-column:1/3">Dibuixa alguna línia per veure-hi el resum.</p>';return;}
  const ms=linies.map(metriquesLinia);
  const resum=resumXarxa(ms, linies);
  if(titol) titol.textContent=resum.etiqueta;
  const items=[
    ['Línies dibuixades',resum.numLinies],
    ['Km de xarxa',fmt1(resum.kmXarxa)],
    ['Estacions úniques',resum.estacionsUniques],
    ['Suma OD observat/dia',fmt(resum.totalOD)],
    ['Captats pel tren/dia',fmt(resum.totalCaptats)],
    ['Vehicles evitats/dia',fmt(resum.totalVehiclesEvitats)],
    ['CO₂ estalviat (t/any)',fmt(resum.totalCo2TonesAny)],
    ['Cost estimat (M€)',fmt(resum.totalCostEstimat)],
  ];
  box.innerHTML=items.map(([l,n])=>`<div class="resum-item"><span class="num">${n}</span><span class="lbl">${l}</span></div>`).join('');
  if(!resum.isNetworkAssignment){
    box.innerHTML += `<p class="linia-warning" style="grid-column:1/3">Aquesta xifra pot duplicar OD si dues línies capten el mateix trajecte: encara no hi ha assignació de xarxa completa.</p>`;
  }
}
function render(){renderMapa();renderLlistaLinies();renderResumGlobal();}

const defs=[['velocitatTren','v-velocitatTren',v=>v+' km/h'],['frequencia','v-frequencia',v=>v+' trens/h'],['velocitatCotxe','v-velocitatCotxe',v=>v+' km/h'],['tempsAcces','v-tempsAcces',v=>v+' min'],['tempsParada','v-tempsParada',v=>v+' min'],['intensitatMobilitat','v-intensitatMobilitat',v=>'x'+v],['sensibilitatDistancia','v-sensibilitatDistancia',v=>'x'+v],['sensibilitat','v-sensibilitat',v=>v],['biaix','v-biaix',v=>v],['fraccioCotxeActual','v-fraccioCotxeActual',v=>Math.round(v*100)+'%'],['costPerKm','v-costPerKm',v=>v+' M€'],['emissioPerKm','v-emissioPerKm',v=>v+' kg/km'],['radiCaptacio','v-radiCaptacio',v=>v+' km']];
defs.forEach(([k,label,format])=>{
  const input=byId('s-'+k), out=byId(label);
  if(!input || !out){
    console.warn('[Catatrens] Control no trobat:', k, 'input=', !!input, 'label=', !!out);
    return;
  }
  input.value=parametres[k];
  const upd=()=>{
    parametres[k]=parseFloat(input.value);
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
if(layerSelect){layerSelect.value=layerMode;layerSelect.onchange=e=>{layerMode=e.target.value;saveState();renderMapa();};}
render();
