(function(){
  if(window.__reelRecordValuationV9)return;
  window.__reelRecordValuationV9=true;

  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  const pending=new Map();
  let formEstimate=null;
  let updatingAll=false;

  function n(v){const x=Number(v||0);return Number.isFinite(x)&&x>0?Math.round(x*100)/100:0;}
  function wait(ms){return new Promise(r=>setTimeout(r,ms));}
  function parseJson(raw){try{return typeof raw==='string'?JSON.parse(raw||'{}'):(raw||{})}catch(_){return{}}}
  function currentBarcode(){try{return String(e.barcode.value||'').replace(/\D/g,'')}catch(_){return String(document.getElementById('barcode')?.value||'').replace(/\D/g,'')}}

  function cachedEstimate(barcode=currentBarcode()){
    try{
      if(!(window.AndroidBridge&&typeof AndroidBridge.getCachedEstimate==='function'))return null;
      const x=parseJson(AndroidBridge.getCachedEstimate(String(barcode||'')));
      return n(x.estimatedValue)?x:null;
    }catch(_){return null}
  }

  window.onRrEstimateResult=function(requestId,raw){
    const entry=pending.get(String(requestId||''));
    if(!entry)return;
    pending.delete(String(requestId||''));
    clearTimeout(entry.timer);
    const data=parseJson(raw);
    if(data.error)entry.reject(new Error(data.error));else entry.resolve(data);
  };

  function estimateAsync(barcode){
    return new Promise((resolve,reject)=>{
      const c=String(barcode||'').replace(/\D/g,'');
      if(!c)return reject(new Error('This item does not have a UPC/EAN barcode.'));
      if(!(window.AndroidBridge&&typeof AndroidBridge.estimateValueAsync==='function'))return reject(new Error('This build does not include automatic value lookup.'));
      const cached=cachedEstimate(c);if(cached)return resolve(cached);
      const id='rrv_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Value lookup timed out.'))},15000);
      pending.set(id,{resolve,reject,timer});
      AndroidBridge.estimateValueAsync(id,c);
    });
  }

  function copyEstimate(target,est){
    if(!target||!est)return;
    target.estimatedValue=n(est.estimatedValue);
    target.estimateLow=n(est.estimateLow);
    target.estimateHigh=n(est.estimateHigh);
    target.estimateSource=String(est.estimateSource||'UPCitemdb market estimate');
    target.estimateConfidence=String(est.estimateConfidence||'');
    target.estimateCompCount=parseInt(est.estimateCompCount||0,10)||0;
    target.estimateUpdatedAt=Number(est.estimateUpdatedAt||Date.now());
  }

  function setFormEstimate(est){
    if(!est||!n(est.estimatedValue))return;
    formEstimate={...est};
    const input=document.getElementById('estimatedValue');
    if(input)input.value=n(est.estimatedValue).toFixed(2);
    updateFormHelp(est);
  }

  function updateFormHelp(est){
    const help=document.getElementById('rrEstimatedHelp');if(!help)return;
    if(!est||!n(est.estimatedValue)){
      help.textContent='The app can estimate this automatically from UPCitemdb market data, or you can enter your own value.';
      return;
    }
    const low=n(est.estimateLow),high=n(est.estimateHigh),parts=[];
    parts.push(est.estimateSource||'Market estimate');
    if(low&&high)parts.push('typical range '+money.format(low)+'–'+money.format(high));
    if(est.estimateCompCount)parts.push(est.estimateCompCount+' comparable offer'+(Number(est.estimateCompCount)===1?'':'s'));
    if(est.estimateConfidence)parts.push(est.estimateConfidence+' confidence');
    help.textContent=parts.join(' • ')+'. You can override the amount manually.';
  }

  function estimateSummary(x){
    const value=n(x?.estimatedValue);if(!value)return'';
    const low=n(x?.estimateLow),high=n(x?.estimateHigh),parts=[];
    if(x?.estimateSource)parts.push(x.estimateSource);
    if(low&&high)parts.push(money.format(low)+'–'+money.format(high));
    if(x?.estimateCompCount)parts.push(x.estimateCompCount+' comp'+(Number(x.estimateCompCount)===1?'':'s'));
    if(x?.estimateConfidence)parts.push(x.estimateConfidence+' confidence');
    if(x?.estimateUpdatedAt){try{parts.push('updated '+new Date(Number(x.estimateUpdatedAt)).toLocaleDateString())}catch(_){}}
    return parts.join(' • ');
  }

  function decorateInventory(){
    document.querySelectorAll('#items .item').forEach(row=>{
      const editBtn=row.querySelector('button[data-edit]');if(!editBtn)return;
      let item=null;try{item=inv.find(x=>String(x.id)===String(editBtn.dataset.edit))}catch(_){}
      if(!item)return;

      const line=row.querySelector('.rr-item-value');
      if(line&&n(item.estimatedValue)){
        const details=estimateSummary(item);
        line.textContent=(Number(item.quantity||1)>1
          ?'Estimated: '+money.format(n(item.estimatedValue))+' each • '+money.format(n(item.estimatedValue)*Math.max(1,Number(item.quantity||1)))+' total'
          :'Estimated value: '+money.format(n(item.estimatedValue)))+(details?' • '+details:'');
      }

      const actions=row.querySelector('.actions');if(!actions)return;
      if(!actions.querySelector('[data-value-refresh]')){
        const b=document.createElement('button');b.type='button';b.className='secondary';b.dataset.valueRefresh=String(item.id);b.textContent='Update Value';actions.insertBefore(b,actions.firstChild);
      }
      if(!actions.querySelector('[data-ebay-sold]')){
        const b=document.createElement('button');b.type='button';b.className='secondary';b.dataset.ebaySold=String(item.id);b.textContent='Check eBay Sold';actions.insertBefore(b,actions.firstChild);
      }
    });
  }

  function decorateLookupResults(){
    const est=cachedEstimate();if(!est)return;
    document.querySelectorAll('#results .result').forEach(row=>{
      if(row.querySelector('.rr-lookup-estimate'))return;
      const text=row.querySelector('div:nth-child(2)');if(!text)return;
      const d=document.createElement('div');d.className='rr-lookup-estimate';d.style.cssText='margin-top:5px;color:#86efac;font-size:12px;font-weight:700';
      const low=n(est.estimateLow),high=n(est.estimateHigh);
      d.textContent='Market estimate: '+money.format(n(est.estimatedValue))+(low&&high?' • '+money.format(low)+'–'+money.format(high):'')+(est.estimateConfidence?' • '+est.estimateConfidence+' confidence':'');
      text.appendChild(d);
    });
  }

  function addControls(){
    const exportRow=document.getElementById('csv')?.parentElement;
    if(exportRow&&!document.getElementById('rrUpdateAllValues')){
      const b=document.createElement('button');b.id='rrUpdateAllValues';b.type='button';b.className='secondary';b.textContent='Update All Values';exportRow.appendChild(b);
      const status=document.createElement('div');status.id='rrValueRefreshStatus';status.className='status';status.style.flexBasis='100%';exportRow.appendChild(status);
    }
    const help=document.getElementById('rrEstimatedHelp');if(help&&!help.dataset.v9){help.dataset.v9='1';updateFormHelp(null)}
  }

  function patchCollect(){
    try{
      if(typeof collect!=='function'||window.__rrCollectV9)return;window.__rrCollectV9=true;
      const old=collect;
      const next=function(){
        const x=old();
        let source=formEstimate;
        if(!source&&editId){try{source=inv.find(a=>String(a.id)===String(editId))||null}catch(_){}}
        if(source&&n(x.estimatedValue)){
          x.estimateLow=n(source.estimateLow)||n(x.estimatedValue);
          x.estimateHigh=n(source.estimateHigh)||n(x.estimatedValue);
          x.estimateSource=source.estimateSource||'Manual estimate';
          x.estimateConfidence=source.estimateConfidence||'';
          x.estimateCompCount=parseInt(source.estimateCompCount||0,10)||0;
          x.estimateUpdatedAt=Number(source.estimateUpdatedAt||Date.now());
        }
        return x;
      };
      collect=next;window.collect=next;
    }catch(_){}
  }

  function patchClearAndEdit(){
    try{
      if(typeof clearForm==='function'&&!window.__rrClearV9){window.__rrClearV9=true;const old=clearForm;const next=function(){old();formEstimate=null;updateFormHelp(null)};clearForm=next;window.clearForm=next}
    }catch(_){}
    const input=document.getElementById('estimatedValue');
    if(input&&!input.dataset.v9){input.dataset.v9='1';input.addEventListener('input',()=>{const v=n(input.value);formEstimate=v?{estimatedValue:v,estimateLow:v,estimateHigh:v,estimateSource:'Manual estimate',estimateConfidence:'',estimateCompCount:0,estimateUpdatedAt:Date.now()}:null;updateFormHelp(formEstimate)})}
    const items=document.getElementById('items');
    if(items&&!items.dataset.v9Edit){items.dataset.v9Edit='1';items.addEventListener('click',ev=>{const b=ev.target.closest?.('button[data-edit]');if(!b)return;setTimeout(()=>{try{const x=inv.find(a=>String(a.id)===String(b.dataset.edit));if(x&&n(x.estimatedValue)){formEstimate={...x};updateFormHelp(x)}}catch(_){}},0)},true)}
  }

  function patchRender(){
    try{
      if(typeof render!=='function'||window.__rrRenderV9)return;window.__rrRenderV9=true;
      const old=render;
      const next=function(){old();decorateInventory();addControls()};render=next;window.render=next;
    }catch(_){}
  }

  async function refreshItem(id,quiet=false){
    let item=null;try{item=inv.find(x=>String(x.id)===String(id))}catch(_){}
    if(!item)throw new Error('Inventory item not found.');
    if(!item.barcode)throw new Error('This item has no barcode to look up.');
    const est=await estimateAsync(item.barcode);
    copyEstimate(item,est);persist();render();
    if(!quiet){const s=document.getElementById('rrValueRefreshStatus');if(s){s.className='status ok';s.textContent='Updated '+item.title+' to '+money.format(n(est.estimatedValue))+'.'}}
    return est;
  }

  async function refreshAll(){
    if(updatingAll)return;
    const itemsWithCodes=[];try{inv.forEach(x=>{if(String(x.barcode||'').replace(/\D/g,''))itemsWithCodes.push(x)})}catch(_){}
    if(!itemsWithCodes.length){const s=document.getElementById('rrValueRefreshStatus');if(s){s.className='status err';s.textContent='No inventory items have barcodes to value.'}return}
    if(!confirm('Update values for '+itemsWithCodes.length+' barcode item'+(itemsWithCodes.length===1?'':'s')+'? UPCitemdb free access is limited to 100 requests per day and 6 lookup requests per minute. Cached scans do not use another request.'))return;

    updatingAll=true;
    const btn=document.getElementById('rrUpdateAllValues'),s=document.getElementById('rrValueRefreshStatus');
    if(btn)btn.disabled=true;
    let ok=0,failed=0;
    try{
      for(let i=0;i<itemsWithCodes.length;i++){
        const item=itemsWithCodes[i];
        if(s){s.className='status';s.textContent='Updating '+(i+1)+' of '+itemsWithCodes.length+': '+item.title+'…'}
        try{
          const est=await refreshItem(item.id,true);ok++;
          if(!est.cached&&i<itemsWithCodes.length-1)await wait(10500);
        }catch(err){failed++;if(String(err?.message||err).includes('429')&&i<itemsWithCodes.length-1)await wait(12000)}
      }
    }finally{
      updatingAll=false;if(btn)btn.disabled=false;
      if(s){s.className='status '+(failed?'':'ok');s.textContent='Value refresh complete: '+ok+' updated'+(failed?' • '+failed+' unavailable/failed':'')+'.'}
    }
  }

  function openEbay(item){
    if(!item)return;
    const barcode=String(item.barcode||'').replace(/\D/g,'');
    const query=barcode||[item.title,item.format,item.year].filter(Boolean).join(' ');
    if(!query)return;
    const url='https://www.ebay.com/sch/i.html?_nkw='+encodeURIComponent(query)+'&_sacat=0&LH_Sold=1&LH_Complete=1';
    if(window.AndroidBridge&&typeof AndroidBridge.openExternalUrl==='function')AndroidBridge.openExternalUrl(url);else window.location.href=url;
  }

  function wireClicks(){
    const results=document.getElementById('results');
    if(results&&!results.dataset.v9Estimate){
      results.dataset.v9Estimate='1';
      results.addEventListener('click',ev=>{
        const use=ev.target.closest?.('button[data-pick],button[data-vpick]');if(!use)return;
        const est=cachedEstimate();if(est)setFormEstimate(est);
      },true);
      new MutationObserver(()=>setTimeout(decorateLookupResults,0)).observe(results,{childList:true,subtree:true});
    }

    const items=document.getElementById('items');
    if(items&&!items.dataset.v9ValueClicks){
      items.dataset.v9ValueClicks='1';
      items.addEventListener('click',async ev=>{
        const update=ev.target.closest?.('[data-value-refresh]');
        if(update){ev.preventDefault();ev.stopPropagation();const b=update;b.disabled=true;b.textContent='Updating…';try{await refreshItem(update.dataset.valueRefresh)}catch(err){const s=document.getElementById('rrValueRefreshStatus');if(s){s.className='status err';s.textContent=err?.message||String(err)}}finally{b.disabled=false;b.textContent='Update Value'}return}
        const ebay=ev.target.closest?.('[data-ebay-sold]');
        if(ebay){ev.preventDefault();ev.stopPropagation();let x=null;try{x=inv.find(a=>String(a.id)===String(ebay.dataset.ebaySold))}catch(_){}openEbay(x)}
      });
    }

    const all=document.getElementById('rrUpdateAllValues');if(all&&!all.dataset.v9){all.dataset.v9='1';all.onclick=refreshAll}
  }

  function autoEstimateManualSave(){
    const save=document.getElementById('save');if(!save||save.dataset.v9Auto)return;save.dataset.v9Auto='1';
    save.addEventListener('click',()=>{
      const barcode=currentBarcode(),existingValue=n(document.getElementById('estimatedValue')?.value),cached=cachedEstimate(barcode);
      if(cached&&!existingValue){setFormEstimate(cached);return}
      if(!barcode||existingValue||cached)return;
      const beforeIds=new Set();try{inv.forEach(x=>beforeIds.add(String(x.id)))}catch(_){}
      setTimeout(async()=>{
        let target=null;try{target=inv.find(x=>!beforeIds.has(String(x.id))&&String(x.barcode||'')===barcode)||inv.find(x=>String(x.barcode||'')===barcode)}catch(_){}
        if(!target)return;
        try{const est=await estimateAsync(barcode);copyEstimate(target,est);persist();render()}catch(_){}
      },650);
    },true);
  }

  function init(){
    addControls();patchCollect();patchClearAndEdit();patchRender();wireClicks();autoEstimateManualSave();decorateInventory();decorateLookupResults();
    const timer=setInterval(()=>{addControls();wireClicks();decorateInventory()},800);setTimeout(()=>clearInterval(timer),10000);
  }
  init();
})();
