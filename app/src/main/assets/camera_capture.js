(function(){
  if(window.__reelRecordInAppCameraV6)return;
  window.__reelRecordInAppCameraV6=true;

  let stream=null;
  let facing='environment';
  const realFetch=window.fetch ? window.fetch.bind(window) : null;

  // UPCitemdb is now queried natively by Android. Avoid a second browser request
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
