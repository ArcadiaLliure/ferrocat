/* Ferrocat: click-vs-drag arbitration for existing scenario routes.
 *
 * Rule:
 *   - primary click on an already selected station or scenario line => start a NEW line there
 *   - press + move on that same target => drag/reshape the existing line
 *   - press elsewhere => legacy map pan / normal station or trace click behaviour
 *
 * This listener lives on ownerDocument capture, one level above the existing
 * parentElement capture listeners, so it can decide ownership before either
 * route_editing.js or the legacy map-pan handler sees the pointer sequence.
 */
(() => {
  const doc=svg.ownerDocument;
  if(!doc||svg.dataset.gestureArbitrationInstalled==='1')return;
  svg.dataset.gestureArbitrationInstalled='1';

  const DRAG_THRESHOLD_PX=5;
  let pending=null;
  let ownedDragPointer=null;

  function hardConsume(e,moved=false){
    dragging=false;
    dragMoved=!!moved;
    dragStart=null;
    vbStart=null;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function lineClickPoint(row){
    if(!row?.measure?.coords?.length||!row?.hit)return null;
    const i=row.hit.segment;
    if(i<1||i>=row.measure.coords.length)return null;
    const a=row.measure.coords[i-1],b=row.measure.coords[i],t=row.hit.t;
    return [
      +a[0]+(+b[0]-+a[0])*t,
      +a[1]+(+b[1]-+a[1])*t
    ];
  }

  function syncToolUi(){
    const sel=byId('tool-select');
    if(sel)sel.value=state.tool;
    const help=byId('trace-help');
    if(help){
      help.textContent=state.tool==='trace'
        ?'Mode Traça: cada clic afegeix un punt. Finalitza per executar l’anàlisi topogràfica si hi ha DEM.'
        :'Mode estacions: clica municipis per afegir parades.';
    }
  }

  function startNewLineFromClick(g){
    state.activeId=null;

    if(g.stationHit?.m){
      state.tool='stations';
      newLine(String(g.stationHit.m.id),null);
    }else{
      const ll=g.clickPoint;
      if(!ll)return;
      state.tool='trace';
      newLine(null,[+ll[0],+ll[1]]);
    }

    syncToolUi();
    save();
    render();
  }

  function beginFreeDragAtInitialHit(g,e){
    const line=g.lineHit?.line;
    const row=g.lineHit;
    if(!line||!row)return false;

    const base=alignmentForScenario(line);
    if(base.length<2)return false;

    const click=g.clickPoint;
    if(!click)return false;

    const p=project(...click);
    const measure=alignmentMeasure(base);
    const hit=closestPointOnMeasuredRoute(measure,p);
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
      startClient:[...g.startClient],
      moved:false,
      snapped:null,
      origin:'line-click-drag'
    };

    state.activeId=line.id;
    line.alignment=work;
    line.analysis=null;
    drawRouteDragHandle(ll,false);
    try{svg.setPointerCapture(e.pointerId)}catch{}
    hardConsume(e,true);
    return true;
  }

  function startDrag(g,e){
    let ok=false;
    if(g.stationHit){
      ok=beginStationRouteDrag(
        g.stationHit.line,
        g.stationHit.stationIndex,
        e,
        'selected-station'
      );
    }else if(g.stationIndex!==null&&g.stationIndex!==undefined){
      ok=beginStationRouteDrag(
        g.lineHit.line,
        g.stationIndex,
        e,
        'line'
      );
    }else{
      ok=beginFreeDragAtInitialHit(g,e);
    }

    if(ok&&routeDrag){
      routeDrag.startClient=[...g.startClient];
      ownedDragPointer=e.pointerId;
    }
    return ok;
  }

  function updateOwnedDrag(e){
    if(!routeDrag||e.pointerId!==ownedDragPointer)return false;
    const line=state.lines.find(x=>x.id===routeDrag.lineId);
    if(!line){hardConsume(e,true);return true;}

    routeDrag.moved=true;
    const snap=routeMunicipalitySnap(
      e.clientX,
      e.clientY,
      20,
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
    hardConsume(e,true);
    return true;
  }

  function restoreOwnedDrag(){
    if(!routeDrag)return;
    const drag=routeDrag;
    const line=state.lines.find(x=>x.id===drag.lineId);
    if(line){
      if(drag.type==='station'){
        if(Array.isArray(drag.baseStations))line.stations=[...drag.baseStations];
        if(Array.isArray(drag.baseAlignment))line.alignment=drag.baseAlignment.map(q=>[...q]);
      }else if(Array.isArray(drag.baseAlignment)){
        line.alignment=drag.baseAlignment.map(q=>[...q]);
      }
      line.analysis=null;
    }
    routeDrag=null;
    ownedDragPointer=null;
    clearRouteDragHandle();
    save();
    render();
  }

  doc.addEventListener('pointerdown',e=>{
    if(e.button!==0||pending||ownedDragPointer!==null||routeDrag||!pointerInsideMap(e))return;

    const stationHit=bestSelectedStationHit(e.clientX,e.clientY);
    let lineHit=null,stationIndex=null,clickPoint=null;

    if(!stationHit){
      lineHit=bestScenarioLineHit(e.clientX,e.clientY);
      if(!lineHit)return; // not ours: normal map pan / normal click
      clickPoint=lineClickPoint(lineHit);
      const base=alignmentForScenario(lineHit.line);
      stationIndex=stationIndexForLineHit(
        lineHit.line,
        lineHit,
        base,
        e.clientX,
        e.clientY
      );
    }

    pending={
      pointerId:e.pointerId,
      startClient:[e.clientX,e.clientY],
      stationHit,
      lineHit,
      stationIndex,
      clickPoint
    };

    try{svg.setPointerCapture(e.pointerId)}catch{}
    hardConsume(e,false);
  },true);

  doc.addEventListener('pointermove',e=>{
    if(updateOwnedDrag(e))return;
    if(!pending||e.pointerId!==pending.pointerId)return;

    const dx=e.clientX-pending.startClient[0];
    const dy=e.clientY-pending.startClient[1];
    if(Math.hypot(dx,dy)<DRAG_THRESHOLD_PX){
      hardConsume(e,false);
      return;
    }

    const g=pending;
    pending=null;
    if(startDrag(g,e)){
      updateOwnedDrag(e);
    }else{
      hardConsume(e,true);
    }
  },true);

  doc.addEventListener('pointerup',e=>{
    if(routeDrag&&e.pointerId===ownedDragPointer){
      finishRouteDrag(e);
      ownedDragPointer=null;
      hardConsume(e,true);
      return;
    }

    if(!pending||e.pointerId!==pending.pointerId)return;
    const g=pending;
    pending=null;
    try{svg.releasePointerCapture(e.pointerId)}catch{}
    startNewLineFromClick(g);
    hardConsume(e,false);
  },true);

  doc.addEventListener('pointercancel',e=>{
    if(routeDrag&&e.pointerId===ownedDragPointer){
      restoreOwnedDrag();
      hardConsume(e,true);
      return;
    }
    if(pending&&e.pointerId===pending.pointerId){
      pending=null;
      try{svg.releasePointerCapture(e.pointerId)}catch{}
      hardConsume(e,false);
    }
  },true);
})();
