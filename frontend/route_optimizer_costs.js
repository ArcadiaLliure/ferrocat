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
