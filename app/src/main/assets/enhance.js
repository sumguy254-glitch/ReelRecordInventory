(function(){
  if (window.__reelRecordEnhancedLookup) return;
  window.__reelRecordEnhancedLookup = true;

  try {
    const formatSelect = document.getElementById('format');
    if (formatSelect && !Array.from(formatSelect.options).some(o => o.value === 'HD DVD' || o.textContent === 'HD DVD')) {
      const option = document.createElement('option');
      option.textContent = 'HD DVD';
      option.value = 'HD DVD';
      const dvd = Array.from(formatSelect.options).find(o => o.value === 'DVD' || o.textContent === 'DVD');
      formatSelect.insertBefore(option, dvd || null);
    }
    const hint = document.querySelector('.hint');
    if (hint) hint.textContent = 'Movie lookup checks My-UPC / DigitalUPC first, then upc.dev and UPCitemdb. Music also checks MusicBrainz. If no source knows the exact release, you can still enter it manually.';
  } catch (_) {}

  const addUnique = (list, seen, item) => {
    if (!item || !item.title) return;
    const key = [item.source || '', item.title || '', item.format || '', item.year || ''].join('|').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(item);
  };

  const enhancedLookup = async function(arg) {
    let c = norm(arg || e.barcode.value);
    if (!c) return status('Scan or enter a barcode first.', 'err');
    e.barcode.value = c;
    e.modal.classList.remove('hidden');
    e.results.innerHTML = '';
    e.lookupMsg.textContent = 'Searching My-UPC / DigitalUPC, upc.dev, UPCitemdb and MusicBrainz…';

    const r = [];
    const seen = new Set();

    try {
      if (window.AndroidBridge && typeof AndroidBridge.lookupExtraSources === 'function') {
        const raw = AndroidBridge.lookupExtraSources(c);
        const extras = JSON.parse(raw || '[]');
        if (Array.isArray(extras)) extras.forEach(x => addUnique(r, seen, x));
      }
    } catch (_) {}

    try {
      const z = await fetch('https://api.upcitemdb.com/prod/trial/lookup?upc=' + encodeURIComponent(c));
      if (z.ok) {
        const j = await z.json();
        for (const it of j.items || []) {
          addUnique(r, seen, {
            source: 'UPCitemdb',
            type: /vinyl|album|cd|music|record/i.test((it.category || '') + ' ' + (it.title || '')) ? 'Music' : 'Movie',
            title: it.title || '',
            creator: it.brand || '',
            year: '',
            genre: it.category || '',
            coverUrl: (it.images || [])[0] || '',
            format: guess((it.title || '') + ' ' + (it.description || '')),
            detail: it.description || ''
          });
        }
      }
    } catch (_) {}

    try {
      const z = await fetch('https://musicbrainz.org/ws/2/release/?query=' + encodeURIComponent('barcode:' + c) + '&fmt=json&limit=6');
      if (z.ok) {
        const j = await z.json();
        for (const rel of j.releases || []) {
          addUnique(r, seen, {
            source: 'MusicBrainz',
            type: 'Music',
            title: rel.title || '',
            creator: (rel['artist-credit'] || []).map(a => a.name || (a.artist && a.artist.name)).filter(Boolean).join(', '),
            year: (rel.date || '').slice(0, 4),
            genre: '',
            coverUrl: rel.id ? 'https://coverartarchive.org/release/' + rel.id + '/front-250' : '',
            format: '',
            detail: [rel.country, rel.status].filter(Boolean).join(' • ')
          });
        }
      }
    } catch (_) {}

    if (!r.length) {
      e.lookupMsg.textContent = 'No automatic match found in any connected barcode source. You can enter the release details manually.';
      return;
    }

    e.lookupMsg.textContent = 'Found ' + r.length + ' match' + (r.length === 1 ? '' : 'es') + '. Movie-specific results are shown first.';
    r.forEach((x, i) => {
      const d = document.createElement('div');
      d.className = 'result';
      d.innerHTML = (x.coverUrl ? `<img src="${esc(x.coverUrl)}" onerror="this.style.visibility='hidden'">` : '<div class="cover"></div>') +
        `<div><div class="title">${esc(x.title || 'Untitled')}</div><div class="meta">${esc([x.type, x.format, x.creator, x.year, x.detail, x.source].filter(Boolean).join(' • '))}</div></div><button data-pick="${i}">Use</button>`;
      e.results.appendChild(d);
    });

    e.results.onclick = ev => {
      if (ev.target.dataset.pick === undefined) return;
      const x = r[+ev.target.dataset.pick];
      for (const k of ['type', 'title', 'creator', 'year', 'genre', 'coverUrl', 'format']) if (x[k]) e[k].value = x[k];
      e.modal.classList.add('hidden');
      status('Metadata loaded from ' + x.source + '. Review it, then save.', 'ok');
    };
  };

  window.lookup = enhancedLookup;
  try { lookup = enhancedLookup; } catch (_) {}
})();
