/* Ferrocat feature: fixed-geometry terrain analysis, drag-anywhere route editing and route display toggle. */

const REAL_ROUTE_STATE_KEY='ferrocat-real-rail-route-v1';
let realRailRoute=true;
try{realRailRoute=sessionStorage.getItem(REAL_ROUTE_STATE_KEY)!=='false'}catch{}

/* --------------------------------------------------------------------------
 * Display geometry
 * --------------------------------------------------------------------------
 * For user-created scenario lines we can safely join the explicitly selected
 * stations. Imported services stay on their real geometry for now: the runtime
 * payload does not yet expose the authoritative ordered stop sequence, and we
 * deliberately avoid guessing stops from geometric proximity.
 */
function routeStationCandidates(line){
  if(!line||line.sourceServiceId)return [];
  return (line.stations||[])
    .map(id=>muniById[id])
    .filter(Boolean)
    .map(m=>[+m.lon,+m.lat]);
}

function displayedLineCoords(line){
  if(realRailRoute)return lineCoords(line);
  const stops=routeStationCandidates(line);
  return stops.length>1?stops:lineCoords(line);
}

// Rendering only: metrics, terrain analysis and infrastructure costs continue
// using lineCoords(). Existing operator services are intentionally unchanged
// until their real ordered stop sequence is exported by the data pipeline.
scenarioSegmentGroups=function(){
  const map=new Map();
  state.lines.forEach(l=>{
    const c=displayedLineCoords(l);
    for(let i=1;i<c.length;i++){
      const a=c[i-1],b=c[i];
      const ka=`${a[0].toFixed(5)},${a[1].toFixed(5)}`;
      const kb=`${b[0].toFixed(5)},${b[1].toFixed(5)}`;
      const key=ka<kb?ka+'|'+kb:kb+'|'+ka;
      if(!map.has(key))map.set(key,{a:project(...a),b:project(...b),lines:[]});
      map.get(key).lines.push(l);
    }
  });
  return map;
};

function installRealRouteToggle(){
  const toolbar=parentElement.querySelector('.layer-toolbar');
  if(!toolbar||byId('chk-real-rail-route'))return;
  const label=document.createElement('label');
  label.innerHTML='<input id="chk-real-rail-route" type="checkbox"> Recorregut ferroviari real';
  toolbar.appendChild(label);
  const chk=byId('chk-real-rail-route');
  chk.checked=realRailRoute;
  chk.onchange=()=>{
    realRailRoute=chk.checked;
    try{sessionStorage.setItem(REAL_ROUTE_STATE_KEY,String(realRailRoute))}catch{}
    renderScenario();
  };
}
installRealRouteToggle();

/* --------------------------------------------------------------------------
 * Topography: analyse the route the user drew; never search a new XY route.
 * -------------------------------------------------------------------------- */
function fixedRouteSamples(coords,stepKm=.35){
  if(!Array.isArray(coords)||coords.length<2)return [];
  const out=[[+coords[0][0],+coords[0][1]]];
  for(let i=1;i<coords.length;i++){
    const a=coords[i-1],b=coords[i],km=havLL(a,b);
    const n=Math.max(1,Math.ceil(km/stepKm));
    for(let j=1;j<=n;j++){
      const t=j/n;
      out.push([
        +a[0]+(+b[0]-+a[0])*t,
        +a[1]+(+b[1]-+a[1])*t
      ]);
    }
  }
  return out;
}

function fillTerrainGaps(values){
  const out=values.map(v=>Number.isFinite(v)?v:null);
  const known=[];
  out.forEach((v,i)=>{if(v!==null)known.push(i)});
  if(!known.length)return null;
  for(let i=0;i<known[0];i++)out[i]=out[known[0]];
  for(let k=0;k<known.length-1;k++){
    const a=known[k],b=known[k+1],va=out[a],vb=out[b];
    for(let i=a+1;i<b;i++){
      const t=(i-a)/(b-a);
      out[i]=va+(vb-va)*t;
    }
  }
  for(let i=known.at(-1)+1;i<out.length;i++)out[i]=out[known.at(-1)];
  return out;
}

function fixedRailProfile(terrain,distKm){
  const rail=[...terrain],g=Math.max(1,+params.maxGradient||35)/1000;
  const start=terrain[0],end=terrain.at(-1);
  for(let pass=0;pass<10;pass++){
    rail[0]=start;
    for(let i=1;i<rail.length;i++){
      const ds=Math.max(.001,(distKm[i]-distKm[i-1])*1000);
      rail[i]=clamp(rail[i],rail[i-1]-g*ds,rail[i-1]+g*ds);
    }
    rail[rail.length-1]=end;
    for(let i=rail.length-2;i>=0;i--){
      const ds=Math.max(.001,(distKm[i+1]-distKm[i])*1000);
      rail[i]=clamp(rail[i],rail[i+1]-g*ds,rail[i+1]+g*ds);
    }
  }
  return rail;
}

function fixedRouteStructures(terrain,rail,distKm){
  const kind=terrain.map((z,i)=>z-rail[i]>25?'tunnel':rail[i]-z>18?'viaduct':'surface');
  const structures=[];
  let s=0;
  for(let i=1;i<=kind.length;i++){
    if(i===kind.length||kind[i]!==kind[s]){
      const len=distKm[i-1]-distKm[s];
      if(kind[s]!=='surface'&&len>=.25){
        structures.push({kind:kind[s],startKm:distKm[s],endKm:distKm[i-1],lengthKm:len});
      }
      s=i;
    }
  }
  return structures;
}

// Override the original path-finding analysis. The XY trace is now immutable:
// only its vertical profile/rasant is estimated from the DEM.
analyzeTerrain=function(line){
  if(!terrainReady())return {warning:'No hi ha DEM runtime. Executa python -m pipelines.download_terrain'};
  const base=line?.alignment?.length>1
    ?line.alignment.map(q=>[+q[0],+q[1]])
    :(line?.stations||[]).map(id=>muniById[id]).filter(Boolean).map(m=>[+m.lon,+m.lat]);
  if(base.length<2)return {warning:'Calen almenys dos punts de traçat per analitzar la topografia.'};

  const coords=fixedRouteSamples(base);
  const rawTerrain=coords.map(q=>{
    const cell=terrainCell(q);
    if(!cell)return null;
    const z=elev(cell);
    return Number.isFinite(z)?+z:null;
  });
  const terrain=fillTerrainGaps(rawTerrain);
  if(!terrain)return {warning:'El traçat queda fora de la cobertura del DEM disponible.'};

  const distKm=[0];
  for(let i=1;i<coords.length;i++)distKm.push(distKm.at(-1)+havLL(coords[i-1],coords[i]));
  const rail=fixedRailProfile(terrain,distKm);
  const structures=fixedRouteStructures(terrain,rail,distKm);
  let maxGradient=0;
  for(let i=1;i<rail.length;i++){
    const ds=Math.max(.001,(distKm[i]-distKm[i-1])*1000);
    maxGradient=Math.max(maxGradient,Math.abs(rail[i]-rail[i-1])/ds*1000);
  }
  const hasTunnel=structures.some(x=>x.kind==='tunnel');
  return {
    surfaceFeasible:!hasTunnel,
    usedTunnel:hasTunnel,
    optimizedCoords:coords,
    terrain,
    rail,
    distKm,
    structures,
    maxGradient,
    warning:null
  };
};

/* --------------------------------------------------------------------------
 * Google-Maps-like route dragging.
 * -------------------------------------------------------------------------- */
function ensureEditableAlignment(line){
  if(line?.alignment?.length>1)return line.alignment;
  const coords=(line?.stations||[])
    .map(id=>muniById[id])
    .filter(Boolean)
    .map(m=>[+m.lon,+m.lat]);
  if(coords.length>1)line.alignment=coords;
  return line?.alignment||[];
}

function nearestAlignmentSegmentFromScreen(line,cx,cy,maxPx=14){
  const alignment=ensureEditableAlignment(line);
  if(alignment.length<2)return null;
  const p=svgPoint(cx,cy);
  let best=null;
  for(let i=1;i<alignment.length;i++){
    const a=project(...alignment[i-1]),b=project(...alignment[i]);
    const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
    const t=l2?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2,0,1):0;
    const x=a[0]+t*dx,y=a[1]+t*dy,d=Math.hypot(p[0]-x,p[1]-y);
    if(!best||d<best.d)best={segment:i,t,d,mapPoint:[x,y]};
  }
  const mapUnitsPerPx=state.vb.w/Math.max(1,svg.getBoundingClientRect().width);
  return best&&best.d<=maxPx*mapUnitsPerPx?best:null;
}

function snapCandidates(){
  const rows=[];
  const seen=new Set();
  const add=(lon,lat,name='')=>{
    if(!Number.isFinite(+lon)||!Number.isFinite(+lat))return;
    const key=`${(+lon).toFixed(6)},${(+lat).toFixed(6)}`;
    if(seen.has(key))return;
    seen.add(key);rows.push({coord:[+lon,+lat],name});
  };
  for(const s of REAL_STATIONS)add(s.lon,s.lat,s.name||'');
  for(const line of state.lines){
    for(const id of line.stations||[]){
      const m=muniById[id];if(m)add(m.lon,m.lat,m.nom||'');
    }
  }
  return rows;
}

function snapRoutePoint(cx,cy,maxPx=15){
  const p=svgPoint(cx,cy),mapUnitsPerPx=state.vb.w/Math.max(1,svg.getBoundingClientRect().width);
  const limit=maxPx*mapUnitsPerPx;
  let best=null;
  for(const s of snapCandidates()){
    const q=project(...s.coord),d=Math.hypot(p[0]-q[0],p[1]-q[1]);
    if(d<=limit&&(!best||d<best.d))best={...s,d};
  }
  return best;
}

function drawActiveRoutePoint(coord,snapped=false){
  const layer=byId('capa-linies');
  if(!layer||!coord)return;
  const old=layer.querySelector('#route-drag-handle');if(old)old.remove();
  const [x,y]=project(...coord);
  const r=5.2*state.vb.w/Math.max(300,svg.getBoundingClientRect().width);
  const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
  circle.setAttribute('id','route-drag-handle');circle.setAttribute('cx',x);circle.setAttribute('cy',y);circle.setAttribute('r',r);
  circle.setAttribute('fill',snapped?'#ffd166':'#ffffff');circle.setAttribute('stroke','#ff6b35');circle.setAttribute('stroke-width',Math.max(.7,r*.35));
  circle.setAttribute('vector-effect','non-scaling-stroke');circle.style.pointerEvents='none';
  layer.appendChild(circle);
}

let freeRouteDrag=false;

// Clicking any point of the active route inserts a control point exactly on
// that segment (unless the click is already very close to an existing vertex).
svg.addEventListener('pointerdown',e=>{
  if(state.tool!=='trace'||alignmentDrag||e.target?.dataset?.alignIndex!==undefined)return;
  const line=activeLine();
  if(!line)return;
  const hit=nearestAlignmentSegmentFromScreen(line,e.clientX,e.clientY);
  if(!hit)return;
  const alignment=ensureEditableAlignment(line);
  const p=svgPoint(e.clientX,e.clientY);
  const prev=project(...alignment[hit.segment-1]),next=project(...alignment[hit.segment]);
  const mapUnitsPerPx=state.vb.w/Math.max(1,svg.getBoundingClientRect().width);
  const vertexRadius=5*mapUnitsPerPx;
  let index;
  if(Math.hypot(p[0]-prev[0],p[1]-prev[1])<=vertexRadius)index=hit.segment-1;
  else if(Math.hypot(p[0]-next[0],p[1]-next[1])<=vertexRadius)index=hit.segment;
  else{
    index=hit.segment;
    alignment.splice(index,0,unproject(hit.mapPoint[0],hit.mapPoint[1]));
  }
  line.analysis=null;
  alignmentDrag={lineId:line.id,index};
  freeRouteDrag=true;
  dragMoved=false;
  try{svg.setPointerCapture(e.pointerId)}catch{}
  drawActiveRoutePoint(alignment[index],false);
  e.preventDefault();
  e.stopImmediatePropagation();
},{capture:true});

// All alignment drags, including old visible handles, get magnetic station
// snapping. Capture phase prevents the legacy pointermove from overwriting the
// snapped coordinate with the raw cursor position.
svg.addEventListener('pointermove',e=>{
  if(!alignmentDrag||state.tool!=='trace')return;
  const line=state.lines.find(x=>x.id===alignmentDrag.lineId);
  if(!line?.alignment?.[alignmentDrag.index])return;
  const snapped=snapRoutePoint(e.clientX,e.clientY);
  const coord=snapped?.coord||unproject(...svgPoint(e.clientX,e.clientY));
  line.alignment[alignmentDrag.index]=[+coord[0],+coord[1]];
  line.analysis=null;
  dragMoved=true;
  renderScenario();
  renderLines();
  renderSummary();
  drawActiveRoutePoint(line.alignment[alignmentDrag.index],!!snapped);
  e.preventDefault();
  e.stopImmediatePropagation();
},{capture:true});

svg.addEventListener('pointerup',()=>{
  freeRouteDrag=false;
  const h=byId('capa-linies')?.querySelector('#route-drag-handle');if(h)h.remove();
},{capture:true});
