/* Ferrocat feature: edit an alignment from any point and optionally render straight stop-to-stop routes. */

const REAL_ROUTE_STATE_KEY='ferrocat-real-rail-route-v1';
let realRailRoute=true;
try{realRailRoute=sessionStorage.getItem(REAL_ROUTE_STATE_KEY)!=='false'}catch{}

function routeStationCandidates(line){
  if(!line)return [];
  if(!line.sourceServiceId){
    return (line.stations||[]).map(id=>muniById[id]).filter(Boolean).map(m=>[+m.lon,+m.lat]);
  }
  const svc=SERVICE_BY_ID.get(String(line.sourceServiceId));
  const alignment=line.alignment?.length>1?line.alignment:(svc?.ll?.[3]||svc?.ll?.[2]||svc?.ll?.[1]||svc?.ll?.[0]||[]);
  if(alignment.length<2)return [];
  const agency=String(line.sourceAgency||svc?.agency||'').toLowerCase();
  const dataset=String(svc?.dataset||'').toLowerCase();
  const projected=alignment.map(q=>project(q[0],q[1]));
  const cumulative=[0];
  for(let i=1;i<projected.length;i++)cumulative.push(cumulative.at(-1)+Math.hypot(projected[i][0]-projected[i-1][0],projected[i][1]-projected[i-1][1]));
  const rows=[];
  for(const s of REAL_STATIONS){
    if(agency && !(s.operators||[]).map(x=>String(x).toLowerCase()).includes(agency))continue;
    if(dataset && (s.datasets||[]).length && !(s.datasets||[]).map(x=>String(x).toLowerCase()).includes(dataset))continue;
    const p=project(s.lon,s.lat);
    let best=Infinity,along=0;
    for(let i=1;i<projected.length;i++){
      const a=projected[i-1],b=projected[i],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
      const t=l2?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2,0,1):0;
      const x=a[0]+t*dx,y=a[1]+t*dy,d=Math.hypot(p[0]-x,p[1]-y);
      if(d<best){best=d;along=cumulative[i-1]+Math.sqrt(l2)*t;}
    }
    // Roughly 1.2 km at Catalonia scale. This excludes nearby stations on parallel corridors.
    const kmPerMapUnit=Math.max(.001,geometryLength(alignment)/Math.max(.001,cumulative.at(-1)));
    if(best*kmPerMapUnit<=1.2)rows.push({along,coord:[s.lon,s.lat]});
  }
  rows.sort((a,b)=>a.along-b.along);
  const out=[];
  for(const row of rows){if(!out.length||havLL(out.at(-1),row.coord)>.08)out.push(row.coord);}
  return out.length>1?out:[alignment[0],alignment.at(-1)];
}

function displayedLineCoords(line){
  if(realRailRoute)return lineCoords(line);
  return routeStationCandidates(line);
}

// Rendering only: metrics, terrain analysis and infrastructure costs continue using lineCoords().
scenarioSegmentGroups=function(){
  const map=new Map();
  state.lines.forEach(l=>{
    const c=displayedLineCoords(l);
    for(let i=1;i<c.length;i++){
      const a=c[i-1],b=c[i],ka=`${a[0].toFixed(5)},${a[1].toFixed(5)}`,kb=`${b[0].toFixed(5)},${b[1].toFixed(5)}`,key=ka<kb?ka+'|'+kb:kb+'|'+ka;
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

function nearestAlignmentVertexFromScreen(line,cx,cy,maxPx=12){
  if(!line?.alignment?.length)return -1;
  const [mx,my]=svgPoint(cx,cy),p=[mx,my];
  let bestSeg=-1,bestDist=Infinity;
  for(let i=1;i<line.alignment.length;i++){
    const a=project(...line.alignment[i-1]),b=project(...line.alignment[i]);
    const d=pointSeg(p,a,b);
    if(d<bestDist){bestDist=d;bestSeg=i;}
  }
  const mapUnitsPerPx=state.vb.w/Math.max(1,svg.getBoundingClientRect().width);
  if(bestSeg<1||bestDist>maxPx*mapUnitsPerPx)return -1;
  const a=project(...line.alignment[bestSeg-1]),b=project(...line.alignment[bestSeg]);
  return Math.hypot(p[0]-a[0],p[1]-a[1])<=Math.hypot(p[0]-b[0],p[1]-b[1])?bestSeg-1:bestSeg;
}

// Capture phase: clicking/dragging anywhere on the active trace grabs its nearest real vertex.
svg.addEventListener('pointerdown',e=>{
  if(state.tool!=='trace'||alignmentDrag||e.target?.dataset?.alignIndex!==undefined)return;
  const line=activeLine();
  if(!line?.alignment?.length)return;
  const idx=nearestAlignmentVertexFromScreen(line,e.clientX,e.clientY);
  if(idx<0)return;
  alignmentDrag={lineId:line.id,index:idx};
  dragMoved=false;
  try{svg.setPointerCapture(e.pointerId)}catch{}
  e.preventDefault();
  e.stopImmediatePropagation();
},{capture:true});
