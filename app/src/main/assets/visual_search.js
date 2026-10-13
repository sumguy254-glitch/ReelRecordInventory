(function(){
  if(window.__reelRecordVisualSearchV5)return;
  window.__reelRecordVisualSearchV5=true;

  const API_SETTINGS_KEY='reel_record_movie_api_settings_v1';
  const noise=/^(dvd|blu[\s-]?ray|4k|ultra hd|uhd|hd dvd|digital|digital copy|disc|disc \d+|rated|rating|region|widescreen|fullscreen|dolby|dts|closed captioned|subtitles?|special features?|bonus features?|copyright|©|warner|universal|paramount|sony|mgm|lionsgate|20th century|twentieth century|netflix|hbo|showtime)$/i;

  function addVisualUi(){
    try{
      const row=document.getElementById('start')?.parentElement;
      if(row&&!document.getElementById('visualSearch')){
        const b=document.createElement('button');
        b.id='visualSearch';
        b.className='secondary';
        b.textContent='Visual Search';
        b.title='Take or choose a photo of a movie or TV cover';
        row.appendChild(b);
        b.onclick=startVisualSearch;
      }
      const scanStatus=document.getElementById('scanStatus');
      if(scanStatus&&!document.getElementById('visualSearchHint')){
        const hint=document.createElement('div');
        hint.id='visualSearchHint';
        hint.className='muted';
        hint.style.marginTop='5px';
        hint.textContent='Visual Search can identify a cover from a photo using on-device barcode + text recognition.';
        scanStatus.insertAdjacentElement('afterend',hint);
      }
    }catch(_){}
  }

  function readSettings(){try{return JSON.parse(localStorage.getItem(API_SETTINGS_KEY)||'{}')}catch(_){return{}}}
  function parseYear(v=''){const m=String(v||'').match(/(?:19|20)\d{2}/);return m?parseInt(m[0],10):0}
  function normalize(v=''){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
  function extractSeason(raw=''){
    const s=String(raw||'').toLowerCase();
    let m=s.match(/\bseason\s*0?(\d{1,2})\b/);if(m)return parseInt(m[1],10);
    m=s.match(/\bs\s*0?(\d{1,2})\b/);if(m)return parseInt(m[1],10);
    const words={first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
    m=s.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|one|two|three|four|five|six|seven|eight|nine|ten)\s+season\b/);
    return m?(words[m[1]]||0):0;
  }
  function detectFormat(raw=''){
    const s=String(raw||'').toLowerCase();
    if(/\bhd\s*dvd\b/.test(s))return'HD DVD';
    if(/\b4k\b|ultra\s*hd|\buhd\b/.test(s))return'4K UHD';
    if(/blu[\s-]?ray/.test(s))return'Blu-ray';
    if(/\bdvd\b/.test(s))return'DVD';
    if(/\bvhs\b/.test(s))return'VHS';
    return'';
  }
  function looksTv(raw=''){return /\bseason\b|\bcomplete series\b|\btv series\b|\btelevision\b/i.test(String(raw||''))}
  function jsonp(url,callbackParam='callback',timeoutMs=10000){
    return new Promise((resolve,reject)=>{
      const cb='__rrVs_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2),script=document.createElement('script');
      let done=false;
      const cleanup=()=>{try{delete window[cb]}catch(_){window[cb]=undefined}script.remove()};
      const timer=setTimeout(()=>{if(done)return;done=true;cleanup();reject(new Error('Lookup timed out'))},timeoutMs);
      window[cb]=data=>{if(done)return;done=true;clearTimeout(timer);cleanup();resolve(data)};
      script.onerror=()=>{if(done)return;done=true;clearTimeout(timer);cleanup();reject(new Error('Lookup failed'))};
      script.src=url+(url.includes('?')?'&':'?')+encodeURIComponent(callbackParam)+'='+encodeURIComponent(cb);
      document.head.appendChild(script);
    });
  }

  function startVisualSearch(){
    if(!(window.AndroidBridge&&typeof AndroidBridge.startVisualSearch==='function')){
      return status('Visual Search is available in the Android app build.','err');
    }
    status('Choose Take Photo or an existing cover image…');
    AndroidBridge.startVisualSearch();
  }

  function cleanLine(line=''){
    return String(line).replace(/[|•©®™]+/g,' ').replace(/\s+/g,' ').trim();
  }
  function lineScore(line,index){
    const s=cleanLine(line),letters=(s.match(/[A-Za-z]/g)||[]).length;
    if(s.length<2||s.length>70||letters<2||noise.test(s)||/^\d[\d\s:.-]*$/.test(s))return-999;
    let score=35-Math.min(index,15);
    if(s.length>=4&&s.length<=35)score+=18;
    if(s.length>50)score-=15;
    if(/\bseason\b|\bcomplete series\b/i.test(s))score+=12;
    if(/\b(dvd|blu[\s-]?ray|4k|uhd|disc|digital|rated|episodes?|features?)\b/i.test(s))score-=18;
    const upper=(s.match(/[A-Z]/g)||[]).length;
    if(letters>=4&&upper/letters>.65)score+=10;
    if(/^[A-Z0-9][A-Za-z0-9'&:!?. -]+$/.test(s))score+=4;
    return score;
  }
  function titleCandidates(text=''){
    const raw=String(text||'').split(/\r?\n/).map(cleanLine).filter(Boolean);
    const candidates=[];
    raw.forEach((line,i)=>{
      const score=lineScore(line,i);
      if(score>-100)candidates.push({q:line,score});
      if(i<raw.length-1){
        const next=raw[i+1],joined=cleanLine(line+' '+next);
        if(line.length<=32&&next.length<=32&&joined.length<=58){
          const js=Math.max(lineScore(line,i),lineScore(next,i+1))+6;
          if(js>-100)candidates.push({q:joined,score:js});
        }
      }
    });
    const seen=new Set();
    return candidates.sort((a,b)=>b.score-a.score).filter(x=>{
      const k=normalize(x.q);if(k.length<2||seen.has(k))return false;seen.add(k);return true;
    }).slice(0,5);
  }
  function similarity(a,b){
    const aa=normalize(a),bb=normalize(b);
    if(!aa||!bb)return 0;
    if(aa===bb)return 100;
    if(aa.includes(bb)||bb.includes(aa))return 65;
    const as=new Set(aa.split(' ')),bs=new Set(bb.split(' '));
    let common=0;as.forEach(x=>{if(bs.has(x))common++});
    return Math.round(60*common/Math.max(as.size,bs.size,1));
  }

  async function tmdbSearch(query,key,seasonHint,yearHint,tvHint){
    const movieUrl='https://api.themoviedb.org/3/search/movie?api_key='+encodeURIComponent(key)+'&include_adult=false&language=en-US&query='+encodeURIComponent(query);
    const tvUrl='https://api.themoviedb.org/3/search/tv?api_key='+encodeURIComponent(key)+'&include_adult=false&language=en-US&query='+encodeURIComponent(query);
    const [mr,tr]=await Promise.allSettled([jsonp(movieUrl),jsonp(tvUrl)]);
    const found=[];
    if(mr.status==='fulfilled'){
      (mr.value?.results||[]).slice(0,4).forEach((x,i)=>{
        const y=parseYear(x.release_date||'');
        let score=similarity(query,x.title||x.original_title||'')+Math.max(0,18-i*3);
        if(yearHint&&y===yearHint)score+=20;
        if(tvHint)score-=15;
        found.push({media:'movie',id:x.id,title:x.title||x.original_title||query,year:y,poster:x.poster_path||'',overview:x.overview||'',score});
      });
    }
    if(tr.status==='fulfilled'){
      (tr.value?.results||[]).slice(0,4).forEach((x,i)=>{
        const y=parseYear(x.first_air_date||'');
        let score=similarity(query,x.name||x.original_name||'')+Math.max(0,18-i*3);
        if(yearHint&&y===yearHint)score+=12;
        if(tvHint||seasonHint)score+=24;
        found.push({media:'tv',id:x.id,title:x.name||x.original_name||query,year:y,poster:x.poster_path||'',overview:x.overview||'',score,season:seasonHint||0});
      });
    }
    return found;
  }

  async function tmdbDetails(hit,key,format){
    if(hit.media==='movie'){
      const d=await jsonp('https://api.themoviedb.org/3/movie/'+hit.id+'?api_key='+encodeURIComponent(key)+'&language=en-US&append_to_response=credits');
      const director=(d?.credits?.crew||[]).filter(x=>x?.job==='Director').map(x=>x.name).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(', ');
      const genres=(d?.genres||[]).map(x=>x?.name).filter(Boolean).join(',');
      let detail=(d?.overview||hit.overview||'').trim();if(detail.length>260)detail=detail.slice(0,257)+'...';if(d?.runtime)detail+=(detail?' • ':'')+d.runtime+' min';
      return{source:'Visual Search → TMDb',type:'Movie',title:d?.title||hit.title,creator:director,year:String(parseYear(d?.release_date||'')||hit.year||''),genre:genres,coverUrl:d?.poster_path?'https://image.tmdb.org/t/p/w500'+d.poster_path:(hit.poster?'https://image.tmdb.org/t/p/w500'+hit.poster:''),format,detail};
    }
    const series=await jsonp('https://api.themoviedb.org/3/tv/'+hit.id+'?api_key='+encodeURIComponent(key)+'&language=en-US');
    const n=hit.season||0;
    let sd=null;
    if(n){try{sd=await jsonp('https://api.themoviedb.org/3/tv/'+hit.id+'/season/'+n+'?api_key='+encodeURIComponent(key)+'&language=en-US')}catch(_){}}
    const genres=(series?.genres||[]).map(x=>x?.name).filter(Boolean).join(',');
    const creators=(series?.created_by||[]).map(x=>x?.name).filter(Boolean).join(', ');
    const ep=Array.isArray(sd?.episodes)?sd.episodes.length:0;
    let detail=(sd?.overview||series?.overview||hit.overview||'').trim();if(detail.length>240)detail=detail.slice(0,237)+'...';if(ep)detail+=(detail?' • ':'')+ep+' episodes';
    const y=parseYear(sd?.air_date||series?.first_air_date||'')||hit.year||0;
    return{source:'Visual Search → TMDb TV',type:'TV Season',title:n?(series?.name||hit.title)+' — Season '+n:(series?.name||hit.title),creator:creators,year:y?String(y):'',genre:genres,coverUrl:sd?.poster_path?'https://image.tmdb.org/t/p/w500'+sd.poster_path:(series?.poster_path?'https://image.tmdb.org/t/p/w500'+series.poster_path:(hit.poster?'https://image.tmdb.org/t/p/w500'+hit.poster:'')),format,detail,season:n?String(n):''};
  }

  async function omdbFallback(candidates,key,seasonHint,format){
    if(!key||!candidates.length)return[];
    for(const c of candidates.slice(0,3)){
      try{
        const search=await jsonp('https://www.omdbapi.com/?apikey='+encodeURIComponent(key)+'&s='+encodeURIComponent(c.q)+'&r=json');
        if(String(search?.Response).toLowerCase()!=='true'||!Array.isArray(search?.Search))continue;
        const rows=[];
        for(const x of search.Search.slice(0,4)){
          const detail=await jsonp('https://www.omdbapi.com/?apikey='+encodeURIComponent(key)+'&i='+encodeURIComponent(x.imdbID)+'&plot=short&r=json');
          if(String(detail?.Response).toLowerCase()!=='true')continue;
          const isTv=detail.Type==='series'||!!seasonHint;
          rows.push({source:'Visual Search → OMDb',type:isTv?'TV Season':'Movie',title:isTv&&seasonHint?(detail.Title+' — Season '+seasonHint):detail.Title,creator:isTv?(detail.Writer&&detail.Writer!=='N/A'?detail.Writer:''):(detail.Director&&detail.Director!=='N/A'?detail.Director:''),year:String(parseYear(detail.Year)||''),genre:detail.Genre&&detail.Genre!=='N/A'?detail.Genre:'',coverUrl:detail.Poster&&detail.Poster!=='N/A'?detail.Poster:'',format,detail:detail.Plot&&detail.Plot!=='N/A'?detail.Plot:'',season:seasonHint?String(seasonHint):'',score:similarity(c.q,detail.Title||'')});
        }
        if(rows.length)return rows;
      }catch(_){}
    }
    return[];
  }

  function showResults(results,recognized){
    e.modal.classList.remove('hidden');
    e.results.innerHTML='';
    e.lookupMsg.textContent='Visual Search found '+results.length+' likely match'+(results.length===1?'':'es')+'. Choose the correct cover.';
    results.forEach((x,i)=>{
      const d=document.createElement('div');d.className='result';
      d.innerHTML=(x.coverUrl?`<img src="${esc(x.coverUrl)}" onerror="this.style.visibility='hidden'">`:'<div class="cover"></div>')+`<div><div class="title">${esc(x.title||'Untitled')}</div><div class="meta">${esc([x.type,x.format,x.creator,x.year,x.genre,x.detail,x.source].filter(Boolean).join(' • '))}</div></div><button data-vpick="${i}">Use</button>`;
      e.results.appendChild(d);
    });
    e.results.onclick=ev=>{
      if(ev.target.dataset.vpick===undefined)return;
      const x=results[+ev.target.dataset.vpick];
      for(const k of['type','title','creator','year','genre','coverUrl','format'])if(x[k]!==undefined&&x[k]!==null&&String(x[k]).length)e[k].value=x[k];
      if(x.type==='TV Season'&&document.getElementById('seasonNumber'))document.getElementById('seasonNumber').value=x.season||extractSeason(x.title)||'';
      if(e.type)e.type.dispatchEvent(new Event('change'));
      e.modal.classList.add('hidden');
      status('Visual match loaded from '+x.source+'. Review it, then save.','ok');
    };
  }

  async function searchRecognizedText(text){
    const candidates=titleCandidates(text);
    if(!candidates.length)return status('I could read the image, but could not isolate a likely movie/TV title. Try a straighter, closer cover photo.','err');
    const format=detectFormat(text),season=extractSeason(text),year=parseYear(text),tvHint=looksTv(text)||!!season;
    const settings=readSettings();

    if(!(settings.tmdb||settings.omdb)){
      e.title.value=candidates[0].q;
      if(format)e.format.value=format;
      if(tvHint){e.type.value='TV Season';if(document.getElementById('seasonNumber')&&season)document.getElementById('seasonNumber').value=season;e.type.dispatchEvent(new Event('change'))}
      status('Cover text recognized as “'+candidates[0].q+'”. Add a TMDb or OMDb key in Movie & TV API Settings to finish visual matching.','err');
      document.getElementById('movieApiSettingsBtn')?.click();
      return;
    }

    e.modal.classList.remove('hidden');e.results.innerHTML='';e.lookupMsg.textContent='Visual Search: matching recognized cover text against movie and TV databases…';
    let hits=[];
    if(settings.tmdb){
      const batches=await Promise.allSettled(candidates.slice(0,4).map(c=>tmdbSearch(c.q,settings.tmdb,season,year,tvHint)));
      batches.forEach(b=>{if(b.status==='fulfilled')hits.push(...b.value)});
      const seen=new Set();
      hits=hits.sort((a,b)=>b.score-a.score).filter(h=>{const k=h.media+':'+h.id;if(seen.has(k))return false;seen.add(k);return true}).slice(0,6);
      const detailed=await Promise.allSettled(hits.map(h=>tmdbDetails(h,settings.tmdb,format)));
      const results=detailed.filter(x=>x.status==='fulfilled'&&x.value).map(x=>x.value);
      if(results.length)return showResults(results,text);
    }
    const omdb=await omdbFallback(candidates,settings.omdb,season,format);
    if(omdb.length)return showResults(omdb,text);

    e.modal.classList.add('hidden');
    e.title.value=candidates[0].q;if(format)e.format.value=format;
    status('No database match was confident enough. I filled the best recognized title so you can edit or use Enrich Title.','err');
  }

  window.onVisualSearchNativeResult=async function(raw){
    let data;try{data=typeof raw==='string'?JSON.parse(raw):raw}catch(_){data={error:'Invalid visual-search result.'}}
    if(data?.error&&!(data?.text||'').trim()&&!(data?.barcodes||[]).length)return status(data.error,'err');
    const barcodes=(data?.barcodes||[]).map(x=>String(x).replace(/\D/g,'')).filter(x=>x.length>=8);
    if(barcodes.length){
      const preferred=barcodes.find(x=>x.length===12||x.length===13)||barcodes[0];
      e.barcode.value=preferred;
      status('Visual Search found barcode '+preferred+'. Running the normal UPC lookup…','ok');
      return window.lookup?window.lookup(preferred):lookup(preferred);
    }
    const text=(data?.text||'').trim();
    if(!text)return status('No barcode or readable cover text was found. Try a closer photo with less glare.','err');
    status('Cover text recognized. Searching movie and TV databases…');
    try{await searchRecognizedText(text)}catch(err){status('Visual Search failed: '+(err?.message||err),'err')}
  };

  addVisualUi();
})();