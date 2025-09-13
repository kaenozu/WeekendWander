// Where For Weekend - simple client-only app using Overpass API (OSM)
// No API keys. Routes open in Google Maps.

const els = {
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  metric: document.getElementById('metric'),
  distance: document.getElementById('distance'),
  distanceUnit: document.getElementById('distanceUnit'),
  time: document.getElementById('time'),
  mode: document.getElementById('mode'),
  distanceLabel: document.getElementById('distance-label'),
  timeLabel: document.getElementById('time-label'),
  modeLabel: document.getElementById('mode-label'),
  sortLabel: document.getElementById('sortLabel'),
  catGourmet: document.getElementById('cat-gourmet'),
  catSight: document.getElementById('cat-sightseeing'),
  searchBtn: document.getElementById('searchBtn'),
  map: document.getElementById('map'),
  sortBy: document.getElementById('sortBy'),
  sortDir: document.getElementById('sortDir'),
  bboxMode: document.getElementById('bboxMode'),
  // detail filters
  dCafe: document.getElementById('detail-cafe'),
  dRamen: document.getElementById('detail-restaurant-ramen'),
  dSushi: document.getElementById('detail-restaurant-sushi'),
  dFast: document.getElementById('detail-fast_food'),
  dBar: document.getElementById('detail-bar'),
  dPub: document.getElementById('detail-pub'),
  dBakery: document.getElementById('detail-bakery'),
  dPark: document.getElementById('detail-park'),
  dGarden: document.getElementById('detail-garden'),
  dMuseum: document.getElementById('detail-museum'),
  dGallery: document.getElementById('detail-gallery'),
  dViewpoint: document.getElementById('detail-viewpoint'),
  dAttraction: document.getElementById('detail-attraction'),
  dTheme: document.getElementById('detail-theme_park'),
  dZoo: document.getElementById('detail-zoo'),
  dAquarium: document.getElementById('detail-aquarium'),
  dHistoric: document.getElementById('detail-historic'),
  dTemple: document.getElementById('detail-temple'),
  dShrine: document.getElementById('detail-shrine'),
  dChurch: document.getElementById('detail-church'),
  favOnly: document.getElementById('favOnly'),
  pagination: document.getElementById('pagination')
};

let currentPosition = null;
let map, markersLayer, userMarker;
const markersById = new Map();
let allItems = [];
let pageSize = 20;
let currentPage = 1;
let lastSearchState = null;

// Average speeds (m/min) for rough time filtering without paid routing APIs
const SPEEDS = {
  walking: 83.3, // ~5 km/h
  driving: 566.7 // ~34 km/h (urban average; adjust as needed)
};

function metersToHuman(m) {
  if (m < 1000) return `${m.toFixed(0)} m`;
  return `${(m/1000).toFixed(2)} km`;
}

function minutesToHuman(min) {
  if (min < 60) return `${Math.round(min)} 分`;
  const h = Math.floor(min/60);
  const m = Math.round(min % 60);
  return `${h} 時間 ${m} 分`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const R = 6371000; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.style.color = isError ? '#ff8a8a' : '';
}

function toggleControls() {
  const metric = els.metric.value;
  const showDistance = metric === 'distance';
  els.distanceLabel.classList.toggle('hidden', !showDistance);
  els.timeLabel.classList.toggle('hidden', showDistance);
  els.modeLabel.classList.toggle('hidden', showDistance);
  els.sortLabel.textContent = showDistance ? '距離' : '推定時間';
}

els.metric.addEventListener('change', toggleControls);
toggleControls();

// Request geolocation immediately so user can permit early
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentPosition = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setStatus('現在地を取得しました。検索条件を選んで「検索する」を押してください。');
      ensureMap();
      updateUserMarker();
    },
    (err) => {
      console.warn(err);
      setStatus('位置情報の取得に失敗しました。ブラウザの設定をご確認ください。', true);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
} else {
  setStatus('お使いのブラウザは位置情報をサポートしていません。', true);
}

function ensureMap() {
  if (map) return map;
  map = L.map(els.map, { zoomControl: true, attributionControl: true });
  const tile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  });
  tile.addTo(map);
  markersLayer = L.markerClusterGroup({ showCoverageOnHover:false, maxClusterRadius:40 });
  markersLayer.addTo(map);
  // Initial view
  if (currentPosition) {
    map.setView([currentPosition.lat, currentPosition.lon], 14);
  } else {
    map.setView([35.681236, 139.767125], 12); // Tokyo Station default
  }
  return map;
}

function updateUserMarker() {
  if (!map || !currentPosition) return;
  if (userMarker) userMarker.remove();
  userMarker = L.circleMarker([currentPosition.lat, currentPosition.lon], {
    radius: 8,
    color: '#7db3ff',
    weight: 2,
    fillColor: '#66e5a6',
    fillOpacity: 0.6
  }).addTo(map).bindTooltip('現在地');
}

function buildOverpassQuery({ lat, lon, radius, includeGourmet, includeSight, bbox }) {
  // Build using detail filters when any is selected; otherwise use broad categories
  const parts = [];

  const detailsSelected = [
    els.dCafe, els.dRamen, els.dSushi, els.dFast, els.dBar, els.dPub, els.dBakery,
    els.dPark, els.dGarden, els.dMuseum, els.dGallery, els.dViewpoint, els.dAttraction,
    els.dTheme, els.dZoo, els.dAquarium, els.dHistoric, els.dTemple, els.dShrine, els.dChurch
  ].some(cb => cb && cb.checked);

  const area = bbox
    ? `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`
    : `(around:${radius},${lat},${lon})`;

  if (detailsSelected) {
    // Gourmet details
    if (els.dCafe?.checked) parts.push(`node["amenity"="cafe"]${area};`);
    if (els.dRamen?.checked) parts.push(`node["amenity"="restaurant"]["cuisine"~"ramen",i]${area};`);
    if (els.dSushi?.checked) parts.push(`node["amenity"="restaurant"]["cuisine"~"sushi",i]${area};`);
    if (els.dFast?.checked) parts.push(`node["amenity"="fast_food"]${area};`);
    if (els.dBar?.checked) parts.push(`node["amenity"="bar"]${area};`);
    if (els.dPub?.checked) parts.push(`node["amenity"="pub"]${area};`);
    if (els.dBakery?.checked) parts.push(`node["shop"="bakery"]${area};`);

    // Sightseeing details
    if (els.dPark?.checked) parts.push(`node["leisure"="park"]${area};`);
    if (els.dGarden?.checked) parts.push(`node["leisure"="garden"]${area};`);
    if (els.dMuseum?.checked) parts.push(`node["tourism"="museum"]${area};`);
    if (els.dGallery?.checked) parts.push(`node["tourism"="gallery"]${area};`);
    if (els.dViewpoint?.checked) parts.push(`node["tourism"="viewpoint"]${area};`);
    if (els.dAttraction?.checked) parts.push(`node["tourism"="attraction"]${area};`);
    if (els.dTheme?.checked) parts.push(`node["tourism"="theme_park"]${area};`);
    if (els.dZoo?.checked) parts.push(`node["tourism"="zoo"]${area};`);
    if (els.dAquarium?.checked) parts.push(`node["tourism"="aquarium"]${area};`);
    if (els.dHistoric?.checked) parts.push(`node["historic"]${area};`);
    if (els.dTemple?.checked) parts.push(`node["amenity"="place_of_worship"]["religion"="buddhist"]${area};`);
    if (els.dShrine?.checked) parts.push(`node["amenity"="place_of_worship"]["religion"="shinto"]${area};`);
    if (els.dChurch?.checked) parts.push(`node["amenity"="place_of_worship"]["religion"~"christian|catholic",i]${area};`);
  } else {
    if (includeGourmet) parts.push(`node["amenity"~"restaurant|cafe|fast_food|bar|pub"]${area};`);
    if (includeSight) {
      parts.push(
        `node["tourism"~"attraction|museum|artwork|viewpoint|gallery|theme_park|zoo|aquarium"]${area};`,
        `node["leisure"~"park|garden"]${area};`,
        `node["historic"]${area};`
      );
    }
  }

  if (parts.length === 0) return null;
  return `[
    out:json][timeout:25];(
      ${parts.join('\n')}
    );out body 120;`;
}

async function fetchPOIs(q) {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter'
  ];
  let lastErr;
  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: q })
      }, 12000);
      if (!res.ok) throw new Error(`Overpass error ${res.status}`);
      const json = await res.json();
      return json.elements || [];
    } catch (e) {
      lastErr = e;
      console.warn('Overpass endpoint failed:', url, e);
      continue;
    }
  }
  throw lastErr || new Error('All Overpass endpoints failed');
}

function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...(options||{}), signal: ctrl.signal })
    .finally(() => clearTimeout(id));
}

function safeHostname(urlStr){
  try { return new URL(urlStr).hostname; } catch { return null; }
}

function preferName(tags){
  // Prefer Japanese name, then generic, then English, then brand/operator, else null
  return (
    tags?.['name:ja'] ||
    tags?.name ||
    tags?.['name:en'] ||
    tags?.brand ||
    tags?.operator ||
    null
  );
}

function humanizeFallback(tags){
  // Fallback based on key values if no name
  if (tags?.amenity) return `${tags.amenity}`;
  if (tags?.tourism) return `${tags.tourism}`;
  if (tags?.leisure) return `${tags.leisure}`;
  if (tags?.historic) return 'historic';
  return '名称不明';
}

function normalizeElement(el) {
  const name = preferName(el.tags) || humanizeFallback(el.tags);
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const cats = [];
  if (el.tags?.amenity) cats.push(el.tags.amenity);
  if (el.tags?.tourism) cats.push(el.tags.tourism);
  if (el.tags?.leisure) cats.push(el.tags.leisure);
  if (el.tags?.historic) cats.push('historic');
  return { id: el.id, name, lat, lon, tags: el.tags || {}, cats };
}

function renderResults(items, metric) {
  els.results.innerHTML = '';
  if (!items.length) {
    els.results.innerHTML = '<li class="result"><span>該当なし</span></li>';
    return;
  }
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'result';
    const left = document.createElement('div');
    const right = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = it.name;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const metaBits = [];
    if (it.tags.cuisine) metaBits.push(`料理: ${it.tags.cuisine}`);
    if (it.tags['opening_hours']) metaBits.push(`時間: ${it.tags['opening_hours']}`);
    if (it.tags.website) {
      const host = safeHostname(it.tags.website);
      if (host) metaBits.push(`Web: ${host}`);
    }
    meta.textContent = metaBits.join(' ・ ');

    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const c of it.cats.slice(0, 3)) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = c;
      chips.appendChild(chip);
    }

    left.appendChild(title);
    left.appendChild(meta);
    const thumb = document.createElement('img');
    thumb.className = 'thumb hidden';
    thumb.id = `thumb-${it.id}`;
    left.appendChild(thumb);
    left.appendChild(chips);

    const distanceText = document.createElement('div');
    distanceText.className = 'meta';
    const eta = it.etaAccMin ?? it.etaMin;
    distanceText.textContent = metric === 'distance'
      ? metersToHuman(it.distance)
      : minutesToHuman(eta);

    const favBtn = document.createElement('button');
    favBtn.className = 'fav-btn';
    const favState = isFav(it.id);
    favBtn.classList.toggle('active', favState);
    favBtn.textContent = favState ? '★ 保存済み' : '☆ お気に入り';
    favBtn.onclick = (e) => { e.stopPropagation(); toggleFav(it); const now = isFav(it.id); favBtn.classList.toggle('active', now); favBtn.textContent = now ? '★ 保存済み' : '☆ お気に入り'; if (els.favOnly.checked && !now) { li.remove(); } };

    const openBtn = document.createElement('button');
    openBtn.className = 'open-map';
    openBtn.textContent = 'Googleマップで経路';
    openBtn.addEventListener('click', () => {
      openGoogleMapsDirections(it.lat, it.lon);
    });

    right.appendChild(distanceText);
    right.appendChild(favBtn);
    right.appendChild(openBtn);

    li.appendChild(left);
    li.appendChild(right);
    els.results.appendChild(li);

    // Click to focus marker
    li.addEventListener('click', () => { focusMarker(it); openPopupFor(it.id); });
    li.addEventListener('mouseenter', () => highlightItem(it.id, true));
    li.addEventListener('mouseleave', () => highlightItem(it.id, false));
    li.id = `poi-${it.id}`;
  }
}

function openGoogleMapsDirections(destLat, destLon) {
  const originLat = currentPosition?.lat ?? map?.getCenter()?.lat;
  const originLon = currentPosition?.lon ?? map?.getCenter()?.lng;
  if (originLat == null || originLon == null) return;
  const origin = `${originLat},${originLon}`;
  const dest = `${destLat},${destLon}`;
  const travelmode = els.metric.value === 'time' ? els.mode.value : 'walking';
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', dest);
  url.searchParams.set('travelmode', travelmode);
  window.open(url.toString(), '_blank');
}

function clearMarkers(){
  if (markersLayer) markersLayer.clearLayers();
  markersById.clear();
}

function makeMarker(item){
  const marker = L.marker([item.lat, item.lon]);
  const content = `
    <strong>${item.name}</strong><br/>
    ${metersToHuman(item.distance)} ・ ${minutesToHuman(item.etaAccMin ?? item.etaMin)}<br/>
    <button id="go-${item.id}" style="margin-top:6px">Googleマップで経路</button>
  `;
  marker.bindPopup(content);
  marker.on('popupopen', () => {
    const btn = document.getElementById(`go-${item.id}`);
    if (btn) btn.onclick = () => openGoogleMapsDirections(item.lat, item.lon);
    // highlight list item
    const li = document.getElementById(`poi-${item.id}`);
    if (li) {
      li.scrollIntoView({ behavior: 'smooth', block: 'center' });
      li.classList.add('active');
      setTimeout(()=>{ li.classList.remove('active'); }, 700);
    }
  });
  marker.on('mouseover', () => highlightItem(item.id, true));
  marker.on('mouseout', () => highlightItem(item.id, false));
  markersById.set(item.id, marker);
  return marker;
}

function updateMap(items){
  ensureMap();
  updateUserMarker();
  clearMarkers();
  const bounds = [];
  items.forEach(it => {
    const m = makeMarker(it).addTo(markersLayer);
    bounds.push([it.lat, it.lon]);
  });
  if (currentPosition) bounds.push([currentPosition.lat, currentPosition.lon]);
  if (bounds.length) {
    const b = L.latLngBounds(bounds);
    map.fitBounds(b.pad(0.2));
  }
}

function focusMarker(item){
  ensureMap();
  map.setView([item.lat, item.lon], Math.max(map.getZoom(), 16));
}

function openPopupFor(id){
  const m = markersById.get(id);
  if (m) m.openPopup();
}

function highlightItem(id, on){
  const li = document.getElementById(`poi-${id}`);
  if (li) li.classList.toggle('active', on);
  const m = markersById.get(id);
  if (m) m.setZIndexOffset(on ? 1000 : 0);
}

async function onSearch() {
  try {
    let origin = currentPosition;
    if (!origin) {
      ensureMap();
      const c = map.getCenter();
      origin = { lat: c.lat, lon: c.lng };
      setStatus('現在地が未取得のため、地図の中心を起点に検索します。');
    }

    const metric = els.metric.value; // 'distance' | 'time'
    const includeGourmet = els.catGourmet.checked;
    const includeSight = els.catSight.checked;
    if (!includeGourmet && !includeSight) {
      setStatus('少なくとも1つのカテゴリを選択してください。', true);
      return;
    }

    let radiusMeters;
    if (metric === 'distance') {
      const value = parseFloat(els.distance.value || '0');
      if (!value || value <= 0) {
        setStatus('距離の入力値が不正です。', true);
        return;
      }
      const unit = els.distanceUnit.value; // 'km' | 'm'
      radiusMeters = unit === 'km' ? value * 1000 : value;
    } else {
      const minutes = parseFloat(els.time.value || '0');
      if (!minutes || minutes <= 0) {
        setStatus('時間の入力値が不正です。', true);
        return;
      }
      const speed = SPEEDS[els.mode.value];
      radiusMeters = minutes * speed; // rough reachability radius
    }

    setStatus('スポット検索中…');
    els.results.innerHTML = '';

    const bbox = (els.bboxMode?.checked && map) ? (()=>{ const b = map.getBounds(); return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }; })() : null;
    const query = buildOverpassQuery({
      lat: currentPosition.lat,
      lon: currentPosition.lon,
      radius: Math.min(Math.max(Math.round(radiusMeters), 200), 12000), // clamp 200m-12km to be gentle
      includeGourmet,
      includeSight,
      bbox
    });
    if (!query) {
      setStatus('検索条件が不足しています。', true);
      return;
    }

    const elements = await fetchPOIs(query);
    const normalized = elements
      .map(normalizeElement)
      .filter(e => e.lat && e.lon);

    // Compute distances and estimated times
    for (const n of normalized) {
      const d = haversine(origin.lat, origin.lon, n.lat, n.lon);
      n.distance = d;
      n.etaMin = n.distance / SPEEDS[els.mode.value];
    }

    // Use OSRM for accurate travel times (if possible)
    try {
      const profile = els.mode.value === 'walking' ? 'foot' : 'driving';
      const osrmMins = await getOsrmDurations(profile, origin, normalized.slice(0, 100));
      osrmMins.forEach((m, i) => { if (m != null) normalized[i].etaAccMin = m; });
    } catch (e) {
      console.warn('OSRM failed, fallback to heuristic:', e);
    }

    // Apply final filter based on chosen metric
    let filtered;
    if (metric === 'distance') {
      const limit = els.distanceUnit.value === 'km'
        ? parseFloat(els.distance.value) * 1000
        : parseFloat(els.distance.value);
      filtered = normalized.filter(n => n.distance <= limit);
      filtered.sort((a,b) => a.distance - b.distance);
    } else {
      const limitMin = parseFloat(els.time.value);
      const etaOf = (n) => (n.etaAccMin ?? n.etaMin);
      filtered = normalized.filter(n => etaOf(n) <= limitMin);
      filtered.sort((a,b) => etaOf(a) - etaOf(b));
    }

    // Favorites only filter (optional)
    if (els.favOnly?.checked) {
      filtered = filtered.filter(n => isFav(n.id));
    }

    // Sorting
    const sorted = applySorting(filtered, metric);
    allItems = sorted.slice(0, 200); // keep up to 200 for paging
    currentPage = 1;
    renderPage(metric);
    setStatus(`見つかったスポット: ${filtered.length} 件`);
    lastSearchState = collectState();
    updateURLFromState(lastSearchState);
  } catch (e) {
    console.error(e);
    setStatus('検索中にエラーが発生しました。時間を置いて再度お試しください。', true);
  }
}

function renderPage(metric){
  const start = (currentPage - 1) * pageSize;
  const pageItems = allItems.slice(start, start + pageSize);
  renderResults(pageItems, metric);
  updateMap(pageItems);
  renderPagination();
  fetchThumbnailsFor(pageItems);
}

function renderPagination(){
  const total = allItems.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  els.pagination.innerHTML = '';
  const prev = document.createElement('button'); prev.textContent = '前へ'; prev.disabled = currentPage <= 1; prev.onclick = () => { currentPage--; renderPage(els.metric.value); };
  const next = document.createElement('button'); next.textContent = '次へ'; next.disabled = currentPage >= totalPages; next.onclick = () => { currentPage++; renderPage(els.metric.value); };
  const info = document.createElement('span'); info.className = 'info'; info.textContent = `${currentPage}/${totalPages} ページ（${total} 件）`;
  els.pagination.append(prev, info, next);
}

// Favorites
function loadFavs(){
  try { return JSON.parse(localStorage.getItem('wfw_favs')||'{}'); } catch { return {}; }
}
function saveFavs(f){ localStorage.setItem('wfw_favs', JSON.stringify(f)); }
function isFav(id){ const f = loadFavs(); return !!f[id]; }
function toggleFav(item){
  const f = loadFavs();
  if (f[item.id]) { delete f[item.id]; }
  else { f[item.id] = { id:item.id, name:item.name, lat:item.lat, lon:item.lon }; }
  saveFavs(f);
}

async function getOsrmDurations(profile, origin, items){
  // Uses OSRM public demo server. Returns minutes array aligned with items
  const base = 'https://router.project-osrm.org';
  const chunkSize = 80; // be gentle with public server
  const results = new Array(items.length).fill(null);
  for (let start = 0; start < items.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, items.length);
    const coords = [ `${origin.lon},${origin.lat}` ].concat(
      items.slice(start, end).map(p => `${p.lon},${p.lat}`)
    ).join(';');
    const url = `${base}/table/v1/${profile}/${coords}?sources=0&annotations=duration`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const json = await res.json();
    const durs = json.durations?.[0] || [];
    for (let i = start; i < end; i++) {
      const sec = durs[i - start + 1];
      results[i] = (typeof sec === 'number' && isFinite(sec)) ? sec / 60 : null;
    }
  }
  return results;
}

function applySorting(items, metric){
  const sortBy = els.sortBy?.value || 'auto';
  const dir = (els.sortDir?.value || 'asc') === 'asc' ? 1 : -1;
  const etaOf = (n) => (n.etaAccMin ?? n.etaMin ?? Infinity);
  const nameOf = (n) => (n.name || '').toString().toLowerCase();
  const catOf = (n) => (n.cats?.[0] || '');
  const by = (v1,v2) => (v1<v2?-1: v1>v2?1:0) * dir;
  const key = (sortBy==='auto') ? (metric==='distance'?'distance': metric==='time'?'time':'distance') : sortBy;
  const compare = (a,b) => {
    switch(key){
      case 'distance': return by(a.distance??Infinity, b.distance??Infinity);
      case 'time': return by(etaOf(a), etaOf(b));
      case 'name': return by(nameOf(a), nameOf(b));
      case 'category': return by(catOf(a), catOf(b));
      default: return 0;
    }
  };
  return items.slice().sort(compare);
}

async function fetchThumbnailsFor(items){
  const limited = items.slice(0, 12);
  await Promise.all(limited.map(async (it) => {
    try {
      let src = null;
      const wp = it.tags?.wikipedia;
      if (wp && typeof wp === 'string' && wp.includes(':')) {
        const [lang, titleRaw] = wp.split(':', 2);
        const title = encodeURIComponent(titleRaw.replace(/ /g, '_'));
        const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${title}`;
        const r = await fetch(url);
        if (r.ok) {
          const j = await r.json();
          src = j.thumbnail?.source || null;
        }
      }
      if (!src && it.tags?.wikidata) {
        const q = it.tags.wikidata;
        const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${q}.json`);
        if (r.ok) {
          const j = await r.json();
          const ent = j.entities?.[q];
          const p18 = ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
          if (p18) {
            const filename = encodeURIComponent(p18.replace(/ /g, '_'));
            src = `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=120`;
          }
        }
      }
      if (src) {
        const img = document.getElementById(`thumb-${it.id}`);
        if (img) { img.src = src; img.classList.remove('hidden'); }
      }
    } catch {}
  }));
}

// URL state sync helpers
function collectState(){
  const details = [];
  const detailIds = ['detail-cafe','detail-restaurant-ramen','detail-restaurant-sushi','detail-fast_food','detail-bar','detail-pub','detail-bakery','detail-park','detail-garden','detail-museum','detail-gallery','detail-viewpoint','detail-attraction','detail-theme_park','detail-zoo','detail-aquarium','detail-historic','detail-temple','detail-shrine','detail-church'];
  detailIds.forEach(id=>{ const el = document.getElementById(id); if (el && el.checked) details.push(id.replace('detail-','')); });
  const s = {
    metric: els.metric.value,
    distance: els.distance.value,
    distanceUnit: els.distanceUnit.value,
    time: els.time.value,
    mode: els.mode.value,
    gourmet: els.catGourmet.checked ? 1:0,
    sight: els.catSight.checked ? 1:0,
    details: details.join(','),
    sortBy: els.sortBy?.value,
    sortDir: els.sortDir?.value,
    bbox: els.bboxMode?.checked ? 1:0,
    favOnly: els.favOnly?.checked ? 1:0,
    page: currentPage
  };
  if (map) {
    const c = map.getCenter();
    s.center = `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
    s.z = map.getZoom();
  }
  return s;
}

function updateURLFromState(s){
  const u = new URL(location.href);
  Object.entries(s).forEach(([k,v])=>{ if (v===undefined || v==='' || v===null) u.searchParams.delete(k); else u.searchParams.set(k, String(v)); });
  history.replaceState(null, '', u);
}

function applyState(s){
  if (!s) return;
  if (s.metric) els.metric.value = s.metric;
  if (s.distance) els.distance.value = s.distance;
  if (s.distanceUnit) els.distanceUnit.value = s.distanceUnit;
  if (s.time) els.time.value = s.time;
  if (s.mode) els.mode.value = s.mode;
  if ('gourmet' in s) els.catGourmet.checked = s.gourmet==1 || s.gourmet==='1';
  if ('sight' in s) els.catSight.checked = s.sight==1 || s.sight==='1';
  if (s.sortBy) els.sortBy.value = s.sortBy;
  if (s.sortDir) els.sortDir.value = s.sortDir;
  if ('favOnly' in s) els.favOnly.checked = s.favOnly==1 || s.favOnly==='1';
  if ('bbox' in s) els.bboxMode.checked = s.bbox==1 || s.bbox==='1';
  if (s.details) {
    const set = new Set(String(s.details).split(',').filter(Boolean));
    ['detail-cafe','detail-restaurant-ramen','detail-restaurant-sushi','detail-fast_food','detail-bar','detail-pub','detail-bakery','detail-park','detail-garden','detail-museum','detail-gallery','detail-viewpoint','detail-attraction','detail-theme_park','detail-zoo','detail-aquarium','detail-historic','detail-temple','detail-shrine','detail-church']
      .forEach(id=>{ const el = document.getElementById(id); if (el) el.checked = set.has(id.replace('detail-','')); });
  }
  toggleControls();
  if (map && s.center && s.z) {
    const [lat,lng] = String(s.center).split(',').map(parseFloat);
    if (isFinite(lat) && isFinite(lng)) map.setView([lat,lng], Number(s.z));
  }
  if (s.page) currentPage = Math.max(1, Number(s.page));
}

function parseURLState(){
  const p = Object.fromEntries(new URL(location.href).searchParams.entries());
  return p;
}

function debounce(fn, ms){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

function attachMapMoveListener(){
  ensureMap();
  const handler = debounce(()=>{ if (els.bboxMode?.checked) onSearch(); }, 400);
  map.on('moveend', handler);
}

// PWA registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}

// Boot: apply URL state, init map listener
window.addEventListener('DOMContentLoaded', () => {
  const s = parseURLState();
  applyState(s);
  ensureMap();
  attachMapMoveListener();
  // Auto search if URL had params
  if (Object.keys(s).length) onSearch();
  // Bind UI events (safe to bind here once DOM is ready)
  els.searchBtn?.addEventListener('click', onSearch);
  els.favOnly?.addEventListener('change', () => { if (allItems.length) { renderPage(els.metric.value); } else { onSearch(); } updateURLFromState(collectState()); });
  els.sortBy?.addEventListener('change', () => { if (allItems.length) { allItems = applySorting(allItems, els.metric.value); currentPage = 1; renderPage(els.metric.value); updateURLFromState(collectState()); } });
  els.sortDir?.addEventListener('change', () => { if (allItems.length) { allItems = applySorting(allItems, els.metric.value); currentPage = 1; renderPage(els.metric.value); updateURLFromState(collectState()); } });
  els.bboxMode?.addEventListener('change', () => { if (els.bboxMode.checked) { onSearch(); } });
});
