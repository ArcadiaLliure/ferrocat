/* Ferrocat: cost-aware topographic optimisation + tunnel/viaduct map overlay.
 *
 * The optimiser treats the user's route/stations as the corridor to respect.
 * It only accepts a lateral alternative when its estimated monetary cost is
 * lower than keeping the tunnel/viaduct/obstacle solution on the original
 * section. Selected stations remain mandatory waypoints.
 */

const OPT_COST_STATE_KEY='ferrocat-route-cost-model-v1';
const OPT_WATER_BIT=1;
const OPT_URBAN_BIT=2;
const OPT_DEFAULTS={
  ruralLandEurM2:4.5,
  urbanLandEurM2:90,
  affectedWidthM:30,
  maxDeviationKm:6,
  roadBridgeSpanKm:.10,
  waterBridgeSpanKm:.18
};
let optCost={...OPT_DEFAULTS};
try{
  const saved=JSON.parse(sessionStorage.getItem(OPT_COST_STATE_KEY)||'{}');
  for(const k of Object.keys(OPT_DEFAULTS)){
    if(Number.isFinite(+saved[k]))optCost[k]=+saved[k];
  }
}catch{}

function optPersistCost(){
  try{sessionStorage.setItem(OPT_COST_STATE_KEY,JSON.stringify(optCost))}catch{}
}

function optInjectCostControls(){
  const panels=[...parentElement.querySelectorAll('.panell')];
  const panel=panels.find(p=>String(p.querySelector('h2')?.textContent||'').includes('Cost i topografia'));
  if(!panel||panel.querySelector('[data-opt-cost-controls]'))return;
  const wrap=document.createElement('div');
  wrap.dataset.optCostControls='1';
  wrap.innerHTML=`
    <div class="fila-slider"><label>Expropiació rural <span class="valor" data-opt-v="ruralLandEurM2"></span></label><input type="range" data-opt-k="ruralLandEurM2" min="0" max="30" step="0.5"></div>
    <div class="fila-slider"><label>Expropiació urbana <span class="valor" data-opt-v="urbanLandEurM2"></span></label><input type="range" data-opt-k="urbanLandEurM2" min="20" max="250" step="5"></div>
    <div class="fila-slider"><label>Amplada afectada <span class="valor" data-opt-v="affectedWidthM"></span></label><input type="range" data-opt-k="affectedWidthM" min="15" max="60" step="5"></div>
    <div class="fila-slider"><label>Desviació màxima <span class="valor" data-opt-v="maxDeviationKm"></span></label><input type="range" data-opt-k="maxDeviationKm" min="1" max="12" step="1"></div>
    <div class="source" style="line-height:1.35">Expropiació: €/m² × amplada afectada. Valors inicials de prefactibilitat: 4,5 €/m² rural i 90 €/m² urbà. L'optimitzador només canvia un tram si l'alternativa és més barata.</div>`;
  panel.appendChild(wrap);

  wrap.querySelectorAll('[data-opt-k]').forEach(i=>{
    const k=i.dataset.optK;
    i.value=optCost[k];
    const out=wrap.querySelector(`[data-opt-v="${k}"]`);
    const paint=()=>{
      if(!out)return;
      if(k.endsWith('EurM2'))out.textContent=`${optCost[k]} €/m²`;
      else if(k==='affectedWidthM')out.textContent=`${optCost[k]} m`;
      else out.textContent=`${optCost[k]} km`;
    };
    i.oninput=()=>{
      optCost[k]=+i.value;
      optPersistCost();
      paint();
      for(const l of state.lines)l.analysis=null;
      save();
      render();
    };
    paint();
  });
}
optInjectCostControls();

function optConstraintData(){
  return typeof ROUTE_CONSTRAINTS==='undefined'?{}:(ROUTE_CONSTRAINTS||{});
}

function optConstraintMask(cell){
  const c=optConstraintData();
  if(!cell||!Array.isArray(c.mask)||!c.mask.length)return 0;
  const w=+c.width,h=+c.height;
  if(w!==+TERRAIN_COARSE.width||h!==+TERRAIN_COARSE.height)return 0;
  const x=cell[0],y=cell[1];
  if(x<0||y<0||x>=w||y>=h)return 0;
  return +c.mask[y*w+x]||0;
}

const optUrbanProxyCache=new Map();
function optUrbanProxy(cell,ll){
  const key=cell?`${cell[0]}:${cell[1]}`:`${ll[0].toFixed(3)}:${ll[1].toFixed(3)}`;
  if(optUrbanProxyCache.has(key))return optUrbanProxyCache.get(key);
  let urban=false;
  for(const m of MUNICIPIS){
    const pop=Math.max(0,+m.pob||0);
    if(pop<1500)continue;
    const radius=clamp(.35+Math.sqrt(pop)/250,0.45,2.7);
    if(havLL(ll,[+m.lon,+m.lat])<=radius){urban=true;break;}
  }
  optUrbanProxyCache.set(key,urban);
  return urban;
}

function optIsUrban(cell,ll){
  const mask=optConstraintMask(cell);
  if(mask&OPT_URBAN_BIT)return true;
  return optUrbanProxy(cell,ll);
}

let optRoadCells=null;
function optBuildRoadCells(){
  if(optRoadCells)return optRoadCells;
  const map=new Map();
  for(const row of (ROADS||[])){
    const coords=row.c||row.coords||[];
    if(coords.length<2)continue;
    const rank=roadDisplayMeta(row).rank||1;
    const severity=rank>=4?2:1;
    for(let i=1;i<coords.length;i++){
      const a=coords[i-1],b=coords[i],km=havLL(a,b);
      const n=Math.max(1,Math.ceil(km/.18));
      for(let j=0;j<=n;j++){
        const t=j/n,ll=[+a[0]+(+b[0]-+a[0])*t,+a[1]+(+b[1]-+a[1])*t];
        const cell=terrainCell(ll);if(!cell)continue;
        const key=`${cell[0]}:${cell[1]}`;
        map.set(key,Math.max(map.get(key)||0,severity));
      }
    }
  }
  optRoadCells=map;
  return map;
}

function optRoadSeverity(cell){
  if(!cell)return 0;
  return optBuildRoadCells().get(`${cell[0]}:${cell[1]}`)||0;
}

function optLandMPerKm(urban){
  const eurM2=urban?optCost.urbanLandEurM2:optCost.ruralLandEurM2;
  return Math.max(0,eurM2)*Math.max(0,optCost.affectedWidthM)/1000;
}

function optDistKm(coords){
  const out=[0];
  for(let i=1;i<coords.length;i++)out.push(out.at(-1)+havLL(coords[i-1],coords[i]));
  return out;
}

function optTopographicStructures(terrain,rail,distKm){
  const kind=terrain.map((z,i)=>z-rail[i]>25?'tunnel':rail[i]-z>18?'viaduct':'surface');
  const structures=[];
  let s=0;
  for(let i=1;i<=kind.length;i++){
    if(i===kind.length||kind[i]!==kind[s]){
      const end=Math.max(s,i-1),len=distKm[end]-distKm[s];
      if(kind[s]!=='surface'&&len>=.18){
        structures.push({kind:kind[s],startKm:distKm[s],endKm:distKm[end],lengthKm:len,reason:'topography'});
      }
      s=i;
    }
  }
  return {kind,structures};
}

function optObstacleClusters(coords,distKm,kind){
  const rows=[];
  let waterStart=null,roadStart=null,roadSeverity=0;
  const close=(type,start,end,severity=0)=>{
    if(start===null)return;
    const mid=(distKm[start]+distKm[end])/2;
    const span=type==='water'?optCost.waterBridgeSpanKm:optCost.roadBridgeSpanKm;
    rows.push({
      kind:'viaduct',reason:type,
      startKm:Math.max(0,mid-span/2),
      endKm:Math.min(distKm.at(-1),mid+span/2),
      lengthKm:Math.min(span,distKm.at(-1)),
      severity
    });
  };

  for(let i=0;i<coords.length;i++){
    const cell=terrainCell(coords[i]);
    const mask=optConstraintMask(cell);
    const water=!!(mask&OPT_WATER_BIT)&&kind[i]!=='tunnel'&&kind[i]!=='viaduct';
    const road=optRoadSeverity(cell);

    if(water&&waterStart===null)waterStart=i;
    if(!water&&waterStart!==null){close('water',waterStart,i-1);waterStart=null;}

    if(road&&kind[i]!=='tunnel'&&kind[i]!=='viaduct'){
      if(roadStart===null)roadStart=i;
      roadSeverity=Math.max(roadSeverity,road);
    }else if(roadStart!==null){
      close('road',roadStart,i-1,roadSeverity);roadStart=null;roadSeverity=0;
    }
  }
  if(waterStart!==null)close('water',waterStart,coords.length-1);
  if(roadStart!==null)close('road',roadStart,coords.length-1,roadSeverity);
  return rows;
}

function optMergeStructures(rows,totalKm){
  const sorted=[...rows].filter(x=>x.lengthKm>0).sort((a,b)=>a.startKm-b.startKm||a.endKm-b.endKm);
  const out=[];
  for(const s of sorted){
    const x={...s,startKm:clamp(s.startKm,0,totalKm),endKm:clamp(s.endKm,0,totalKm)};
    x.lengthKm=Math.max(0,x.endKm-x.startKm);
    const prev=out.at(-1);
    if(prev&&prev.kind===x.kind&&x.startKm<=prev.endKm+.05){
      prev.endKm=Math.max(prev.endKm,x.endKm);
      prev.lengthKm=prev.endKm-prev.startKm;
      if(prev.reason!==x.reason)prev.reason='mixed';
    }else out.push(x);
  }
  return out;
}

function optEvaluateRoute(rawCoords){
  const coords=fixedRouteSamples(rawCoords,.30);
  if(coords.length<2)return null;
  const rawTerrain=coords.map(q=>{
    const c=terrainCell(q);if(!c)return null;
    const z=elev(c);return Number.isFinite(z)?+z:null;
  });
  const terrain=fillTerrainGaps(rawTerrain);if(!terrain)return null;
  const distKm=optDistKm(coords);
  const rail=fixedRailProfile(terrain,distKm);
  const topo=optTopographicStructures(terrain,rail,distKm);
  const obstacle=optObstacleClusters(coords,distKm,topo.kind);
  const structures=optMergeStructures([...topo.structures,...obstacle],distKm.at(-1));

  const structureAt=km=>structures.find(s=>km>=s.startKm&&km<=s.endKm)||null;
  let constructionM=0,expropriationM=0,existingKm=0,surfaceKm=0,tunnelKm=0,viaductKm=0,urbanKm=0;
  for(let i=1;i<coords.length;i++){
    const km=distKm[i]-distKm[i-1];if(km<=0)continue;
    const midKm=(distKm[i]+distKm[i-1])/2;
    const s=structureAt(midKm);
    if(s?.kind==='tunnel'){
      tunnelKm+=km;constructionM+=km*params.tunnelCost;continue;
    }
    if(s?.kind==='viaduct'){
      viaductKm+=km;constructionM+=km*params.viaductCost;continue;
    }

    const mid=[(coords[i][0]+coords[i-1][0])/2,(coords[i][1]+coords[i-1][1])/2];
    const cell=terrainCell(mid),urban=optIsUrban(cell,mid);
    const existing=RAIL_EDGES.length&&nearestRailDistanceBase(project(...mid))<3;
    surfaceKm+=km;
    if(existing){existingKm+=km;constructionM+=km*EXISTING_COST;}
    else{
      constructionM+=km*params.costPerKm;
      expropriationM+=km*optLandMPerKm(urban);
      if(urban)urbanKm+=km;
    }
  }

  // Ensure short obstacle bridges have a minimum structure cost even when the
  // profile sampling interval is larger than their nominal crossing span.
  const obstacleStructures=structures.filter(s=>s.reason==='road'||s.reason==='water');
  let obstacleFloorM=0;
  for(const s of obstacleStructures){
    obstacleFloorM+=params.viaductCost*s.lengthKm;
  }
  const sampledObstacleM=viaductKm*params.viaductCost;
  if(obstacleFloorM>sampledObstacleM)constructionM+=obstacleFloorM-sampledObstacleM;

  let maxGradient=0;
  for(let i=1;i<rail.length;i++){
    const ds=Math.max(.001,(distKm[i]-distKm[i-1])*1000);
    maxGradient=Math.max(maxGradient,Math.abs(rail[i]-rail[i-1])/ds*1000);
  }

  return {
    coords,terrain,rail,distKm,structures,maxGradient,
    constructionM,expropriationM,totalM:constructionM+expropriationM,
    existingKm,surfaceKm,tunnelKm,viaductKm,urbanKm,
    roadCrossings:obstacleStructures.filter(s=>s.reason==='road').length,
    waterCrossings:obstacleStructures.filter(s=>s.reason==='water').length
  };
}

function optBaseSections(line,base){
  if((line.stations||[]).length>=2){
    const anchors=stationAnchorsOnAlignment(line,base);
    if(anchors.length>=2){
      const out=[];
      for(let i=1;i<anchors.length;i++){
        const a=anchors[i-1],b=anchors[i];
        const from=Math.min(a.vertexIndex,b.vertexIndex),to=Math.max(a.vertexIndex,b.vertexIndex);
        const sec=base.slice(from,to+1).map(q=>[...q]);
        const sa=muniById[line.stations[a.stationIndex]],sb=muniById[line.stations[b.stationIndex]];
        if(sa)sec[0]=[+sa.lon,+sa.lat];
        if(sb)sec[sec.length-1]=[+sb.lon,+sb.lat];
        if(sec.length<2&&sa&&sb)sec.push([+sb.lon,+sb.lat]);
        if(sec.length>=2)out.push(sec);
      }
      if(out.length)return out;
    }
    return line.stations.map(id=>muniById[id]).filter(Boolean).map(m=>[+m.lon,+m.lat]).slice(1).map((b,i)=>[[+muniById[line.stations[i]].lon,+muniById[line.stations[i]].lat],b]);
  }

  if(base.length<=24)return base.slice(1).map((b,i)=>[[...base[i]],[...b]]);
  const stride=Math.ceil((base.length-1)/20),out=[];
  for(let i=0;i<base.length-1;i+=stride){out.push([[...base[i]],[...base[Math.min(base.length-1,i+stride)]]]);}
  return out;
}

function optSurfaceCandidate(section){
  const trace=fixedRouteSamples(section,.45).map(terrainCell).filter(Boolean);
  if(trace.length<2)return null;
  const start=trace[0],goal=trace.at(-1),res=+TERRAIN_COARSE.resolution_m,w=+TERRAIN_COARSE.width,h=+TERRAIN_COARSE.height;
  const corridor=Math.max(2,Math.ceil(optCost.maxDeviationKm*1000/res));
  const heap=new Heap(),key=(x,y)=>y*w+x,best=new Map([[key(...start),0]]),parent=new Map();
  const minSurface=Math.max(.01,params.costPerKm+optLandMPerKm(false));
  heap.push([0,0,start]);
  let found=null,iterations=0;

  while(heap.length&&iterations++<120000){
    const cur=heap.pop(),g=cur[1],[x,y]=cur[2],k=key(x,y);
    if(g!==best.get(k))continue;
    if(x===goal[0]&&y===goal[1]){found=[x,y];break;}
    const z=elev([x,y]);if(z===null)continue;

    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
      if(distToTrace([nx,ny],trace)>corridor)continue;
      const nz=elev([nx,ny]);if(nz===null)continue;
      const stepM=Math.hypot(dx,dy)*res,stepKm=stepM/1000;
      const ll=utm31ToLL(TERRAIN_COARSE.bbox[0]+(nx+.5)*res,TERRAIN_COARSE.bbox[3]-(ny+.5)*res);
      const cell=[nx,ny],mask=optConstraintMask(cell),urban=!!(mask&OPT_URBAN_BIT)||optIsUrban(cell,ll);
      let edge=stepKm*(params.costPerKm+optLandMPerKm(urban));

      const grade=Math.abs(nz-z)/Math.max(1,stepM)*1000;
      if(grade>20)edge+=stepKm*(grade-20)*.08;
      if(grade>params.maxGradient)edge+=stepKm*params.tunnelCost*.55*(grade/Math.max(1,params.maxGradient));

      if(mask&OPT_WATER_BIT)edge+=params.viaductCost*optCost.waterBridgeSpanKm;
      const road=optRoadSeverity(cell);
      if(road)edge+=params.viaductCost*optCost.roadBridgeSpanKm*(road>=2?1.35:.7);

      const nk=key(nx,ny),ng=g+edge;
      if(ng<(best.get(nk)??Infinity)){
        best.set(nk,ng);parent.set(nk,k);
        const heuristic=Math.hypot(goal[0]-nx,goal[1]-ny)*res/1000*minSurface;
        heap.push([ng+heuristic,ng,[nx,ny]]);
      }
    }
  }
  if(!found)return null;

  const cells=[];let k=key(...found),startKey=key(...start);
  while(true){
    cells.push([k%w,Math.floor(k/w)]);
    if(k===startKey)break;
    k=parent.get(k);if(k===undefined)return null;
  }
  cells.reverse();

  // Remove grid stair-stepping while keeping enough points for later terrain sampling.
  const keep=[];
  for(let i=0;i<cells.length;i++){
    if(i===0||i===cells.length-1){keep.push(cells[i]);continue;}
    const a=cells[i-1],b=cells[i],c=cells[i+1];
    const d1=[Math.sign(b[0]-a[0]),Math.sign(b[1]-a[1])],d2=[Math.sign(c[0]-b[0]),Math.sign(c[1]-b[1])];
    if(d1[0]!==d2[0]||d1[1]!==d2[1])keep.push(b);
  }
  const b=TERRAIN_COARSE.bbox;
  const coords=keep.map(([x,y])=>utm31ToLL(b[0]+(x+.5)*res,b[3]-(y+.5)*res));
  coords[0]=[...section[0]];coords[coords.length-1]=[...section.at(-1)];
  return coords;
}

function optNeedsSearch(e){
  return !!(e&&(e.tunnelKm>.01||e.viaductKm>.01||e.roadCrossings||e.waterCrossings||e.urbanKm>.35));
}

function optJoinSections(parts){
  const out=[];
  for(const p of parts){
    if(!p?.length)continue;
    if(!out.length)out.push(...p.map(q=>[...q]));
    else out.push(...p.slice(1).map(q=>[...q]));
  }
  return out;
}

analyzeTerrain=function(line){
  if(!terrainReady())return {warning:'No hi ha DEM runtime. Executa python -m pipelines.PREPARAR_FERROCAT --only terrain'};
  const base=alignmentForScenario(line);
  if(base.length<2)return {warning:'Calen almenys dos punts de traçat per analitzar la topografia.'};

  // Imported real services are assessed but never re-routed automatically.
  if(line.sourceServiceId){
    const e=optEvaluateRoute(base);
    if(!e)return {warning:'El traçat queda fora de la cobertura del DEM disponible.'};
    return {
      surfaceFeasible:e.tunnelKm<=.01,usedTunnel:e.tunnelKm>.01,
      optimizedCoords:e.coords,terrain:e.terrain,rail:e.rail,distKm:e.distKm,
      structures:e.structures,maxGradient:e.maxGradient,
      costBreakdown:{...e,baselineM:e.totalM,savingsM:0,optimized:false},
      warning:e.structures.length?'S’avalua el servei existent, però no se’n modifica automàticament el traçat.':null
    };
  }

  const sections=optBaseSections(line,base),chosen=[];
  let baselineTotal=0,chosenTotal=0,changed=0;
  for(const section of sections){
    const baseline=optEvaluateRoute(section);
    if(!baseline){chosen.push(section);continue;}
    baselineTotal+=baseline.totalM;
    let bestCoords=section,bestEval=baseline;

    if(optNeedsSearch(baseline)){
      const candidate=optSurfaceCandidate(section);
      const ce=candidate?optEvaluateRoute(candidate):null;
      if(ce&&ce.totalM+.01<bestEval.totalM){
        bestCoords=candidate;bestEval=ce;changed++;
      }
    }
    chosen.push(bestCoords);
    chosenTotal+=bestEval.totalM;
  }

  const core=optJoinSections(chosen);
  const finalEval=optEvaluateRoute(core);
  if(!finalEval)return {warning:'No s’ha pogut avaluar el traçat dins de la cobertura topogràfica.'};

  if(changed){
    // The optimisation becomes the editable route, not a purely visual ghost.
    line.alignment=core.map(q=>[...q]);
  }
  const savings=Math.max(0,baselineTotal-finalEval.totalM);
  const constraints=optConstraintData();
  const hasHydro=Array.isArray(constraints.mask)&&constraints.mask.length>0;
  let warning=null;
  if(changed){
    warning=`Traçat optimitzat: estalvi estimat ${savings.toFixed(1)} M€ respecte del traçat analitzat.`;
  }
  if(finalEval.structures.length){
    const kept=`Es mantenen ${finalEval.structures.length} obra/es singular/s perquè una desviació superficial dins de ±${optCost.maxDeviationKm} km no resultava més barata.`;
    warning=warning?`${warning} ${kept}`:kept;
  }
  if(!hasHydro){
    const note='Sense constraints.runtime d’hidrografia/urbà: s’usen carreteres principals i una aproximació urbana.';
    warning=warning?`${warning} ${note}`:note;
  }

  return {
    surfaceFeasible:finalEval.tunnelKm<=.01,
    usedTunnel:finalEval.tunnelKm>.01,
    optimizedCoords:finalEval.coords,
    terrain:finalEval.terrain,
    rail:finalEval.rail,
    distKm:finalEval.distKm,
    structures:finalEval.structures,
    maxGradient:finalEval.maxGradient,
    costBreakdown:{
      constructionM:finalEval.constructionM,
      expropriationM:finalEval.expropriationM,
      totalM:finalEval.totalM,
      existingKm:finalEval.existingKm,
      surfaceKm:finalEval.surfaceKm,
      tunnelKm:finalEval.tunnelKm,
      viaductKm:finalEval.viaductKm,
      urbanKm:finalEval.urbanKm,
      roadCrossings:finalEval.roadCrossings,
      waterCrossings:finalEval.waterCrossings,
      baselineM:baselineTotal||finalEval.totalM,
      savingsM:savings,
      optimized:changed>0
    },
    warning
  };
};

/* Make the cost summary use the same cost model as the optimiser. */
const metricsBeforeCostOptimizer=metrics;
metrics=function(line){
  const m=metricsBeforeCostOptimizer(line),c=line.analysis?.costBreakdown;
  if(!c)return m;
  m.trackCost=c.totalM;
  m.cost=c.totalM+m.stationCost;
  m.expropriationCost=c.expropriationM;
  m.existing=c.existingKm;
  m.surface=c.surfaceKm;
  m.tunnelKm=c.tunnelKm;
  m.viaductKm=c.viaductKm;
  return m;
};

function optPointAtKm(a,km){
  const d=a.distKm,c=a.optimizedCoords;if(!d?.length||!c?.length)return null;
  const target=clamp(km,0,d.at(-1));let hi=1;
  while(hi<d.length&&d[hi]<target)hi++;
  hi=Math.min(hi,d.length-1);const lo=Math.max(0,hi-1),span=Math.max(1e-9,d[hi]-d[lo]),t=(target-d[lo])/span;
  return [+c[lo][0]+(+c[hi][0]-+c[lo][0])*t,+c[lo][1]+(+c[hi][1]-+c[lo][1])*t];
}

function optStructurePath(a,s){
  const pts=[optPointAtKm(a,s.startKm)];
  for(let i=0;i<a.distKm.length;i++)if(a.distKm[i]>s.startKm&&a.distKm[i]<s.endKm)pts.push(a.optimizedCoords[i]);
  pts.push(optPointAtKm(a,s.endKm));
  return pts.filter(Boolean);
}

function optEngineeringOverlay(){
  const layer=byId('capa-linies');if(!layer)return;
  const old=layer.querySelector('[data-engineering-overlay]');if(old)old.remove();
  const g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.dataset.engineeringOverlay='1';g.style.pointerEvents='none';
  let html='';
  for(const line of state.lines){
    const a=line.analysis;if(!a?.structures?.length||!a.optimizedCoords?.length)continue;
    for(const s of a.structures){
      const ll=optStructurePath(a,s),p=ll.map(q=>project(...q));if(p.length<2)continue;
      const d='M '+p.map(q=>`${q[0].toFixed(2)} ${q[1].toFixed(2)}`).join(' L ');
      const first=p[0],last=p.at(-1),mid=p[Math.floor(p.length/2)],inv=1/Math.max(.01,zoomFactor());
      if(s.kind==='tunnel'){
        html+=`<path d="${d}" fill="none" stroke="#05080d" stroke-width="8" opacity=".92" vector-effect="non-scaling-stroke"/>`;
        html+=`<path d="${d}" fill="none" stroke="${line.color}" stroke-width="2.5" stroke-dasharray="4 5" opacity=".9" vector-effect="non-scaling-stroke"/>`;
        for(const q of [first,last])html+=`<g transform="translate(${q[0]} ${q[1]}) scale(${inv})"><circle r="5" fill="#05080d" stroke="#ffd166" stroke-width="1.6"/></g>`;
        if(s.lengthKm>=.5)html+=`<g transform="translate(${mid[0]} ${mid[1]}) scale(${inv})"><text text-anchor="middle" y="-8" fill="#ffd166" stroke="#081c33" stroke-width="3" paint-order="stroke" style="font:700 9px 'IBM Plex Mono',monospace">TÚNEL</text></g>`;
      }else{
        html+=`<path d="${d}" fill="none" stroke="#e9f2f4" stroke-width="7" opacity=".92" vector-effect="non-scaling-stroke"/>`;
        html+=`<path d="${d}" fill="none" stroke="#637783" stroke-width="4.4" stroke-dasharray="1 5" opacity=".95" vector-effect="non-scaling-stroke"/>`;
        html+=`<path d="${d}" fill="none" stroke="${line.color}" stroke-width="2.1" vector-effect="non-scaling-stroke"/>`;
        for(const q of [first,last])html+=`<g transform="translate(${q[0]} ${q[1]}) scale(${inv})"><rect x="-4" y="-4" width="8" height="8" fill="#e9f2f4" stroke="#637783" stroke-width="1.4"/></g>`;
        if(s.lengthKm>=.35)html+=`<g transform="translate(${mid[0]} ${mid[1]}) scale(${inv})"><text text-anchor="middle" y="-8" fill="#dfeaf3" stroke="#081c33" stroke-width="3" paint-order="stroke" style="font:700 9px 'IBM Plex Mono',monospace">VIADUCTE</text></g>`;
      }
    }
  }
  g.innerHTML=html;layer.appendChild(g);
}

const renderScenarioBeforeEngineering=renderScenario;
renderScenario=function(){
  renderScenarioBeforeEngineering();
  optEngineeringOverlay();
};

const renderLinesBeforeCostDecoration=renderLines;
renderLines=function(){
  renderLinesBeforeCostDecoration();
  for(const line of state.lines){
    const c=line.analysis?.costBreakdown;if(!c)continue;
    const input=parentElement.querySelector(`[data-name="${line.id}"]`),card=input?.closest('.line-card'),grid=card?.querySelector('.metrics');
    if(grid){
      grid.insertAdjacentHTML('beforeend',
        `<div>Expropiació <b>${fmt1(c.expropriationM)} M€</b></div>`+
        `<div>Estalvi traçat <b>${fmt1(c.savingsM)} M€</b></div>`+
        `<div>Creuaments carretera <b>${c.roadCrossings}</b></div>`+
        `<div>Creuaments aigua <b>${c.waterCrossings}</b></div>`
      );
    }
  }
};
