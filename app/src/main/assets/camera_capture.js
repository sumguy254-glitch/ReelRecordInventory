(function(){
  if(window.__reelRecordInAppCameraV6)return;
  window.__reelRecordInAppCameraV6=true;

  let stream=null;
  let facing='environment';
  const realFetch=window.fetch ? window.fetch.bind(window) : null;

  // UPCitemdb is queried natively by Android. Avoid a second browser request
  // from the older lookup layer, which would unnecessarily consume the free quota.
  if(realFetch){
    window.fetch=function(input,init){
      const url=typeof input==='string'?input:(input&&input.url)||'';
      if(window.AndroidBridge && /https:\/\/api\.upcitemdb\.com\/prod\/trial\/lookup\?upc=/i.test(url)){
        return Promise.resolve(new Response(JSON.stringify({code:'OK',total:0,offset:0,items:[]}),{status:200,headers:{'Content-Type':'application/json'}}));
      }
      return realFetch(input,init);
    };
  }

  function stopCamera(){
    if(stream){try{stream.getTracks().forEach(t=>t.stop())}catch(_){}stream=null;}
    const v=document.getElementById('rrVisualVideo');if(v)v.srcObject=null;
  }

  function ensureModal(){
    if(document.getElementById('rrVisualCameraModal'))return;
    const m=document.createElement('div');
    m.id='rrVisualCameraModal';
    m.className='modalbg hidden';
    m.innerHTML=`<div class="modal" style="max-width:760px">
      <div class="head" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span>Visual Search Camera</span>
        <button id="rrVisualClose" class="secondary">Close</button>
      </div>
      <div class="body">
        <div style="position:relative;background:#000;border-radius:12px;overflow:hidden;min-height:240px;display:flex;align-items:center;justify-content:center">
          <video id="rrVisualVideo" autoplay playsinline muted style="display:block;width:100%;max-height:68vh;object-fit:contain;background:#000"></video>
          <div id="rrVisualCamMsg" style="position:absolute;left:10px;right:10px;bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,.72);color:#fff;font-size:13px">Starting camera…</div>
        </div>
        <canvas id="rrVisualCanvas" style="display:none"></canvas>
        <div class="actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button id="rrVisualCapture">📷 Capture & Search</button>
          <button id="rrVisualSwitch" class="secondary">Switch Camera</button>
          <button id="rrVisualGallery" class="secondary">Choose Existing Photo</button>
        </div>
        <div class="muted" style="margin-top:8px">For best results, fill most of the frame with the front cover and avoid glare. The photo is analyzed on-device; only recognized barcode/text is used for database matching.</div>
      </div>
    </div>`;
    document.body.appendChild(m);
    document.getElementById('rrVisualClose').onclick=closeCamera;
    document.getElementById('rrVisualCapture').onclick=capture;
    document.getElementById('rrVisualSwitch').onclick=async()=>{facing=facing==='environment'?'user':'environment';await startCamera();};
    document.getElementById('rrVisualGallery').onclick=()=>{closeCamera();if(window.AndroidBridge&&typeof AndroidBridge.startVisualSearch==='function'){status('Choose an existing cover image…');AndroidBridge.startVisualSearch();}};
    m.addEventListener('click',ev=>{if(ev.target===m)closeCamera();});
  }

  async function startCamera(){
    ensureModal();
    const modal=document.getElementById('rrVisualCameraModal');
    const msg=document.getElementById('rrVisualCamMsg');
    modal.classList.remove('hidden');
    stopCamera();
    try{
      if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('Camera preview is not available on this device.');
      msg.textContent='Starting camera…';
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1080}}});
      const video=document.getElementById('rrVisualVideo');
      video.srcObject=stream;
      await video.play();
      msg.textContent='Center the cover in the frame, then tap Capture & Search.';
    }catch(err){
      msg.textContent='Camera could not start: '+(err&&err.message?err.message:err)+'. You can still choose an existing photo.';
    }
  }

  function closeCamera(){stopCamera();document.getElementById('rrVisualCameraModal')?.classList.add('hidden');}

  function capture(){
    const video=document.getElementById('rrVisualVideo');
    const canvas=document.getElementById('rrVisualCanvas');
    if(!video||!canvas||!video.videoWidth||!video.videoHeight)return status('Camera is not ready yet.','err');
    let w=video.videoWidth,h=video.videoHeight;
    const max=1600;
    if(Math.max(w,h)>max){const s=max/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);}
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(video,0,0,w,h);
    const dataUrl=canvas.toDataURL('image/jpeg',0.88);
    closeCamera();
    status('Analyzing captured cover on-device…');
    if(window.AndroidBridge&&typeof AndroidBridge.analyzeVisualImage==='function'){
      AndroidBridge.analyzeVisualImage(dataUrl);
    }else{
      status('This app build does not include native visual analysis.','err');
    }
  }

  function hookButton(){
    const b=document.getElementById('visualSearch');
    if(!b)return false;
    b.textContent='📷 Visual Search';
    b.title='Take a cover photo inside the app or choose an existing image';
    b.onclick=()=>startCamera();
    return true;
  }

  if(!hookButton()){
    let tries=0;const t=setInterval(()=>{tries++;if(hookButton()||tries>30)clearInterval(t)},200);
  }

  window.addEventListener('pagehide',stopCamera);
})();

(function(){
  if(window.__reelRecordUseAndAddV7)return;
  window.__reelRecordUseAndAddV7=true;

  function decorateResult(row){
    if(!row||row.querySelector('[data-use-add]'))return;
    const useButton=row.querySelector('button[data-pick],button[data-vpick]');
    if(!useButton)return;

    const holder=document.createElement('div');
    holder.style.display='grid';
    holder.style.gap='6px';
    holder.style.alignSelf='center';
    useButton.replaceWith(holder);
    holder.appendChild(useButton);

    const quick=document.createElement('button');
    quick.type='button';
    quick.className='secondary';
    quick.textContent='Use & Add';
    quick.dataset.useAdd='1';
    quick.title='Use this match, add it to inventory, and keep scanning';
    quick.onclick=ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      const itemTitle=row.querySelector('.title')?.textContent?.trim()||'Item';
      useButton.click();
      const saveButton=document.getElementById('save');
      if(saveButton){
        saveButton.click();
        const scanStatus=document.getElementById('scanStatus');
        if(scanStatus)scanStatus.textContent='Added '+itemTitle+'. Camera active — scan the next barcode.';
        try{lastTime=Date.now();}catch(_){}
      }
    };
    holder.appendChild(quick);
  }

  function decorateAll(){
    document.querySelectorAll('#results .result').forEach(decorateResult);
  }

  const results=document.getElementById('results');
  if(results){
    new MutationObserver(decorateAll).observe(results,{childList:true,subtree:true});
    decorateAll();
  }else{
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      const r=document.getElementById('results');
      if(r){new MutationObserver(decorateAll).observe(r,{childList:true,subtree:true});decorateAll();clearInterval(timer);}
      else if(tries>30)clearInterval(timer);
    },200);
  }
})();

(function(){
  if(window.__reelRecordInventoryV8)return;
  window.__reelRecordInventoryV8=true;

  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  let currentTab='scan';
  let resumeScanner=false;

  function valueOf(x){const n=Number(x?.estimatedValue||0);return Number.isFinite(n)&&n>0?n:0;}
  function qtyOf(x){const n=parseInt(x?.quantity||1,10);return Number.isFinite(n)&&n>0?n:1;}
  function itemTotal(x){return valueOf(x)*qtyOf(x);}

  function addStyles(){
    if(document.getElementById('rrInventoryStyles'))return;
    const s=document.createElement('style');
    s.id='rrInventoryStyles';
    s.textContent=`
      #rrTabs{max-width:1100px;margin:12px auto 0;padding:0 14px;display:flex;gap:8px}
      #rrTabs button{flex:1;padding:12px 14px;background:#23262d;border:1px solid #363b46}
      #rrTabs button.active{background:#8b5cf6;border-color:#8b5cf6}
      main.wrap.rr-tabbed{grid-template-columns:1fr;max-width:1100px}
      .rr-value-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px;border-bottom:1px solid #363b46}
      .rr-value-card{background:#121419;border:1px solid #363b46;border-radius:10px;padding:10px}
      .rr-value-card .rr-label{color:#aab1bc;font-size:11px;margin-bottom:3px}
      .rr-value-card .rr-amount{font-size:18px;font-weight:800}
      .rr-item-value{color:#86efac;font-size:12px;margin-top:4px;font-weight:650}
      #estimatedValueRow .rr-money-wrap{position:relative}
      #estimatedValueRow .rr-dollar{position:absolute;left:11px;top:10px;color:#aab1bc;pointer-events:none}
      #estimatedValue{padding-left:25px}
      #rrEstimatedHelp{margin-top:5px;color:#aab1bc;font-size:11px}
      @media(max-width:650px){.rr-value-summary{grid-template-columns:1fr 1fr}.rr-value-card .rr-amount{font-size:16px}}
    `;
    document.head.appendChild(s);
  }

  function addValueField(){
    if(document.getElementById('estimatedValue'))return;
    const quantity=document.getElementById('quantity');
    const anchor=quantity?.parentElement?.parentElement;
    if(!anchor)return;
    const row=document.createElement('div');
    row.id='estimatedValueRow';
    row.innerHTML='<label>Estimated Value (per copy)</label><div class="rr-money-wrap"><span class="rr-dollar">$</span><input id="estimatedValue" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div><div id="rrEstimatedHelp">Optional. Enter what you believe one copy is worth; collection totals multiply this by Quantity.</div>';
    anchor.insertAdjacentElement('afterend',row);
    try{e.estimatedValue=document.getElementById('estimatedValue')}catch(_){}
  }

  function addSummary(inventorySection){
    if(document.getElementById('rrValueSummary'))return;
    const box=document.createElement('div');
    box.id='rrValueSummary';
    box.className='rr-value-summary';
    box.innerHTML=`
      <div class="rr-value-card"><div class="rr-label">Movies</div><div id="rrMovieValue" class="rr-amount">$0.00</div></div>
      <div class="rr-value-card"><div class="rr-label">TV Seasons</div><div id="rrTvValue" class="rr-amount">$0.00</div></div>
      <div class="rr-value-card"><div class="rr-label">Music</div><div id="rrMusicValue" class="rr-amount">$0.00</div></div>
      <div class="rr-value-card"><div class="rr-label">Total Collection</div><div id="rrTotalValue" class="rr-amount">$0.00</div></div>`;
    const head=inventorySection?.querySelector('.head');
    if(head)head.insertAdjacentElement('afterend',box);
  }

  function switchTab(name){
    const main=document.querySelector('main.wrap');
    if(!main)return;
    const sections=Array.from(main.querySelectorAll(':scope > section.card'));
    const scanSection=sections[0],inventorySection=sections[1];
    if(!scanSection||!inventorySection)return;
    currentTab=name==='inventory'?'inventory':'scan';
    const scanBtn=document.getElementById('rrScanTab'),invBtn=document.getElementById('rrInventoryTab');
    if(scanBtn)scanBtn.classList.toggle('active',currentTab==='scan');
    if(invBtn)invBtn.classList.toggle('active',currentTab==='inventory');
    scanSection.style.display=currentTab==='scan'?'block':'none';
    inventorySection.style.display=currentTab==='inventory'?'block':'none';

    if(currentTab==='inventory'){
      try{resumeScanner=!!scanning;if(scanning)stopScan();}catch(_){}
      try{window.render?.()}catch(_){}
      window.scrollTo({top:0,behavior:'smooth'});
    }else{
      const shouldResume=resumeScanner;resumeScanner=false;
      if(shouldResume)setTimeout(()=>{try{startScan()}catch(_){}},250);
      window.scrollTo({top:0,behavior:'smooth'});
    }
  }
  window.rrSwitchTab=switchTab;

  function addTabs(){
    const main=document.querySelector('main.wrap');
    if(!main)return;
    main.classList.add('rr-tabbed');
    const sections=Array.from(main.querySelectorAll(':scope > section.card'));
    const scanSection=sections[0],inventorySection=sections[1];
    if(!scanSection||!inventorySection)return;
    scanSection.id='rrScanSection';inventorySection.id='rrInventorySection';
    if(!document.getElementById('rrTabs')){
      const nav=document.createElement('div');nav.id='rrTabs';
      nav.innerHTML='<button id="rrScanTab" class="active">📷 Scan / Add</button><button id="rrInventoryTab">📚 Inventory</button>';
      document.querySelector('header')?.insertAdjacentElement('afterend',nav);
      document.getElementById('rrScanTab').onclick=()=>switchTab('scan');
      document.getElementById('rrInventoryTab').onclick=()=>switchTab('inventory');
    }
    addSummary(inventorySection);
    switchTab('scan');
  }

  function updateTotals(){
    let movie=0,tv=0,music=0,total=0;
    try{
      for(const x of inv){
        const v=itemTotal(x);total+=v;
        if(x.type==='TV Season')tv+=v;else if(x.type==='Music')music+=v;else movie+=v;
      }
    }catch(_){}
    const vals={rrMovieValue:movie,rrTvValue:tv,rrMusicValue:music,rrTotalValue:total};
    for(const [id,v] of Object.entries(vals)){const el=document.getElementById(id);if(el)el.textContent=money.format(v)}
    let pill=document.getElementById('sValue');
    if(!pill){const stats=document.querySelector('.stats');if(stats){pill=document.createElement('span');pill.id='sValue';pill.className='pill';stats.appendChild(pill)}}
    if(pill)pill.textContent='Est. '+money.format(total);
  }

  function updateItemValueLabels(){
    document.querySelectorAll('#items .item').forEach(row=>{
      const editBtn=row.querySelector('button[data-edit]');
      if(!editBtn)return;
      let x=null;try{x=inv.find(a=>String(a.id)===String(editBtn.dataset.edit))}catch(_){}
      if(!x)return;
      let line=row.querySelector('.rr-item-value');
      if(!line){line=document.createElement('div');line.className='rr-item-value';const textCol=row.children[1];if(textCol)textCol.appendChild(line)}
      const unit=valueOf(x),total=itemTotal(x),q=qtyOf(x);
      line.textContent=unit?(q>1?'Estimated: '+money.format(unit)+' each • '+money.format(total)+' total':'Estimated value: '+money.format(unit)):'Estimated value: Not set';
      line.style.color=unit?'#86efac':'#aab1bc';
    });
  }

  function patchDataFunctions(){
    try{
      if(typeof collect==='function'&&!window.__rrCollectV8){
        window.__rrCollectV8=true;
        const oldCollect=collect;
        const next=function(){const x=oldCollect();const n=parseFloat(document.getElementById('estimatedValue')?.value||'0');x.estimatedValue=Number.isFinite(n)&&n>0?Math.round(n*100)/100:0;return x};
        collect=next;window.collect=next;
      }
    }catch(_){}
    try{
      if(typeof clearForm==='function'&&!window.__rrClearV8){
        window.__rrClearV8=true;
        const oldClear=clearForm;
        const next=function(){oldClear();const v=document.getElementById('estimatedValue');if(v)v.value=''};
        clearForm=next;window.clearForm=next;
      }
    }catch(_){}
    try{
      if(typeof edit==='function'&&!window.__rrEditV8){
        window.__rrEditV8=true;
        const oldEdit=edit;
        const next=function(idv){oldEdit(idv);let x=null;try{x=inv.find(a=>String(a.id)===String(idv))}catch(_){}const v=document.getElementById('estimatedValue');if(v)v.value=valueOf(x)||'';switchTab('scan')};
        edit=next;window.edit=next;
      }
    }catch(_){}
    try{
      if(typeof render==='function'&&!window.__rrRenderV8){
        window.__rrRenderV8=true;
        const oldRender=render;
        const next=function(){oldRender();updateItemValueLabels();updateTotals()};
        render=next;window.render=next;
      }
    }catch(_){}
  }

  function patchResultSelection(){
    const results=document.getElementById('results');if(!results)return;
    results.addEventListener('click',ev=>{
      const use=ev.target.closest?.('button[data-pick],button[data-vpick]');if(!use)return;
      const row=use.closest('.result');if(!row)return;
      const meta=row.querySelector('.meta')?.textContent||'';
      const m=meta.match(/(?:estimated\s+(?:value|price)|value estimate)\s*[:$]?\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i);
      if(m){const input=document.getElementById('estimatedValue');if(input&&!input.value)input.value=m[1]}
    });
  }

  function init(){
    addStyles();addValueField();addTabs();patchDataFunctions();patchResultSelection();
    try{window.render?.()}catch(_){updateTotals()}
  }
  init();
})();
