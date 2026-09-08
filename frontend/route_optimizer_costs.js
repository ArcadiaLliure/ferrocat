/* Ferrocat: exact monetary integration for the route optimiser.
 *
 * Structure intervals are integrated by PK overlap instead of classifying an
 * entire ~300 m sample from its midpoint. This prevents a 100 m road crossing
 * from being charged as 300 m of viaduct (or missed completely), and keeps the
 * displayed tunnel/viaduct kilometres consistent with the cost calculation.
 */

const OPT_ROAD_BIT=4;
const OPT_MAJOR_ROAD_BIT=8;

optRoadSeverity=function(cell){
  if(!cell)return 0;
  const mask=optConstraintMask(cell);
  if(mask&OPT_MAJOR_ROAD_BIT)return 2;
  if(mask&OPT_ROAD_BIT)return 1;
  return optBuildRoadCells().get(`${cell[0]}:${cell[1]}`)||0;
};

/* Search with the same money model later used to accept/reject a candidate.
 * Reusing an existing railway therefore competes at EXISTING_COST and does not
 * pay new expropriation or a second bridge for a road/river that the existing
 * infrastructure already crosses.
 */
optSurfaceCandidate=function(section){
  const trace=fixedRouteSamples(section,.45).map(terrainCell).filter(Boolean);
  if(trace.length<2)return null;

  const start=trace[0],goal=trace.at(-1);
  const res=+TERRAIN_COARSE.resolution_m;
  const w=+TERRAIN_COARSE.width,h=+TERRAIN_COARSE.height;
  const corridor=Math.max(2,Math.ceil(optCost.maxDeviationKm*1000/res));
  const heap=new Heap();
  const key=(x,y)=>y*w+x;
  const best=new Map([[key(...start),0]]);
  const parent=new Map();
  const minSurface=Math.max(.01,Math.min(EXISTING_COST,params.costPerKm+optLandMPerKm(false)));
  heap.push([0,0,start]);
  let found=null,iterations=0;

  while(heap.length&&iterations++<120000){
    const cur=heap.pop();
    const g=cur[1],[x,y]=cur[2],k=key(x,y);
    if(g!==best.get(k))continue;
    if(x===goal[0]&&y===goal[1]){found=[x,y];break;}
    const z=elev([x,y]);if(z===null)continue;

    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const nx=x+dx,ny=y+dy;
      if(nx<0||ny<0||nx>=w||ny>=h)continue;
      if(distToTrace([nx,ny],trace)>corridor)continue;
      const nz=elev([nx,ny]);if(nz===null)continue;

      const stepM=Math.hypot(dx,dy)*res;
      const stepKm=stepM/1000;
      const ll=utm31ToLL(
        TERRAIN_COARSE.bbox[0]+(nx+.5)*res,
        TERRAIN_COARSE.bbox[3]-(ny+.5)*res
      );
      const cell=[nx,ny];
      const mask=optConstraintMask(cell);
      const existing=RAIL_EDGES.length&&nearestRailDistanceBase(project(...ll))<3;
      const urban=optIsUrban(cell,ll);

      let edge=existing
        ?stepKm*EXISTING_COST
        :stepKm*(params.costPerKm+optLandMPerKm(urban));

      const grade=Math.abs(nz-z)/Math.max(1,stepM)*1000;
      if(grade>20)edge+=stepKm*(grade-20)*.08;
      if(grade>params.maxGradient){
        edge+=stepKm*params.tunnelCost*.55*(grade/Math.max(1,params.maxGradient));
      }

      // A reused railway already contains its own crossing works. For new
      // infrastructure, water and roads are deliberately expensive so A* will
      // go around them unless the detour costs more than the required work.
      if(!existing){
        if(mask&OPT_WATER_BIT){
          edge+=params.viaductCost*optCost.waterBridgeSpanKm;
        }
        const road=optRoadSeverity(cell);
        if(road){
          edge+=params.viaductCost*optCost.roadBridgeSpanKm*(road>=2?1.35:.7);
        }
      }

      const nk=key(nx,ny),ng=g+edge;
      if(ng<(best.get(nk)??Infinity)){
        best.set(nk,ng);
        parent.set(nk,k);
        const heuristic=Math.hypot(goal[0]-nx,goal[1]-ny)*res/1000*minSurface;
        heap.push([ng+heuristic,ng,[nx,ny]]);
      }
    }
  }
  if(!found)return null;

  const cells=[];
  let k=key(...found),startKey=key(...start);
  while(true){
    cells.push([k%w,Math.floor(k/w)]);
    if(k===startKey)break;
    k=parent.get(k);if(k===undefined)return null;
  }
  cells.reverse();

  const keep=[];
  for(let i=0;i<cells.length;i++){
    if(i===0||i===cells.length-1){keep.push(cells[i]);continue;}
    const a=cells[i-1],b=cells[i],c=cells[i+1];
    const d1=[Math.sign(b[0]-a[0]),Math.sign(b[1]-a[1])];
    const d2=[Math.sign(c[0]-b[0]),Math.sign(c[1]-b[1])];
    if(d1[0]!==d2[0]||d1[1]!==d2[1])keep.push(b);
  }

  const bbox=TERRAIN_COARSE.bbox;
  const coords=keep.map(([x,y])=>utm31ToLL(
    bbox[0]+(x+.5)*res,
    bbox[3]-(y+.5)*res
  ));
  coords[0]=[...section[0]];
  coords[coords.length-1]=[...section.at(-1)];
  return coords;
};

function optIntervalOverlap(a0,a1,b0,b1){
  return Math.max(0,Math.min(a1,b1)-Math.max(a0,b0));
}

function optStructureLengths(structures,startKm,endKm){
  let tunnel=0,viaduct=0;
  for(const s of structures){
    const overlap=optIntervalOverlap(startKm,endKm,+s.startKm,+s.endKm);
    if(overlap<=0)continue;
    if(s.kind==='tunnel')tunnel+=overlap;
    else if(s.kind==='viaduct')viaduct+=overlap;
  }
  // The structure generator is intended to produce non-overlapping works, but
  // cap defensively so malformed/overlapping records can never create negative
  // surface length or charge more than the physical segment length.
  const segment=Math.max(0,endKm-startKm);
  tunnel=clamp(tunnel,0,segment);
  viaduct=clamp(viaduct,0,Math.max(0,segment-tunnel));
  return {tunnel,viaduct,surface:Math.max(0,segment-tunnel-viaduct)};
}

optEvaluateRoute=function(rawCoords){
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

  let constructionM=0;
  let expropriationM=0;
  let existingKm=0;
  let surfaceKm=0;
  let tunnelKm=0;
  let viaductKm=0;
  let urbanKm=0;

  for(let i=1;i<coords.length;i++){
    const d0=distKm[i-1],d1=distKm[i];
    const km=d1-d0;if(km<=0)continue;
    const lengths=optStructureLengths(structures,d0,d1);

    tunnelKm+=lengths.tunnel;
    viaductKm+=lengths.viaduct;
    surfaceKm+=lengths.surface;
    constructionM+=lengths.tunnel*params.tunnelCost;
    constructionM+=lengths.viaduct*params.viaductCost;

    if(lengths.surface<=0)continue;

    const mid=[
      (+coords[i][0]+ +coords[i-1][0])/2,
      (+coords[i][1]+ +coords[i-1][1])/2
    ];
    const cell=terrainCell(mid);
    const urban=optIsUrban(cell,mid);
    const existing=RAIL_EDGES.length&&nearestRailDistanceBase(project(...mid))<3;

    if(existing){
      existingKm+=lengths.surface;
      constructionM+=lengths.surface*EXISTING_COST;
    }else{
      constructionM+=lengths.surface*params.costPerKm;
      expropriationM+=lengths.surface*optLandMPerKm(urban);
      if(urban)urbanKm+=lengths.surface;
    }
  }

  let maxGradient=0;
  for(let i=1;i<rail.length;i++){
    const ds=Math.max(.001,(distKm[i]-distKm[i-1])*1000);
    maxGradient=Math.max(
      maxGradient,
      Math.abs(rail[i]-rail[i-1])/ds*1000
    );
  }

  return {
    coords,
    terrain,
    rail,
    distKm,
    structures,
    maxGradient,
    constructionM,
    expropriationM,
    totalM:constructionM+expropriationM,
    existingKm,
    surfaceKm,
    tunnelKm,
    viaductKm,
    urbanKm,
    roadCrossings:obstacle.filter(s=>s.reason==='road').length,
    waterCrossings:obstacle.filter(s=>s.reason==='water').length
  };
};
