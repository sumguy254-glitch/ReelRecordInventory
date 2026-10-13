(function bootBooks(attempt){
  if(window.__mediaDexBooksV11)return;
  if(typeof window.lookup!=='function'||!document.getElementById('type')||!document.getElementById('results')){
    if((attempt||0)<30)setTimeout(()=>bootBooks((attempt||0)+1),200);
    return;
  }
  window.__mediaDexBooksV11=true;

  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  const pendingBooks=new Map();
  const pendingEstimates=new Map();
  const previousEstimateHandler=window.onRrEstimateResult;
  const oldLookup=window.lookup;

  function qty(x){const n=parseInt(x?.quantity||1,10);return Number.isFinite(n)&&n>0?n:1}
  function val(x){const n=Number(x?.estimatedValue||0);return Number.isFinite(n)&&n>0?n:0}
  function digits(v){return String(v||'').replace(/\D/g,'')}
  function isIsbn(v){const c=String(v||'').replace(/[^0-9Xx]/g,'').toUpperCase();return c.length===10||(c.length===13&&(c.startsWith('978')||c.startsWith('979')))}
  function escHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

  function addBookOptions(){
    const type=document.getElementById('type');
    if(type&&!Array.from(type.options).some(o=>o.value==='Book')){
      const opt=document.createElement('option');opt.value='Book';opt.textContent='Book';type.appendChild(opt);
    }
    const filter=document.getElementById('filter');
    if(filter&&!Array.from(filter.options).some(o=>o.value==='Book')){
      const opt=document.createElement('option');opt.value='Book';opt.textContent='Book';filter.appendChild(opt);
    }
    const format=document.getElementById('format');
    if(format){
      ['Hardcover','Paperback','Mass Market Paperback','Trade Paperback','Board Book','Audiobook','eBook'].forEach(name=>{
        if(!Array.from(format.options).some(o=>o.value===name||o.textContent===name)){
          const opt=document.createElement('option');opt.value=name;opt.textContent=name;format.appendChild(opt);
        }
      });
    }
  }

  function updateLabels(){
    const type=document.getElementById('type');
    const creator=document.getElementById('creator');
    const title=document.getElementById('title');
    const label=creator?.previousElementSibling;
    if(type?.value==='Book'){
      if(label)label.textContent='Author';
      if(title)title.placeholder='Book title';
    }else{
      if(label)label.textContent='Artist / Director';
      if(title)title.placeholder='Movie or album title';
    }
  }

  function addBookStats(){
    if(!document.getElementById('sBooks')){
      const stats=document.querySelector('.stats');
      if(stats){const pill=document.createElement('span');pill.id='sBooks';pill.className='pill';pill.textContent='0 books';stats.appendChild(pill)}
    }
    const summary=document.getElementById('rrValueSummary');
    if(summary&&!document.getElementById('rrBookValue')){
      const card=document.createElement('div');card.className='rr-value-card';
      card.innerHTML='<div class="rr-label">Books</div><div id="rrBookValue" class="rr-amount">$0.00</div>';
      summary.insertBefore(card,summary.lastElementChild);
      if(!document.getElementById('rrBookStyles')){
        const s=document.createElement('style');s.id='rrBookStyles';
        s.textContent='#rrValueSummary{grid-template-columns:repeat(5,1fr)}@media(max-width:650px){#rrValueSummary{grid-template-columns:1fr 1fr}}';
        document.head.appendChild(s);
      }
    }
  }

  function refreshBookStats(){
    let books=0,totalCount=0,bookValue=0,movieValue=0,totalValue=0;
    try{
      for(const x of inv){
        const q=qty(x),v=val(x)*q;totalCount+=q;totalValue+=v;
        if(x.type==='Book'){books+=q;bookValue+=v}
        if(x.type==='Movie')movieValue+=v;
      }
    }catch(_){}
    const sb=document.getElementById('sBooks');if(sb)sb.textContent=books+' book'+(books===1?'':'s');
    const st=document.getElementById('sTotal');if(st)st.textContent=totalCount+' items';
    const bv=document.getElementById('rrBookValue');if(bv)bv.textContent=money.format(bookValue);
    const mv=document.getElementById('rrMovieValue');if(mv)mv.textContent=money.format(movieValue);
    const tv=document.getElementById('rrTotalValue');if(tv)tv.textContent=money.format(totalValue);
    const pill=document.getElementById('sValue');if(pill)pill.textContent='Est. '+money.format(totalValue);
  }

  function wrapRender(){
    try{
      if(typeof render==='function'&&!window.__mediaDexBookRenderV11){
        window.__mediaDexBookRenderV11=true;
        const prior=render;
        const next=function(){prior();addBookStats();refreshBookStats()};
        render=next;window.render=next;
      }
    }catch(_){}
  }

  window.onMediaDexBookResult=function(requestId,raw){
    const p=pendingBooks.get(String(requestId||''));if(!p)return;
    pendingBooks.delete(String(requestId||''));clearTimeout(p.timer);
    let data={};try{data=typeof raw==='string'?JSON.parse(raw||'{}'):(raw||{})}catch(_){}
    if(data.error)p.reject(new Error(data.error));else p.resolve(data);
  };

  window.onRrEstimateResult=function(requestId,raw){
    const p=pendingEstimates.get(String(requestId||''));
    if(p){
      pendingEstimates.delete(String(requestId||''));clearTimeout(p.timer);
      let data={};try{data=typeof raw==='string'?JSON.parse(raw||'{}'):(raw||{})}catch(_){}
      if(data.error)p.reject(new Error(data.error));else p.resolve(data);
      return;
    }
    if(typeof previousEstimateHandler==='function')previousEstimateHandler(requestId,raw);
  };

  function lookupBook(code){
    return new Promise((resolve,reject)=>{
      if(!(window.BookBridge&&typeof BookBridge.lookupBookAsync==='function'))return reject(new Error('Book lookup bridge is unavailable.'));
      const id='book_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
      const timer=setTimeout(()=>{pendingBooks.delete(id);reject(new Error('Book lookup timed out.'))},12000);
      pendingBooks.set(id,{resolve,reject,timer});BookBridge.lookupBookAsync(id,String(code||''));
    });
  }

  function estimateBook(code){
    return new Promise((resolve,reject)=>{
      if(!(window.AndroidBridge&&typeof AndroidBridge.estimateValueAsync==='function'))return resolve(null);
      try{
        if(typeof AndroidBridge.getCachedEstimate==='function'){
          const raw=AndroidBridge.getCachedEstimate(String(code||''));
          const c=raw?JSON.parse(raw):{};if(Number(c.estimatedValue||0)>0)return resolve(c);
        }
      }catch(_){}
      const id='bookval_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
      const timer=setTimeout(()=>{pendingEstimates.delete(id);resolve(null)},14000);
      pendingEstimates.set(id,{resolve,reject,timer});AndroidBridge.estimateValueAsync(id,String(code||''));
    });
  }

  function applyBook(book,code){
    const fields={type:'Book',title:book.title||'',creator:book.creator||'',year:book.year||'',genre:book.genre||'',coverUrl:book.coverUrl||'',format:book.format||''};
    Object.entries(fields).forEach(([k,v])=>{const el=document.getElementById(k);if(el&&v!==undefined&&v!==null&&String(v)!=='')el.value=v});
    const b=document.getElementById('barcode');if(b)b.value=digits(code);
    updateLabels();
  }

  async function applyEstimateToForm(code){
    try{
      const est=await estimateBook(code);const amount=Number(est?.estimatedValue||0);
      const input=document.getElementById('estimatedValue');
      if(input&&amount>0&&!input.value)input.value=amount.toFixed(2);
      return est;
    }catch(_){return null}
  }

  function renderBookResult(book,code){
    const modal=document.getElementById('modal'),results=document.getElementById('results'),msg=document.getElementById('lookupMsg');
    if(!modal||!results)return;
    modal.classList.remove('hidden');results.innerHTML='';
    if(msg)msg.textContent='Book found by ISBN. Choose how you want to add it.';
    const row=document.createElement('div');row.className='result';
    const cover=book.coverUrl?`<img src="${escHtml(book.coverUrl)}" onerror="this.style.visibility='hidden'">`:'<div class="cover"></div>';
    row.innerHTML=cover+`<div><div class="title">${escHtml(book.title||'Untitled')}</div><div class="meta">${escHtml(['Book',book.format,book.creator,book.year,book.genre,book.detail,'Open Library'].filter(Boolean).join(' • '))}</div></div><div style="display:grid;gap:6px"><button data-book-use="1">Use</button><button class="secondary" data-book-add="1">Use & Add</button></div>`;
    results.appendChild(row);
    row.querySelector('[data-book-use]').onclick=async ev=>{
      ev.preventDefault();applyBook(book,code);modal.classList.add('hidden');
      const formStatus=document.getElementById('formStatus');if(formStatus){formStatus.className='status ok';formStatus.textContent='Book metadata loaded from Open Library. Checking market value…'}
      await applyEstimateToForm(code);
      if(formStatus){formStatus.className='status ok';formStatus.textContent='Book metadata loaded. Review it, then save.'}
    };
    row.querySelector('[data-book-add]').onclick=async ev=>{
      ev.preventDefault();const btn=ev.currentTarget;btn.disabled=true;btn.textContent='Estimating…';applyBook(book,code);
      await applyEstimateToForm(code);modal.classList.add('hidden');
      const save=document.getElementById('save');if(save)save.click();
      const ss=document.getElementById('scanStatus');if(ss)ss.textContent='Added '+(book.title||'book')+'. Camera active — scan the next barcode.';
      btn.disabled=false;btn.textContent='Use & Add';
    };
  }

  async function bookAwareLookup(arg){
    const input=document.getElementById('barcode');const raw=arg||input?.value||'';const code=String(raw).replace(/[^0-9Xx]/g,'').toUpperCase();
    if(!isIsbn(code))return oldLookup(arg);
    if(input)input.value=digits(code);
    const modal=document.getElementById('modal'),results=document.getElementById('results'),msg=document.getElementById('lookupMsg');
    if(modal)modal.classList.remove('hidden');if(results)results.innerHTML='';if(msg)msg.textContent='Looking up ISBN in Open Library…';
    try{
      const book=await lookupBook(code);if(book?.title){renderBookResult(book,code);return}
    }catch(_){}
    if(msg)msg.textContent='No Open Library ISBN match. Trying the regular UPC/EAN sources…';
    return oldLookup(arg);
  }

  function forceBookTypeForBooklandFallback(){
    const results=document.getElementById('results');if(!results)return;
    results.addEventListener('click',ev=>{
      const btn=ev.target.closest?.('button[data-pick],button[data-vpick]');if(!btn)return;
      const code=digits(document.getElementById('barcode')?.value||'');
      if(code.length===13&&(code.startsWith('978')||code.startsWith('979'))){
        setTimeout(()=>{const t=document.getElementById('type');if(t)t.value='Book';updateLabels()},0);
      }
    },true);
  }

  addBookOptions();addBookStats();wrapRender();updateLabels();forceBookTypeForBooklandFallback();
  document.getElementById('type')?.addEventListener('change',updateLabels);
  const sub=document.querySelector('header .sub');if(sub)sub.textContent='Scan movies, TV seasons, music, and books and keep your collection on your phone.';
  window.lookup=bookAwareLookup;try{lookup=bookAwareLookup}catch(_){}
  try{window.render?.()}catch(_){refreshBookStats()}
})(0);
