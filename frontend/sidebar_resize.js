/* Ferrocat: resizable/collapsible right control panel with a central hinge. */
(() => {
  const layout=parentElement.querySelector('.layout');
  const aside=layout?.querySelector('aside');
  if(!layout||!aside||layout.querySelector('.ferro-sidebar-hinge'))return;

  const STORAGE_KEY='ferrocat-right-panel-v1';
  const DEFAULT_WIDTH=380;
  const MIN_WIDTH=280;
  const COLLAPSE_THRESHOLD=150;

  const style=document.createElement('style');
  style.textContent=`
    .layout{position:relative}
    .layout>aside{
      transition:width .16s ease,flex-basis .16s ease,padding .16s ease,border-color .16s ease;
    }
    .layout.ferro-sidebar-resizing>aside{transition:none!important}
    .ferro-sidebar-hinge{
      position:absolute;
      top:50%;
      z-index:2500;
      width:24px;
      height:64px;
      padding:0;
      transform:translateY(-50%);
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      gap:2px;
      color:#1c2333;
      background:#fffdf8;
      border:1px solid #cfc5ad;
      border-radius:8px 0 0 8px;
      box-shadow:-2px 1px 8px rgba(8,28,51,.22);
      cursor:ew-resize;
      touch-action:none;
      user-select:none;
      transition:right .16s ease,background .12s ease,border-color .12s ease;
    }
    .layout.ferro-sidebar-resizing .ferro-sidebar-hinge{transition:none!important}
    .ferro-sidebar-hinge:hover,
    .ferro-sidebar-hinge:focus-visible{
      background:#fff5ec;
      border-color:#ff6b35;
      outline:none;
    }
    .ferro-sidebar-hinge .ferro-hinge-arrow{
      font:700 16px/1 'IBM Plex Mono',monospace;
      color:#ff6b35;
      pointer-events:none;
    }
    .ferro-sidebar-hinge .ferro-hinge-grip{
      font:700 12px/1 'IBM Plex Mono',monospace;
      letter-spacing:-2px;
      color:#817866;
      pointer-events:none;
    }
    .layout.ferro-sidebar-resizing,
    .layout.ferro-sidebar-resizing *{
      cursor:ew-resize!important;
      user-select:none!important;
    }
    @media(max-width:900px){
      .ferro-sidebar-hinge{display:none!important}
      .layout>aside{
        width:100%!important;
        flex:0 0 auto!important;
        max-width:none!important;
        padding:13px 13px 36px!important;
        border-left:0!important;
        overflow-y:auto!important;
      }
    }
  `;
  parentElement.appendChild(style);

  const hinge=document.createElement('button');
  hinge.type='button';
  hinge.className='ferro-sidebar-hinge';
  hinge.setAttribute('aria-controls','ferrocat-right-panel');
  aside.id=aside.id||'ferrocat-right-panel';
  hinge.innerHTML='<span class="ferro-hinge-grip">••</span><span class="ferro-hinge-arrow">›</span><span class="ferro-hinge-grip">••</span>';
  layout.appendChild(hinge);

  let saved={};
  try{saved=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'{}')||{}}catch{}

  let lastOpenWidth=Number.isFinite(+saved.lastOpenWidth)?+saved.lastOpenWidth:
    (Number.isFinite(+saved.width)&&+saved.width>0?+saved.width:DEFAULT_WIDTH);
  let currentWidth=saved.collapsed?0:lastOpenWidth;
  let drag=null;
  let suppressClick=false;

  function desktop(){return (parentElement.getBoundingClientRect().width||window.innerWidth)>900;}
  function maxWidth(){
    const total=Math.max(1,layout.getBoundingClientRect().width);
    return Math.max(MIN_WIDTH,Math.min(760,total*.62));
  }
  function clampOpenWidth(v){return Math.max(MIN_WIDTH,Math.min(maxWidth(),v));}

  function persist(collapsed){
    try{
      sessionStorage.setItem(STORAGE_KEY,JSON.stringify({
        width:currentWidth,
        lastOpenWidth,
        collapsed
      }));
    }catch{}
  }

  function applyWidth(width,{saveState=true,animate=true}={}){
    if(!desktop())return;
    if(!animate)layout.classList.add('ferro-sidebar-resizing');

    const collapsed=width<=0;
    currentWidth=collapsed?0:clampOpenWidth(width);
    if(!collapsed)lastOpenWidth=currentWidth;

    aside.style.width=`${currentWidth}px`;
    aside.style.flex=`0 0 ${currentWidth}px`;
    aside.style.minWidth='0';
    aside.style.maxWidth=`${maxWidth()}px`;
    aside.style.padding=collapsed?'0':'13px 13px 36px';
    aside.style.borderLeft=collapsed?'0 solid transparent':'1px solid var(--paper-edge)';
    aside.style.overflowY=collapsed?'hidden':'auto';
    aside.style.visibility=collapsed?'hidden':'visible';
    aside.setAttribute('aria-hidden',collapsed?'true':'false');

    // Boundary is `layout width - sidebar width`; keep the hinge centred there.
    hinge.style.right=`${Math.max(0,currentWidth-12)}px`;
    hinge.classList.toggle('collapsed',collapsed);
    hinge.querySelector('.ferro-hinge-arrow').textContent=collapsed?'‹':'›';
    hinge.title=collapsed?'Obre el panell lateral':'Arrossega per canviar l’amplada · clica per plegar';
    hinge.setAttribute('aria-label',collapsed?'Obre el panell lateral':'Redimensiona o plega el panell lateral');
    hinge.setAttribute('aria-expanded',collapsed?'false':'true');

    if(saveState)persist(collapsed);
    if(!animate)requestAnimationFrame(()=>layout.classList.remove('ferro-sidebar-resizing'));
  }

  function rerenderMapAfterResize(){
    // Screen-space labels/lane offsets depend on the map's real client width.
    requestAnimationFrame(()=>{
      try{renderMap()}catch{}
    });
  }

  hinge.addEventListener('pointerdown',e=>{
    if(e.button!==0||!desktop())return;
    e.preventDefault();
    e.stopPropagation();
    const startWidth=currentWidth||clampOpenWidth(lastOpenWidth);
    drag={pointerId:e.pointerId,startX:e.clientX,startWidth,moved:false};
    layout.classList.add('ferro-sidebar-resizing');
    try{hinge.setPointerCapture(e.pointerId)}catch{}
  });

  hinge.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.pointerId)return;
    e.preventDefault();
    e.stopPropagation();
    const delta=drag.startX-e.clientX;
    if(Math.abs(delta)>3)drag.moved=true;
    if(!drag.moved)return;

    const raw=drag.startWidth+delta;
    // Pulling almost all the way to the right also permits a natural collapse.
    if(raw<COLLAPSE_THRESHOLD)applyWidth(0,{saveState:false,animate:false});
    else applyWidth(raw,{saveState:false,animate:false});
  });

  function finishPointer(e){
    if(!drag||e.pointerId!==drag.pointerId)return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick=drag.moved;
    drag=null;
    layout.classList.remove('ferro-sidebar-resizing');
    try{hinge.releasePointerCapture(e.pointerId)}catch{}
    persist(currentWidth<=0);
    rerenderMapAfterResize();
  }

  hinge.addEventListener('pointerup',finishPointer);
  hinge.addEventListener('pointercancel',finishPointer);

  hinge.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    if(suppressClick){suppressClick=false;return;}
    if(!desktop())return;
    applyWidth(currentWidth>0?0:clampOpenWidth(lastOpenWidth));
    rerenderMapAfterResize();
  });

  const win=parentElement.ownerDocument?.defaultView||window;
  win.addEventListener('resize',()=>{
    if(!desktop())return;
    if(currentWidth>0)applyWidth(Math.min(currentWidth,maxWidth()),{saveState:false});
    else hinge.style.right='0px';
    rerenderMapAfterResize();
  });

  applyWidth(currentWidth);
})();
