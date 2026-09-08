/* Ferrocat feature: linked topographic profile ↔ map hover. */

function analysedProfile(line){
  const a=line?.analysis;
  if(!a||!Array.isArray(a.distKm)||a.distKm.length<2)return null;
  if(!Array.isArray(a.rail)||a.rail.length!==a.distKm.length)return null;
  if(!Array.isArray(a.terrain)||a.terrain.length!==a.distKm.length)return null;
  const coords=Array.isArray(a.optimizedCoords)&&a.optimizedCoords.length===a.distKm.length
    ?a.optimizedCoords
    :fixedRouteSamples(alignmentForScenario(line));
  if(!Array.isArray(coords)||coords.length!==a.distKm.length)return null;
  return {a,coords};
}

function niceAxisStep(span,target=4){
  const raw=Math.max(1e-9,span/Math.max(1,target));
  const pow=10**Math.floor(Math.log10(raw));
  const n=raw/pow;
  const m=n<=1?1:n<=2?2:n<=5?5:10;
  return m*pow;
}

function profileChartGeometry(a){
  const w=360,h=164,l=48,r=12,t=20,b=32;
  const total=Math.max(.001,+a.distKm.at(-1)||0);
  const vals=[...(a.terrain||[]),...(a.rail||[])].filter(Number.isFinite);
  let yMin=vals.length?Math.min(...vals):0;
  let yMax=vals.length?Math.max(...vals):1;
  if(yMax<=yMin)yMax=yMin+1;
  const pad=Math.max(10,(yMax-yMin)*.08);
  yMin-=pad;yMax+=pad;
  const x=km=>l+clamp(km/total,0,1)*(w-l-r);
  const y=m=>h-b-(m-yMin)/Math.max(1,yMax-yMin)*(h-t-b);
  return {w,h,l,r,t,b,total,yMin,yMax,x,y};
}

function profilePointAtKm(line,km){
  const p=analysedProfile(line);if(!p)return null;
  const {a,coords}=p,d=a.distKm;
  const target=clamp(+km||0,0,+d.at(-1)||0);
  let hi=1;
  while(hi<d.length&&d[hi]<target)hi++;
  hi=Math.min(hi,d.length-1);
  const lo=Math.max(0,hi-1),span=Math.max(1e-9,d[hi]-d[lo]);
  const u=clamp((target-d[lo])/span,0,1);
  const lerp=(x,y)=>x+(y-x)*u;
  return {
    km:target,
    elevation:lerp(+a.rail[lo],+a.rail[hi]),
    terrain:lerp(+a.terrain[lo],+a.terrain[hi]),
    coord:[lerp(+coords[lo][0],+coords[hi][0]),lerp(+coords[lo][1],+coords[hi][1])],
    lo,hi,u
  };
}

function visibleRoutePositionAtRatio(line,ratio){
  const coords=displayedLineCoords(line);if(!coords||coords.length<2)return null;
  const segKm=[],cum=[0];
  for(let i=1;i<coords.length;i++){
    const km=havLL(coords[i-1],coords[i]);segKm.push(km);cum.push(cum.at(-1)+km);
  }
  const total=Math.max(1e-9,cum.at(-1));
  const target=clamp(ratio,0,1)*total;
  let i=1;while(i<cum.length&&cum[i]<target)i++;
  i=Math.min(i,cum.length-1);
  const a=coords[i-1],b=coords[i],span=Math.max(1e-9,cum[i]-cum[i-1]);
  const u=clamp((target-cum[i-1])/span,0,1);
  return {
    coord:[+a[0]+(+b[0]-+a[0])*u,+a[1]+(+b[1]-+a[1])*u],
    segment:i,
    a,b,u,totalKm:total
  };
}

function mapHoverToProfile(line,row){
  const p=analysedProfile(line);if(!p)return null;
  const visible=row.measure.coords;if(!visible||visible.length<2)return null;
  const segKm=[],cum=[0];
  for(let i=1;i<visible.length;i++){
    const km=havLL(visible[i-1],visible[i]);segKm.push(km);cum.push(cum.at(-1)+km);
  }
  const i=row.hit.segment;
  const along=cum[i-1]+segKm[i-1]*row.hit.t;
  const ratio=clamp(along/Math.max(1e-9,cum.at(-1)),0,1);
  const km=ratio*Math.max(.001,+p.a.distKm.at(-1)||0);
  const point=profilePointAtKm(line,km);if(!point)return null;
  point.mapCoord=[
    +visible[i-1][0]+(+visible[i][0]-+visible[i-1][0])*row.hit.t,
    +visible[i-1][1]+(+visible[i][1]-+visible[i-1][1])*row.hit.t
  ];
  point.mapSegment={a:visible[i-1],b:visible[i]};
  return point;
}

let linkedProfileHover=null;

function ensureProfileMapOverlay(){
  let g=svg.querySelector('#capa-profile-linked-hover');
  if(g)return g;
  g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.id='capa-profile-linked-hover';
  g.style.pointerEvents='none';
  svg.appendChild(g);
  return g;
}

function clearProfileMapOverlay(){
  const g=svg.querySelector('#capa-profile-linked-hover');
  if(g)g.innerHTML='';
}

function renderProfileMapOverlay(line,point){
  const g=ensureProfileMapOverlay();
  const ll=point.mapCoord||point.coord;
  const [x,y]=project(...ll),u=routeUserUnitsPerPixel();
  const seg=point.mapSegment||(()=>{
    const pos=visibleRoutePositionAtRatio(line,point.km/Math.max(.001,line.analysis.distKm.at(-1)));
    return pos?{a:pos.a,b:pos.b}:null;
  })();
  const parts=[];
  if(seg){
    const a=project(...seg.a),b=project(...seg.b);
    parts.push(`<path d="M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}" fill="none" stroke="#ffd166" stroke-width="8" opacity=".55" vector-effect="non-scaling-stroke"/>`);
  }
  parts.push(`<circle cx="${x}" cy="${y}" r="${5.5*u}" fill="#ffd166" stroke="#081c33" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
  const lx=x+12*u,ly=y-34*u;
  parts.push(`<g transform="translate(${lx} ${ly}) scale(${u})">
    <rect x="0" y="0" width="72" height="18" rx="3" fill="#081c33" fill-opacity=".94" stroke="#dfeaf3" stroke-opacity=".35"/>
    <text x="36" y="12.5" text-anchor="middle" fill="#ffffff" style="font:600 11px 'IBM Plex Mono',monospace">${Math.round(point.elevation)} m</text>
    <rect x="0" y="21" width="72" height="18" rx="3" fill="#081c33" fill-opacity=".94" stroke="#dfeaf3" stroke-opacity=".35"/>
    <text x="36" y="33.5" text-anchor="middle" fill="#ffffff" style="font:600 11px 'IBM Plex Mono',monospace">km ${point.km.toFixed(1)}</text>
  </g>`);
  g.innerHTML=parts.join('');
}

function clearAllProfileHover(){
  linkedProfileHover=null;
  clearProfileMapOverlay();
  parentElement.querySelectorAll('.interactive-profile').forEach(s=>{
    const overlay=s.querySelector('[data-profile-hover]');if(overlay)overlay.setAttribute('visibility','hidden');
  });
}

function updateProfileChartHover(line,point){
  const s=parentElement.querySelector(`.interactive-profile[data-line-id="${line.id}"]`);
  if(!s)return;
  const a=line.analysis,g=profileChartGeometry(a),x=g.x(point.km),y=g.y(point.elevation);
  const overlay=s.querySelector('[data-profile-hover]');if(!overlay)return;
  overlay.setAttribute('visibility','visible');
  const set=(sel,attrs)=>{const el=overlay.querySelector(sel);if(el)for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v)};
  set('[data-hover-v]',{x1:x,x2:x,y1:g.t,y2:g.h-g.b});
  set('[data-hover-h]',{x1:g.l,x2:g.w-g.r,y1:y,y2:y});
  set('[data-hover-dot]',{cx:x,cy:y});
  const segA=profilePointAtKm(line,a.distKm[point.lo]);
  const segB=profilePointAtKm(line,a.distKm[point.hi]);
  const seg=overlay.querySelector('[data-hover-segment]');
  if(seg&&segA&&segB)seg.setAttribute('d',`M ${g.x(segA.km)} ${g.y(segA.elevation)} L ${g.x(segB.km)} ${g.y(segB.elevation)}`);
  const topX=clamp(x,36,g.w-36),bottomX=clamp(x,38,g.w-38);
  set('[data-hover-alt-bg]',{x:topX-32});
  set('[data-hover-alt]',{x:topX});
  const alt=overlay.querySelector('[data-hover-alt]');if(alt)alt.textContent=`${Math.round(point.elevation)} m`;
  set('[data-hover-km-bg]',{x:bottomX-34});
  set('[data-hover-km]',{x:bottomX});
  const km=overlay.querySelector('[data-hover-km]');if(km)km.textContent=`km ${point.km.toFixed(1)}`;
}

function setLinkedProfileHover(line,point,source){
  linkedProfileHover={lineId:line.id,source,point};
  if(!point.mapCoord){
    const ratio=point.km/Math.max(.001,+line.analysis.distKm.at(-1)||0);
    const pos=visibleRoutePositionAtRatio(line,ratio);
    if(pos){point.mapCoord=pos.coord;point.mapSegment={a:pos.a,b:pos.b};}
  }
  renderProfileMapOverlay(line,point);
  updateProfileChartHover(line,point);
}

profileSvg=function(a){
  if(!a?.terrain?.length||!a?.rail?.length||!a?.distKm?.length)return '';
  const line=state.lines.find(l=>l.analysis===a);
  if(!line)return '';
  const g=profileChartGeometry(a),path=arr=>'M '+arr.map((v,i)=>`${g.x(a.distKm[i]).toFixed(2)} ${g.y(v).toFixed(2)}`).join(' L ');
  const xStep=niceAxisStep(g.total,5),yStep=niceAxisStep(g.yMax-g.yMin,4);
  const xTicks=[];for(let v=0;v<=g.total+xStep*.25;v+=xStep)xTicks.push(Math.min(v,g.total));
  if(Math.abs(xTicks.at(-1)-g.total)>xStep*.2)xTicks.push(g.total);
  const yStart=Math.ceil(g.yMin/yStep)*yStep,yTicks=[];for(let v=yStart;v<=g.yMax+1e-9;v+=yStep)yTicks.push(v);
  let grid='';
  for(const v of xTicks){const x=g.x(v);grid+=`<line x1="${x}" x2="${x}" y1="${g.t}" y2="${g.h-g.b}" stroke="#d6d0c2" stroke-width=".7"/><text x="${x}" y="${g.h-16}" text-anchor="middle" style="font:8px 'IBM Plex Mono',monospace;fill:#5b6478">${g.total<20?v.toFixed(1):Math.round(v)}</text>`;}
  for(const v of yTicks){const y=g.y(v);grid+=`<line x1="${g.l}" x2="${g.w-g.r}" y1="${y}" y2="${y}" stroke="#d6d0c2" stroke-width=".7"/><text x="${g.l-5}" y="${y+3}" text-anchor="end" style="font:8px 'IBM Plex Mono',monospace;fill:#5b6478">${Math.round(v)}</text>`;}
  return `<svg class="profile interactive-profile" data-line-id="${esc(line.id)}" viewBox="0 0 ${g.w} ${g.h}" preserveAspectRatio="none" style="height:150px;cursor:crosshair;touch-action:none">
    <rect x="0" y="0" width="${g.w}" height="${g.h}" fill="#f7f4e9"/>
    ${grid}
    <line x1="${g.l}" x2="${g.w-g.r}" y1="${g.h-g.b}" y2="${g.h-g.b}" stroke="#4e5968" stroke-width="1"/>
    <line x1="${g.l}" x2="${g.l}" y1="${g.t}" y2="${g.h-g.b}" stroke="#4e5968" stroke-width="1"/>
    <path class="terrain" d="${path(a.terrain)}"/>
    <path class="rail" d="${path(a.rail)}"/>
    <text x="${(g.l+g.w-g.r)/2}" y="${g.h-3}" text-anchor="middle" style="font:8.5px 'IBM Plex Mono',monospace;fill:#424b5a">km de via</text>
    <text transform="translate(12 ${(g.t+g.h-g.b)/2}) rotate(-90)" text-anchor="middle" style="font:8.5px 'IBM Plex Mono',monospace;fill:#424b5a">metres d'alçada</text>
    <g transform="translate(${g.l+4} 7)" pointer-events="none">
      <line x1="0" x2="18" y1="0" y2="0" class="terrain"/><text x="22" y="3" style="font:7.5px 'IBM Plex Mono',monospace;fill:#5b6478">terreny</text>
      <line x1="65" x2="83" y1="0" y2="0" class="rail"/><text x="87" y="3" style="font:7.5px 'IBM Plex Mono',monospace;fill:#5b6478">rasant</text>
    </g>
    <g data-profile-hover visibility="hidden" pointer-events="none">
      <path data-hover-segment fill="none" stroke="#ffd166" stroke-width="5" stroke-linecap="round"/>
      <line data-hover-v stroke="#253447" stroke-width="1" stroke-dasharray="3 3"/>
      <line data-hover-h stroke="#253447" stroke-width="1" stroke-dasharray="3 3"/>
      <circle data-hover-dot r="4.2" fill="#ffd166" stroke="#081c33" stroke-width="1.5"/>
      <rect data-hover-alt-bg y="1" width="64" height="16" rx="3" fill="#081c33"/>
      <text data-hover-alt y="12" text-anchor="middle" fill="#fff" style="font:600 9px 'IBM Plex Mono',monospace"></text>
      <rect data-hover-km-bg y="${g.h-29}" width="68" height="16" rx="3" fill="#081c33"/>
      <text data-hover-km y="${g.h-18}" text-anchor="middle" fill="#fff" style="font:600 9px 'IBM Plex Mono',monospace"></text>
    </g>
  </svg>`;
};

function bindInteractiveProfiles(){
  parentElement.querySelectorAll('.interactive-profile[data-line-id]').forEach(s=>{
    if(s.dataset.linkedProfileBound==='1')return;
    s.dataset.linkedProfileBound='1';
    s.addEventListener('pointermove',e=>{
      const line=state.lines.find(l=>l.id===s.dataset.lineId);if(!line||!analysedProfile(line))return;
      const ctm=s.getScreenCTM();if(!ctm)return;
      const q=s.createSVGPoint();q.x=e.clientX;q.y=e.clientY;
      const p=q.matrixTransform(ctm.inverse()),g=profileChartGeometry(line.analysis);
      const x=clamp(p.x,g.l,g.w-g.r),km=(x-g.l)/(g.w-g.l-g.r)*g.total;
      const point=profilePointAtKm(line,km);if(point)setLinkedProfileHover(line,point,'chart');
    });
    s.addEventListener('pointerleave',()=>{
      if(linkedProfileHover?.source==='chart'&&linkedProfileHover.lineId===s.dataset.lineId)clearAllProfileHover();
    });
  });
}

const renderLinesBeforeLinkedProfile=renderLines;
renderLines=function(){
  renderLinesBeforeLinkedProfile();
  bindInteractiveProfiles();
  if(linkedProfileHover){
    const line=state.lines.find(l=>l.id===linkedProfileHover.lineId);
    if(line&&analysedProfile(line))updateProfileChartHover(line,linkedProfileHover.point);
  }
};

function bestAnalysedRouteHover(cx,cy){
  let best=null;
  for(const line of state.lines){
    if(!analysedProfile(line))continue;
    const sticky=linkedProfileHover?.source==='map'&&linkedProfileHover.lineId===line.id;
    const row=routeHit(line,cx,cy,sticky?30:18);
    if(!row)continue;
    const score=row.hit.d+(line.id===state.activeId?-1e-7:0);
    if(!best||score<best.score)best={line,row,score};
  }
  return best;
}

parentElement.addEventListener('pointermove',e=>{
  if(routeDrag||!pointerInsideMap(e))return;
  const hit=bestAnalysedRouteHover(e.clientX,e.clientY);
  if(hit){
    const point=mapHoverToProfile(hit.line,hit.row);
    if(point)setLinkedProfileHover(hit.line,point,'map');
    return;
  }
  if(linkedProfileHover?.source==='map')clearAllProfileHover();
},{capture:true});

svg.addEventListener('pointerleave',()=>{
  if(linkedProfileHover?.source==='map')clearAllProfileHover();
});

const beginStationRouteDragBeforeProfile=beginStationRouteDrag;
beginStationRouteDrag=function(...args){
  clearAllProfileHover();
  return beginStationRouteDragBeforeProfile(...args);
};
const beginFreeRouteDragBeforeProfile=beginFreeRouteDrag;
beginFreeRouteDrag=function(...args){
  clearAllProfileHover();
  return beginFreeRouteDragBeforeProfile(...args);
};

renderLines();
