/* Ferrocat feature: fixed-geometry terrain analysis, station-link route dragging and route display toggle. */

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
 * Station-link dragging.
 * --------------------------------------------------------------------------
 * IMPORTANT: route dragging is deliberately independent from the selected
 * drawing tool. If the primary button starts directly on an active scenario
 * route/station, this handler consumes the gesture BEFORE the map-pan handler.
 * Everywhere else the normal map drag remains untouched.
 */
function ensureScenarioAlignment(line){
  if(line?.alignment?.length>1)return line.alignment;
  const coords=(line?.stations||[]).map(id=>muniById[id]).filter(Boolean).map(m=>[+m.lon,+m.lat]);
  if(coords.length>1)line.alignment=coords;
  return line?.alignment||[];
}

function projectOnSegment(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
  const t=l2?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2,0,1):0;
  const x=a[0]+t*dx,y=a[1]+t*dy;
  return {t,x,y,d:Math.hypot(p[0]-x,p[1]-y),segLen:Math.sqrt(l2)};
}

function alignmentMeasure(line){
  const alignment=ensureScenarioAlignment(line),projected=alignment.map(q=>project(...q)),cumulative=[0];
  for(let i=1;i<projected.length;i++)cumulative.push(cumulative.at(-1)+Math.hypot(projected[i][0]-projected[i-1][0],projected[i][1]-projected[i-1][1]));
  return {alignment,projected,cumulative,total:cumulative.at(-1)||0};
}

function closestPointOnAlignment(measure,p){
  let best=null;
  for(let i=1;i<measure.projected.length;i++){
    const q=projectOnSegment(p,measure.projected[i-1],measure.projected[i]);
    if(!best||q.d<best.d)best={...q,segment:i,along:measure.cumulative[i-1]+q.segLen*q.t};
  }
  return best;
}

function orderedStationAnchors(line,measure){
  const rows=[];let minAlong=-Infinity;
  for(let stationIndex=0;stationIndex<(line.stations||[]).length;stationIndex++){
    const m=muniById[line.stations[stationIndex]];if(!m)continue;
    const p=project(m.lon,m.lat);let best=null;
    for(let i=1;i<measure.projected.length;i++){
      const q=projectOnSegment(p,measure.projected[i-1],measure.projected[i]);
      const along=measure.cumulative[i-1]+q.segLen*q.t;
      if(along+1e-6<minAlong)continue;
      if(!best||q.d<best.d)best={...q,segment:i,along};
    }
    if(!best)best=closestPointOnAlignment(measure,p);
    if(!best)continue;
    minAlong=Math.max(minAlong,best.along);
    rows.push({stationIndex,municipality:m,along:best.along,segment:best.segment,t:best.t});
  }
  return rows;
}

function mapUnitsPerPixel(){return state.vb.w/Math.max(1,svg.getBoundingClientRect().width);}

function stationHitFromScreen(line,cx,cy,maxPx=14){
  const p=svgPoint(cx,cy),limit=maxPx*mapUnitsPerPixel();let best=null;
  for(let i=0;i<(line.stations||[]).length;i++){
    const m=muniById[line.stations[i]];if(!m)continue;
    const q=project(m.lon,m.lat),d=Math.hypot(p[0]-q[0],p[1]-q[1]);
    if(d<=limit&&(!best||d<best.d))best={stationIndex:i,municipality:m,d};
  }
  return best;
}

function lineHitFromScreen(line,cx,cy,maxPx=12){
  const measure=alignmentMeasure(line);if(measure.alignment.length<2)return null;
  const hit=closestPointOnAlignment(measure,svgPoint(cx,cy));
  return hit&&hit.d<=maxPx*mapUnitsPerPixel()?{measure,hit}:null;
}

function nextStationForLineHit(line,measure,along){
  const anchors=orderedStationAnchors(line,measure);if(!anchors.length)return null;
  const eps=2*mapUnitsPerPixel();
  for(const a of anchors)if(a.along>along+eps)return a.stationIndex;
  return anchors.at(-1).stationIndex;
}

function alignmentAnchorIndices(line,measure){
  return orderedStationAnchors(line,measure).map(a=>{
    const before=Math.max(0,a.segment-1),after=Math.min(measure.alignment.length-1,a.segment);
    const station=project(a.municipality.lon,a.municipality.lat),pb=measure.projected[before],pa=measure.projected[after];
    return {...a,vertexIndex:Math.hypot(station[0]-pb[0],station[1]-pb[1])<=Math.hypot(station[0]-pa[0],station[1]-pa[1])?before:after};
  });
}

function buildPivotAlignment(drag,coord){
  const base=drag.baseAlignment,prev=drag.prevVertexIndex,next=drag.nextVertexIndex,out=[];
  if(prev!==null)for(let i=0;i<=prev;i++)out.push([+base[i][0],+base[i][1]]);
  out.push([+coord[0],+coord[1]]);
  if(next!==null)for(let i=next;i<base.length;i++)out.push([+base[i][0],+base[i][1]]);
  if(prev===null&&next===null)return [[+coord[0],+coord[1]]];
  return out;
}

function municipalitySnap(cx,cy,maxPx=17,excludeId=null){
  const p=svgPoint(cx,cy),limit=maxPx*mapUnitsPerPixel();let best=null;
  for(const m of MUNICIPIS){
    if(String(m.id)===String(excludeId))continue;
    const d=Math.hypot(p[0]-m.x,p[1]-m.y);
    if(d<=limit&&(!best||d<best.d))best={municipality:m,coord:[+m.lon,+m.lat],d};
  }
  return best;
}

function drawStationDragHandle(coord,snapped=false){
  const layer=byId('capa-linies');if(!layer||!coord)return;
  const old=layer.querySelector('#station-link-drag-handle');if(old)old.remove();
  const [x,y]=project(...coord),r=6*mapUnitsPerPixel();
  const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
  circle.setAttribute('id','station-link-drag-handle');circle.setAttribute('cx',x);circle.setAttribute('cy',y);circle.setAttribute('r',r);
  circle.setAttribute('fill',snapped?'#ffd166':'#ffffff');circle.setAttribute('stroke','#ff6b35');circle.setAttribute('stroke-width',Math.max(.8,r*.32));
  circle.setAttribute('vector-effect','non-scaling-stroke');circle.style.pointerEvents='none';layer.appendChild(circle);
}

function clearStationDragHandle(){const h=byId('capa-linies')?.querySelector('#station-link-drag-handle');if(h)h.remove();}

let stationLinkDrag=null;

function consumeRouteGesture(e){
  // Cancel any legacy map pan that might already have been primed.
  dragging=false;dragStart=null;vbStart=null;
  // Keep the legacy click handler from treating the release as a map click.
  dragMoved=true;
  e.preventDefault();
  e.stopImmediatePropagation();
}

function beginStationLinkDrag(line,stationIndex,e,origin){
  if(stationIndex<0||stationIndex>=line.stations.length)return false;
  const measure=alignmentMeasure(line),anchors=alignmentAnchorIndices(line,measure);
  const pos=anchors.findIndex(a=>a.stationIndex===stationIndex),anchor=pos>=0?anchors[pos]:null;
  if(!anchor)return false;
  const prevAnchor=pos>0?anchors[pos-1]:null,nextAnchor=pos<anchors.length-1?anchors[pos+1]:null;
  const originalId=line.stations[stationIndex],originalM=muniById[originalId];if(!originalM)return false;

  stationLinkDrag={lineId:line.id,stationIndex,originalStationId:String(originalId),baseAlignment:measure.alignment.map(q=>[+q[0],+q[1]]),baseStations:[...line.stations],prevVertexIndex:prevAnchor?prevAnchor.vertexIndex:null,nextVertexIndex:nextAnchor?nextAnchor.vertexIndex:null,origin,snapped:null,moved:false,pointerId:e.pointerId};
  line.analysis=null;
  drawStationDragHandle([+originalM.lon,+originalM.lat],false);
  try{svg.setPointerCapture(e.pointerId)}catch{}
  consumeRouteGesture(e);
  return true;
}

// This MUST NOT depend on state.tool. Route manipulation is a direct map
// gesture, available in both "Estacions" and "Traça" modes.
svg.addEventListener('pointerdown',e=>{
  if(e.button!==0||stationLinkDrag)return;
  const line=activeLine();
  if(!line||line.sourceServiceId||(line.stations||[]).length<2)return;

  const stationHit=stationHitFromScreen(line,e.clientX,e.clientY);
  if(stationHit){beginStationLinkDrag(line,stationHit.stationIndex,e,'station');return;}

  const lineHit=lineHitFromScreen(line,e.clientX,e.clientY);
  if(!lineHit)return;
  const stationIndex=nextStationForLineHit(line,lineHit.measure,lineHit.hit.along);
  if(stationIndex!==null)beginStationLinkDrag(line,stationIndex,e,'line');
},{capture:true});

svg.addEventListener('pointermove',e=>{
  if(!stationLinkDrag)return;
  const line=state.lines.find(x=>x.id===stationLinkDrag.lineId);if(!line)return;
  const snap=municipalitySnap(e.clientX,e.clientY,17,stationLinkDrag.originalStationId);
  const coord=snap?.coord||unproject(...svgPoint(e.clientX,e.clientY));
  line.alignment=buildPivotAlignment(stationLinkDrag,coord);line.analysis=null;
  stationLinkDrag.snapped=snap;stationLinkDrag.moved=true;
  renderScenario();renderLines();renderSummary();drawStationDragHandle(coord,!!snap);
  consumeRouteGesture(e);
},{capture:true});

function finishStationLinkDrag(e=null){
  if(!stationLinkDrag)return;
  const drag=stationLinkDrag,line=state.lines.find(x=>x.id===drag.lineId);
  if(line){
    if(drag.moved&&drag.snapped){
      const target=drag.snapped.municipality;
      const duplicate=line.stations.some((id,i)=>i!==drag.stationIndex&&String(id)===String(target.id));
      if(!duplicate){line.stations[drag.stationIndex]=String(target.id);line.alignment=buildPivotAlignment(drag,[+target.lon,+target.lat]);}
      else{line.stations=[...drag.baseStations];line.alignment=drag.baseAlignment.map(q=>[...q]);}
    }else{
      line.stations=[...drag.baseStations];line.alignment=drag.baseAlignment.map(q=>[...q]);
    }
    line.analysis=null;
  }
  stationLinkDrag=null;clearStationDragHandle();save();render();
  if(e)consumeRouteGesture(e);
}

svg.addEventListener('pointerup',e=>{if(stationLinkDrag)finishStationLinkDrag(e);},{capture:true});
svg.addEventListener('pointercancel',e=>{if(stationLinkDrag)finishStationLinkDrag(e);},{capture:true});
