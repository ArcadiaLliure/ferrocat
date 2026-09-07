/* Ferrocat feature: fixed-geometry terrain analysis, direct route dragging and route display toggle. */

const REAL_ROUTE_STATE_KEY='ferrocat-real-rail-route-v1';
let realRailRoute=true;
try{realRailRoute=sessionStorage.getItem(REAL_ROUTE_STATE_KEY)!=='false'}catch{}

/* --------------------------------------------------------------------------
 * Display geometry
 * --------------------------------------------------------------------------
 * User-created scenario lines can be displayed stop-to-stop. Imported services
 * stay on their real geometry until the runtime exposes authoritative stop order.
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
 * Topography: analyse exactly the XY route drawn by the user.
 * -------------------------------------------------------------------------- */
function fixedRouteSamples(coords,stepKm=.35){
  if(!Array.isArray(coords)||coords.length<2)return [];
  const out=[[+coords[0][0],+coords[0][1]]];
  for(let i=1;i<coords.length;i++){
    const a=coords[i-1],b=coords[i],km=havLL(a,b);
    const n=Math.max(1,Math.ceil(km/stepKm));
    for(let j=1;j<=n;j++){
      const t=j/n;
      out.push([+a[0]+(+b[0]-+a[0])*t,+a[1]+(+b[1]-+a[1])*t]);
    }
  }
  return out;
}

function fillTerrainGaps(values){
  const out=values.map(v=>Number.isFinite(v)?v:null),known=[];
  out.forEach((v,i)=>{if(v!==null)known.push(i)});
  if(!known.length)return null;
  for(let i=0;i<known[0];i++)out[i]=out[known[0]];
  for(let k=0;k<known.length-1;k++){
    const a=known[k],b=known[k+1],va=out[a],vb=out[b];
    for(let i=a+1;i<b;i++)out[i]=va+(vb-va)*(i-a)/(b-a);
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
      if(kind[s]!=='surface'&&len>=.25)structures.push({kind:kind[s],startKm:distKm[s],endKm:distKm[i-1],lengthKm:len});
      s=i;
    }
  }
  return structures;
}

analyzeTerrain=function(line){
  if(!terrainReady())return {warning:'No hi ha DEM runtime. Executa python -m pipelines.download_terrain'};
  const base=line?.alignment?.length>1
    ?line.alignment.map(q=>[+q[0],+q[1]])
    :(line?.stations||[]).map(id=>muniById[id]).filter(Boolean).map(m=>[+m.lon,+m.lat]);
  if(base.length<2)return {warning:'Calen almenys dos punts de traçat per analitzar la topografia.'};

  const coords=fixedRouteSamples(base);
  const rawTerrain=coords.map(q=>{
    const cell=terrainCell(q);if(!cell)return null;
    const z=elev(cell);return Number.isFinite(z)?+z:null;
  });
  const terrain=fillTerrainGaps(rawTerrain);
  if(!terrain)return {warning:'El traçat queda fora de la cobertura del DEM disponible.'};

  const distKm=[0];
  for(let i=1;i<coords.length;i++)distKm.push(distKm.at(-1)+havLL(coords[i-1],coords[i]));
  const rail=fixedRailProfile(terrain,distKm),structures=fixedRouteStructures(terrain,rail,distKm);
  let maxGradient=0;
  for(let i=1;i<rail.length;i++){
    const ds=Math.max(.001,(distKm[i]-distKm[i-1])*1000);
    maxGradient=Math.max(maxGradient,Math.abs(rail[i]-rail[i-1])/ds*1000);
  }
  const hasTunnel=structures.some(x=>x.kind==='tunnel');
  return {surfaceFeasible:!hasTunnel,usedTunnel:hasTunnel,optimizedCoords:coords,terrain,rail,distKm,structures,maxGradient,warning:null};
};

/* --------------------------------------------------------------------------
 * Gesture arbitration: active route vs map pan
 * --------------------------------------------------------------------------
 * Exact UX rule:
 *   IF pointerdown starts on the ACTIVE line, or on a station already selected
 *   in that active line -> edit the line.
 *   ELSE -> do nothing here; the legacy map-pan handler receives the gesture.
 *
 * The listener lives on parentElement in capture phase, i.e. one level ABOVE
 * the SVG. Therefore a route gesture is consumed before #mapa can initialise
 * its pan state. This is intentional and removes the previous race between the
 * route editor and the map drag handler.
 */
function editableAlignment(line){
  if(Array.isArray(line?.alignment)&&line.alignment.length>1)return line.alignment;
  const coords=(line?.stations||[])
    .map(id=>muniById[id])
    .filter(Boolean)
    .map(m=>[+m.lon,+m.lat]);
  if(coords.length>1)line.alignment=coords;
  return line?.alignment||[];
}

function routeMapUnitsPerPixel(){
  return state.vb.w/Math.max(1,svg.getBoundingClientRect().width);
}

function routeProjectOnSegment(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
  const t=l2?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2,0,1):0;
  const x=a[0]+t*dx,y=a[1]+t*dy;
  return {t,x,y,d:Math.hypot(p[0]-x,p[1]-y)};
}

function routeHit(line,cx,cy,maxPx=13){
  const alignment=editableAlignment(line);
  if(alignment.length<2)return null;
  const points=alignment.map(q=>project(...q));
  const p=svgPoint(cx,cy);
  let best=null;
  for(let i=1;i<points.length;i++){
    const q=routeProjectOnSegment(p,points[i-1],points[i]);
    if(!best||q.d<best.d)best={...q,segment:i};
  }
  return best&&best.d<=maxPx*routeMapUnitsPerPixel()?best:null;
}

function selectedStationHit(line,cx,cy,maxPx=15){
  const p=svgPoint(cx,cy),limit=maxPx*routeMapUnitsPerPixel();
  let best=null;
  for(const id of (line?.stations||[])){
    const m=muniById[id];
    if(!m)continue;
    const q=project(m.lon,m.lat),d=Math.hypot(p[0]-q[0],p[1]-q[1]);
    if(d<=limit&&(!best||d<best.d))best={m,d};
  }
  return best;
}

function nearestRouteHitToStation(line,station){
  const alignment=editableAlignment(line);
  if(alignment.length<2)return null;
  const points=alignment.map(q=>project(...q));
  const p=project(station.lon,station.lat);
  let best=null;
  for(let i=1;i<points.length;i++){
    const q=routeProjectOnSegment(p,points[i-1],points[i]);
    if(!best||q.d<best.d)best={...q,segment:i};
  }
  return best;
}

function routeHitLonLat(line,hit){
  const a=line.alignment[hit.segment-1],b=line.alignment[hit.segment];
  return [
    +a[0]+(+b[0]-+a[0])*hit.t,
    +a[1]+(+b[1]-+a[1])*hit.t
  ];
}

function nearestVertexToHit(line,hit,maxPx=5){
  const p=[hit.x,hit.y],limit=maxPx*routeMapUnitsPerPixel();
  const aIndex=hit.segment-1,bIndex=hit.segment;
  const ap=project(...line.alignment[aIndex]),bp=project(...line.alignment[bIndex]);
  const da=Math.hypot(p[0]-ap[0],p[1]-ap[1]);
  const db=Math.hypot(p[0]-bp[0],p[1]-bp[1]);
  if(Math.min(da,db)>limit)return null;
  return da<=db?aIndex:bIndex;
}

let directRouteDrag=null;

function consumeDirectRouteGesture(e){
  dragging=false;
  dragStart=null;
  vbStart=null;
  dragMoved=true;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

function beginDirectRouteDrag(line,hit,e,origin){
  const base=editableAlignment(line).map(q=>[+q[0],+q[1]]);
  if(base.length<2)return false;

  line.alignment=base.map(q=>[...q]);
  let index=nearestVertexToHit(line,hit);
  let inserted=false;
  if(index===null){
    const ll=routeHitLonLat(line,hit);
    index=hit.segment;
    line.alignment.splice(index,0,ll);
    inserted=true;
  }

  directRouteDrag={
    lineId:line.id,
    pointerId:e.pointerId,
    index,
    inserted,
    baseAlignment:base,
    startClient:[e.clientX,e.clientY],
    moved:false,
    origin
  };

  line.analysis=null;
  try{svg.setPointerCapture(e.pointerId)}catch{}
  consumeDirectRouteGesture(e);
  return true;
}

function pointerStartedInsideMap(e){
  return e.target===svg||svg.contains(e.target);
}

parentElement.addEventListener('pointerdown',e=>{
  if(e.button!==0||directRouteDrag||!pointerStartedInsideMap(e))return;

  const line=activeLine();
  if(!line)return; // ELSE: map pan

  // IF 1: station already selected in the active line.
  const station=selectedStationHit(line,e.clientX,e.clientY);
  if(station){
    const hit=nearestRouteHitToStation(line,station.m);
    if(hit)beginDirectRouteDrag(line,hit,e,'selected-station');
    return;
  }

  // IF 2: active line itself.
  const hit=routeHit(line,e.clientX,e.clientY);
  if(hit){
    beginDirectRouteDrag(line,hit,e,'line');
    return;
  }

  // ELSE: deliberately do not preventDefault/stopPropagation.
  // The normal map-pan code owns the gesture.
},{capture:true});

parentElement.addEventListener('pointermove',e=>{
  if(!directRouteDrag||e.pointerId!==directRouteDrag.pointerId)return;
  const line=state.lines.find(x=>x.id===directRouteDrag.lineId);
  if(!line)return;

  const dx=e.clientX-directRouteDrag.startClient[0];
  const dy=e.clientY-directRouteDrag.startClient[1];
  if(!directRouteDrag.moved&&Math.hypot(dx,dy)<2){
    consumeDirectRouteGesture(e);
    return;
  }

  directRouteDrag.moved=true;
  const mapPoint=svgPoint(e.clientX,e.clientY);
  line.alignment[directRouteDrag.index]=unproject(mapPoint[0],mapPoint[1]);
  line.analysis=null;
  renderScenario();
  renderLines();
  renderSummary();
  consumeDirectRouteGesture(e);
},{capture:true});

function finishDirectRouteDrag(e){
  if(!directRouteDrag)return;
  const drag=directRouteDrag;
  const line=state.lines.find(x=>x.id===drag.lineId);

  // A click without an actual drag only arbitrates intent; it must not alter
  // the geometry by leaving behind a newly inserted control vertex.
  if(line&&!drag.moved){
    line.alignment=drag.baseAlignment.map(q=>[...q]);
  }
  if(line)line.analysis=null;

  directRouteDrag=null;
  save();
  render();
  consumeDirectRouteGesture(e);
}

parentElement.addEventListener('pointerup',e=>{
  if(directRouteDrag&&e.pointerId===directRouteDrag.pointerId)finishDirectRouteDrag(e);
},{capture:true});

parentElement.addEventListener('pointercancel',e=>{
  if(directRouteDrag&&e.pointerId===directRouteDrag.pointerId)finishDirectRouteDrag(e);
},{capture:true});
