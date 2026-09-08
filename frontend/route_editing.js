/* Ferrocat feature: fixed-geometry terrain analysis, reliable route dragging and route display toggle. */

const REAL_ROUTE_STATE_KEY='ferrocat-real-rail-route-v1';
let realRailRoute=true;
try{realRailRoute=sessionStorage.getItem(REAL_ROUTE_STATE_KEY)!=='false'}catch{}

/* --------------------------------------------------------------------------
 * Display geometry
 * -------------------------------------------------------------------------- */
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
 * Topography: analyse exactly the XY route chosen by the user.
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
      if(kind[s]!=='surface'&&len>=.25){
        structures.push({kind:kind[s],startKm:distKm[s],endKm:distKm[i-1],lengthKm:len});
      }
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
 * Route-drag vs map-pan arbitration
 * --------------------------------------------------------------------------
 * The previous implementation used svg.getBoundingClientRect() as if the SVG
 * viewBox filled that rectangle. It does not: #mapa uses
 * preserveAspectRatio="xMidYMid meet", so the real SVG content can be
 * letterboxed. That made the synthetic hit-test miss the line/station while the
 * legacy map pointerdown still armed panning.
 *
 * All hit testing below is therefore done in the SVG's real user coordinate
 * system through getScreenCTM().inverse(). The geometry tested is also the exact
 * geometry currently rendered (displayedLineCoords), not always line.alignment.
 *
 * Ownership rule:
 *   IF primary pointerdown hits a scenario line OR a station already belonging
 *      to a scenario line -> route drag consumes the complete pointer sequence.
 *   ELSE -> this extension does nothing and the existing map-pan handler owns it.
 * -------------------------------------------------------------------------- */

function routeClientPoint(cx,cy){
  const ctm=svg.getScreenCTM();
  if(ctm){
    const p=svg.createSVGPoint();
    p.x=cx;p.y=cy;
    const q=p.matrixTransform(ctm.inverse());
    return [q.x,q.y];
  }
  return svgPoint(cx,cy);
}

function routeUserUnitsPerPixel(){
  const ctm=svg.getScreenCTM();
  if(ctm){
    const sx=Math.hypot(ctm.a,ctm.b);
    const sy=Math.hypot(ctm.c,ctm.d);
    const scale=(sx+sy)/2;
    if(Number.isFinite(scale)&&scale>0)return 1/scale;
  }
  return state.vb.w/Math.max(1,svg.getBoundingClientRect().width);
}

function routeProjectOnSegment(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
  const t=l2?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2,0,1):0;
  const x=a[0]+t*dx,y=a[1]+t*dy;
  return {t,x,y,d:Math.hypot(p[0]-x,p[1]-y),segLen:Math.sqrt(l2)};
}

function routeMeasure(line){
  const coords=displayedLineCoords(line);
  const points=(coords||[]).map(q=>project(+q[0],+q[1]));
  const cumulative=[0];
  for(let i=1;i<points.length;i++){
    cumulative.push(cumulative.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  }
  return {coords,points,cumulative,total:cumulative.at(-1)||0};
}

function closestPointOnMeasuredRoute(measure,p){
  let best=null;
  for(let i=1;i<measure.points.length;i++){
    const q=routeProjectOnSegment(p,measure.points[i-1],measure.points[i]);
    if(!best||q.d<best.d){
      best={...q,segment:i,along:measure.cumulative[i-1]+q.segLen*q.t};
    }
  }
  return best;
}

function routeHit(line,cx,cy,maxPx=15){
  const measure=routeMeasure(line);
  if(measure.points.length<2)return null;
  const hit=closestPointOnMeasuredRoute(measure,routeClientPoint(cx,cy));
  const limit=maxPx*routeUserUnitsPerPixel();
  return hit&&hit.d<=limit?{measure,hit}:null;
}

function bestScenarioLineHit(cx,cy){
  let best=null;
  for(const line of state.lines){
    const row=routeHit(line,cx,cy);
    if(!row)continue;
    const activeBias=line.id===state.activeId?-1e-7:0;
    const score=row.hit.d+activeBias;
    if(!best||score<best.score)best={line,...row,score};
  }
  return best;
}

function bestSelectedStationHit(cx,cy,maxPx=18){
  const p=routeClientPoint(cx,cy),limit=maxPx*routeUserUnitsPerPixel();
  let best=null;
  for(const line of state.lines){
    for(let stationIndex=0;stationIndex<(line.stations||[]).length;stationIndex++){
      const m=muniById[line.stations[stationIndex]];
      if(!m)continue;
      const q=project(m.lon,m.lat),d=Math.hypot(p[0]-q[0],p[1]-q[1]);
      if(d>limit)continue;
      const activeBias=line.id===state.activeId?-1e-7:0;
      const score=d+activeBias;
      if(!best||score<best.score)best={line,stationIndex,m,d,score};
    }
  }
  return best;
}

function routeMunicipalitySnap(cx,cy,maxPx=20,excludeId=null){
  const p=routeClientPoint(cx,cy),limit=maxPx*routeUserUnitsPerPixel();
  let best=null;
  for(const m of MUNICIPIS){
    if(excludeId!==null&&String(m.id)===String(excludeId))continue;
    const d=Math.hypot(p[0]-m.x,p[1]-m.y);
    if(d<=limit&&(!best||d<best.d))best={m,d,coord:[+m.lon,+m.lat]};
  }
  return best;
}

function alignmentForScenario(line){
  if(Array.isArray(line.alignment)&&line.alignment.length>1){
    return line.alignment.map(q=>[+q[0],+q[1]]);
  }
  return (line.stations||[])
    .map(id=>muniById[id])
    .filter(Boolean)
    .map(m=>[+m.lon,+m.lat]);
}

function alignmentMeasure(coords){
  const points=coords.map(q=>project(...q)),cumulative=[0];
  for(let i=1;i<points.length;i++){
    cumulative.push(cumulative.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  }
  return {coords,points,cumulative};
}

function stationAnchorsOnAlignment(line,baseAlignment){
  const m=alignmentMeasure(baseAlignment),rows=[];
  let minAlong=-Infinity;
  for(let stationIndex=0;stationIndex<(line.stations||[]).length;stationIndex++){
    const station=muniById[line.stations[stationIndex]];
    if(!station)continue;
    const p=project(station.lon,station.lat);
    let best=null;
    for(let i=1;i<m.points.length;i++){
      const q=routeProjectOnSegment(p,m.points[i-1],m.points[i]);
      const along=m.cumulative[i-1]+q.segLen*q.t;
      if(along+1e-6<minAlong)continue;
      if(!best||q.d<best.d)best={...q,segment:i,along};
    }
    if(!best)continue;
    minAlong=Math.max(minAlong,best.along);
    const before=Math.max(0,best.segment-1),after=Math.min(baseAlignment.length-1,best.segment);
    const db=Math.hypot(p[0]-m.points[before][0],p[1]-m.points[before][1]);
    const da=Math.hypot(p[0]-m.points[after][0],p[1]-m.points[after][1]);
    rows.push({
      stationIndex,
      station,
      along:best.along,
      vertexIndex:db<=da?before:after
    });
  }
  return rows;
}

function stationIndexForLineHit(line,row,baseAlignment,cx,cy){
  if(!(line.stations||[]).length)return null;

  // When the stop-to-stop view is shown, the rendered segment index maps
  // directly to the next stop in the ordered station list.
  if(!realRailRoute&&!line.sourceServiceId){
    return clamp(row.hit.segment,0,line.stations.length-1);
  }

  const anchors=stationAnchorsOnAlignment(line,baseAlignment);
  if(!anchors.length)return null;

  // Convert the pointer hit to the alignment measure, because the rendered
  // geometry can be a densified analysis line.
  const pointer=routeClientPoint(cx,cy);
  const am=alignmentMeasure(baseAlignment);
  const ah=closestPointOnMeasuredRoute(am,pointer);
  const along=ah?.along??0;
  const eps=2*routeUserUnitsPerPixel();
  for(const a of anchors){
    if(a.along>along+eps)return a.stationIndex;
  }
  return anchors.at(-1).stationIndex;
}

function pivotGeometryForStation(drag,coord){
  const base=drag.baseAlignment;
  const out=[];
  if(drag.prevVertex!==null){
    for(let i=0;i<=drag.prevVertex;i++)out.push([+base[i][0],+base[i][1]]);
  }
  out.push([+coord[0],+coord[1]]);
  if(drag.nextVertex!==null){
    for(let i=drag.nextVertex;i<base.length;i++)out.push([+base[i][0],+base[i][1]]);
  }
  return out.length>1?out:base.map(q=>[...q]);
}

function drawRouteDragHandle(coord,snapped=false){
  const layer=byId('capa-linies');if(!layer||!coord)return;
  const old=layer.querySelector('#route-drag-handle');if(old)old.remove();
  const [x,y]=project(...coord),r=6*routeUserUnitsPerPixel();
  const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.id='route-drag-handle';
  c.setAttribute('cx',x);c.setAttribute('cy',y);c.setAttribute('r',r);
  c.setAttribute('fill',snapped?'#ffd166':'#ffffff');
  c.setAttribute('stroke','#ff6b35');c.setAttribute('stroke-width',2);
  c.setAttribute('vector-effect','non-scaling-stroke');
  c.style.pointerEvents='none';
  layer.appendChild(c);
}

function clearRouteDragHandle(){
  const h=byId('capa-linies')?.querySelector('#route-drag-handle');if(h)h.remove();
}

let routeDrag=null;

function consumeRouteGesture(e){
  // The old map listener stores pan state in these globals. Reset them before
  // stopping propagation so a route gesture can never continue a map pan.
  dragging=false;
  dragMoved=true;
  dragStart=null;
  vbStart=null;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

function beginStationRouteDrag(line,stationIndex,e,origin){
  const baseAlignment=alignmentForScenario(line);
  if(baseAlignment.length<2)return false;
  const anchors=stationAnchorsOnAlignment(line,baseAlignment);
  const pos=anchors.findIndex(a=>a.stationIndex===stationIndex);
  if(pos<0)return false;

  const station=muniById[line.stations[stationIndex]];
  if(!station)return false;

  routeDrag={
    type:'station',
    lineId:line.id,
    pointerId:e.pointerId,
    stationIndex,
    originalStationId:String(line.stations[stationIndex]),
    baseStations:[...line.stations],
    baseAlignment:baseAlignment.map(q=>[...q]),
    prevVertex:pos>0?anchors[pos-1].vertexIndex:null,
    nextVertex:pos<anchors.length-1?anchors[pos+1].vertexIndex:null,
    startClient:[e.clientX,e.clientY],
    moved:false,
    snapped:null,
    origin
  };

  state.activeId=line.id;
  line.alignment=baseAlignment.map(q=>[...q]);
  line.analysis=null;
  drawRouteDragHandle([+station.lon,+station.lat],false);
  try{svg.setPointerCapture(e.pointerId)}catch{}
  consumeRouteGesture(e);
  return true;
}

function beginFreeRouteDrag(line,row,e){
  const base=alignmentForScenario(line);
  if(base.length<2)return false;
  const p=routeClientPoint(e.clientX,e.clientY);
  const m=alignmentMeasure(base);
  const hit=closestPointOnMeasuredRoute(m,p);
  if(!hit)return false;

  const a=base[hit.segment-1],b=base[hit.segment];
  const ll=[
    +a[0]+(+b[0]-+a[0])*hit.t,
    +a[1]+(+b[1]-+a[1])*hit.t
  ];
  const work=base.map(q=>[...q]);
  const index=hit.segment;
  work.splice(index,0,ll);

  routeDrag={
    type:'free',
    lineId:line.id,
    pointerId:e.pointerId,
    index,
    baseAlignment:base.map(q=>[...q]),
    startClient:[e.clientX,e.clientY],
    moved:false,
    snapped:null,
    origin:'line-no-stations'
  };

  state.activeId=line.id;
  line.alignment=work;
  line.analysis=null;
  drawRouteDragHandle(ll,false);
  try{svg.setPointerCapture(e.pointerId)}catch{}
  consumeRouteGesture(e);
  return true;
}

function pointerInsideMap(e){
  return e.target===svg||svg.contains(e.target);
}

parentElement.addEventListener('pointerdown',e=>{
  if(e.button!==0||routeDrag||!pointerInsideMap(e))return;

  // Exact selected-station hit gets first priority.
  const stationHit=bestSelectedStationHit(e.clientX,e.clientY);
  if(stationHit){
    beginStationRouteDrag(stationHit.line,stationHit.stationIndex,e,'selected-station');
    return;
  }

  // Otherwise test the exact geometry currently painted on screen.
  const lineHit=bestScenarioLineHit(e.clientX,e.clientY);
  if(!lineHit)return; // ELSE -> legacy map pan

  const baseAlignment=alignmentForScenario(lineHit.line);
  const stationIndex=stationIndexForLineHit(lineHit.line,lineHit,baseAlignment,e.clientX,e.clientY);
  if(stationIndex!==null){
    beginStationRouteDrag(lineHit.line,stationIndex,e,'line');
    return;
  }

  // Trace-only/imported geometry has no authoritative station sequence. It can
  // still be reshaped directly without pretending to know its stops.
  beginFreeRouteDrag(lineHit.line,lineHit,e);
},{capture:true});

parentElement.addEventListener('pointermove',e=>{
  if(!routeDrag||e.pointerId!==routeDrag.pointerId)return;
  const line=state.lines.find(x=>x.id===routeDrag.lineId);
  if(!line){consumeRouteGesture(e);return;}

  const dx=e.clientX-routeDrag.startClient[0],dy=e.clientY-routeDrag.startClient[1];
  if(!routeDrag.moved&&Math.hypot(dx,dy)<2){consumeRouteGesture(e);return;}
  routeDrag.moved=true;

  const snap=routeMunicipalitySnap(
    e.clientX,e.clientY,20,
    routeDrag.type==='station'?routeDrag.originalStationId:null
  );
  const p=routeClientPoint(e.clientX,e.clientY);
  const coord=snap?.coord||unproject(p[0],p[1]);
  routeDrag.snapped=snap;

  if(routeDrag.type==='station'){
    line.alignment=pivotGeometryForStation(routeDrag,coord);
  }else{
    line.alignment[routeDrag.index]=coord;
  }
  line.analysis=null;

  renderScenario();
  renderLines();
  renderSummary();
  drawRouteDragHandle(coord,!!snap);
  consumeRouteGesture(e);
},{capture:true});

function finishRouteDrag(e){
  if(!routeDrag)return;
  const drag=routeDrag;
  const line=state.lines.find(x=>x.id===drag.lineId);

  if(line){
    if(drag.type==='station'){
      if(drag.moved&&drag.snapped){
        const target=drag.snapped.m;
        const duplicate=line.stations.some((id,i)=>i!==drag.stationIndex&&String(id)===String(target.id));
        if(!duplicate){
          line.stations[drag.stationIndex]=String(target.id);
          line.alignment=pivotGeometryForStation(drag,[+target.lon,+target.lat]);
        }else{
          line.stations=[...drag.baseStations];
          line.alignment=drag.baseAlignment.map(q=>[...q]);
        }
      }else{
        line.stations=[...drag.baseStations];
        line.alignment=drag.baseAlignment.map(q=>[...q]);
      }
    }else if(!drag.moved){
      line.alignment=drag.baseAlignment.map(q=>[...q]);
    }
    line.analysis=null;
  }

  routeDrag=null;
  clearRouteDragHandle();
  save();
  render();
  consumeRouteGesture(e);
}

parentElement.addEventListener('pointerup',e=>{
  if(routeDrag&&e.pointerId===routeDrag.pointerId)finishRouteDrag(e);
},{capture:true});

parentElement.addEventListener('pointercancel',e=>{
  if(routeDrag&&e.pointerId===routeDrag.pointerId)finishRouteDrag(e);
},{capture:true});
