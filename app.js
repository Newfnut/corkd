import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocFromCache, getDocs, getDocsFromCache, onSnapshot, updateDoc, query as fsQ, where, serverTimestamp, enableIndexedDbPersistence, writeBatch, increment, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ═══════════════════════════════════════════
// CONFIG & FIREBASE INIT (shared hallarc project)
// ═══════════════════════════════════════════
const fbConfig = {
  apiKey: "AIzaSyATdyW05921fNz_wyZ3zjYVF4o44mm_tyg",
  authDomain: "hallarc.firebaseapp.com",
  projectId: "hallarc",
  storageBucket: "hallarc.firebasestorage.app",
  messagingSenderId: "1057782930491",
  appId: "1:1057782930491:web:b54109ac07001be634501e",
  measurementId: "G-RDCJCLSQ5X"
};
const BASE = '/corkd';
const DEV = new URLSearchParams(location.search).has('dev');
const fbApp = initializeApp(fbConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
enableIndexedDbPersistence(db).catch(() => {});

const DEFAULT_TYPES = ['Red Blend', 'Red', 'White', 'Rosé', 'Moscato', 'Sparkling', 'Beer', 'Other'];

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
const S = {
  screen: 'loading',
  user: null, householdId: null, householdCode: null,
  wines: [], types: DEFAULT_TYPES.slice(), customTypes: [], stores: [],
  theme: localStorage.getItem('theme') || 'light',
  unsubs: [],
  authMode: 'signin', pendingHouseholdCode: null,
  q: '', type: 'All', view: 'main', fKeep: false, fStock: false,
  sheet: null, detailId: null,
  purchases: [], purchasesLoaded: false,
  photoCache: {}, devPurch: {},
};

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function q(id) { return document.getElementById(id); }
function qAll(sel) { return document.querySelectorAll(sel); }
function on(id, ev, fn) { const el = q(id); if (el) el.addEventListener(ev, fn); }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function rndCode() { return Math.random().toString(36).toUpperCase().slice(2, 8); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function withTimeout(promise, ms = 6000) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}
function haptic(type = 'light') {
  if (!navigator.vibrate) return;
  const patterns = { light: 10, medium: 25, heavy: [30, 20, 30] };
  navigator.vibrate(patterns[type] ?? 10);
}
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function fmtDate(d) { if (!d) return ''; return new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }); }
function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
function typeIcon(t) { return t === 'Beer' ? '🍺' : t === 'Sparkling' ? '🥂' : '🍷'; }
function wpath(id) { return `households/${S.householdId}/wines/${id}`; }
function settingsPath() { return `households/${S.householdId}/cellar-settings/main`; }
function col(name) { return collection(db, `households/${S.householdId}/${name}`); }
function mergeTypes(custom) {
  const out = DEFAULT_TYPES.slice();
  (custom || []).forEach(t => { if (!out.some(x => x.toLowerCase() === String(t).toLowerCase())) out.push(t); });
  return out;
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
function bgFail(what) { return err => { console.error(what, err); toast(`${what} failed. Check your connection.`); }; }

function compressImage(file, maxBytes) {
  return new Promise(resolve => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height, maxW = 1000, maxH = 1400;
      if (w > maxW || h > maxH) { const rs = Math.min(maxW / w, maxH / h); w = Math.round(w * rs); h = Math.round(h * rs); }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      let qy = 0.85, data = '';
      do { data = canvas.toDataURL('image/jpeg', qy); qy -= 0.1; } while (data.length > maxBytes && qy > 0.1);
      resolve(data);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
function makeThumb(dataUrl, maxBytes = 14000) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const rs = Math.min(120 / img.width, 160 / img.height, 1);
      c.width = Math.max(1, Math.round(img.width * rs));
      c.height = Math.max(1, Math.round(img.height * rs));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let qy = 0.7, data = '';
      do { data = c.toDataURL('image/jpeg', qy); qy -= 0.1; } while (data.length > maxBytes && qy > 0.2);
      resolve(data);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
function openPhotoLightbox(src) {
  const ov = document.createElement('div');
  ov.className = 'photo-lightbox';
  ov.innerHTML = `<img src="${src}" alt="">`;
  ov.addEventListener('click', () => ov.remove());
  document.body.appendChild(ov);
}

// ═══════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════
function setTheme(t) {
  S.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('meta-theme')?.setAttribute('content', t === 'dark' ? '#1c1c1e' : '#7b1e3a');
  localStorage.setItem('theme', t);
}
setTheme(S.theme);

// ═══════════════════════════════════════════
// NAVIGATION & RENDER
// ═══════════════════════════════════════════
function go(screen) { S.screen = screen; render(); }

function render() {
  const app = q('app');
  if (S.screen === 'loading') {
    app.innerHTML = `<div class="loading-screen"><div style="font-size:44px">🍷</div><div class="spin"></div></div>`;
  } else if (S.screen === 'auth') {
    app.innerHTML = renderAuth(); bindAuth();
  } else if (S.screen === 'cellar') {
    app.innerHTML = renderCellar(); bindCellar(); refreshCellar();
  }
}

// ─── Auth ────────────────────────────────────
function renderAuth() {
  const m = S.authMode;
  return `
  <div class="screen" id="auth-screen">
    <img src="icon.png" class="auth-logo" alt="">
    <div class="auth-title">Cork n Count</div>
    <div class="auth-sub">What you've tried, and what's on the rack</div>
    <div class="auth-form">
      ${m === 'join' ? `
        <input class="auth-inp" id="a-code" type="text" placeholder="6-digit household code" maxlength="6" autocomplete="off" style="text-align:center;font-size:22px;letter-spacing:.18em">
      ` : `
        <input class="auth-inp" id="a-email" type="email" placeholder="Email address" autocomplete="email">
        <input class="auth-inp" id="a-pass" type="password" placeholder="Password" autocomplete="${m === 'signup' ? 'new-password' : 'current-password'}">
        ${m === 'signup' ? `<input class="auth-inp" id="a-name" type="text" placeholder="Your name">` : ''}
      `}
      <div id="a-err" style="display:none" class="err-msg"></div>
      <button class="btn-main" style="margin:0;width:100%" id="a-submit">
        ${m === 'signin' ? 'Sign In' : m === 'signup' ? 'Create Account' : 'Join Household'}
      </button>
    </div>
    ${m !== 'join' ? `
      <div class="auth-link">${m === 'signin' ? `No account? <a href="#" id="a-toggle">Sign up</a>` : `Have an account? <a href="#" id="a-toggle">Sign in</a>`}</div>
      <div class="auth-or">or</div>
      <button class="btn-outline" id="a-join-btn">Join existing household</button>
    ` : `<div class="auth-link"><a href="#" id="a-toggle">Back to sign in</a></div>`}
  </div>`;
}

function bindAuth() {
  on('a-submit', 'click', doAuth);
  on('a-toggle', 'click', e => { e.preventDefault(); S.authMode = S.authMode === 'signin' ? 'signup' : 'signin'; render(); });
  on('a-join-btn', 'click', () => { S.authMode = 'join'; render(); });
  qAll('.auth-inp').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); }));
}

async function doAuth() {
  const btn = q('a-submit'), err = q('a-err');
  if (!btn) return;
  err.style.display = 'none'; btn.disabled = true; btn.textContent = 'Please wait…';
  try {
    if (S.authMode === 'join') {
      const code = q('a-code').value.trim().toUpperCase();
      if (code.length !== 6) throw { message: 'Please enter a valid 6-digit code' };
      S.pendingHouseholdCode = code; S.authMode = 'signup'; render(); return;
    }
    const email = q('a-email').value.trim(), pass = q('a-pass').value;
    if (S.authMode === 'signup') {
      const name = (q('a-name')?.value.trim()) || 'Member';
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      if (S.pendingHouseholdCode) {
        const snap = await getDocs(fsQ(collection(db, 'households'), where('code', '==', S.pendingHouseholdCode)));
        if (!snap.empty) {
          const hid = snap.docs[0].id;
          await setDoc(doc(db, 'users', cred.user.uid), { householdId: hid, name, email, createdAt: serverTimestamp() });
          S.pendingHouseholdCode = null; return;
        }
      }
      const code = rndCode();
      const hRef = await addDoc(collection(db, 'households'), { code, createdBy: cred.user.uid, createdAt: serverTimestamp() });
      await setDoc(doc(db, 'users', cred.user.uid), { householdId: hRef.id, name, email, createdAt: serverTimestamp() });
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (e) {
    err.textContent = e.message || 'Something went wrong'; err.style.display = 'block';
    btn.disabled = false; btn.textContent = S.authMode === 'signin' ? 'Sign In' : S.authMode === 'signup' ? 'Create Account' : 'Join Household';
  }
}

// ─── Cellar (main screen) ────────────────────
function renderCellar() {
  return `
  <div class="screen" id="cellar-screen">
    <div class="hdr">
      <div style="flex:1;min-width:0"><div class="hdr-title">Cork n Count</div><div class="hdr-sub" id="c-sub"></div></div>
      <button class="ico-btn" id="c-set" aria-label="Settings">⚙️</button>
      <button class="pill-ico-btn pill-accent" id="c-add">+ Add</button>
    </div>
    <div class="c-tools">
      <input class="c-search" id="c-search" type="search" placeholder="Search producer, name or region" autocomplete="off" value="${esc(S.q)}">
      <div class="seg" id="c-view"></div>
      <div class="chip-row" id="c-types"></div>
      <div class="chip-row" id="c-flt"></div>
    </div>
    <div class="scroll" id="c-list"></div>
  </div>`;
}

function bindCellar() {
  on('c-add', 'click', () => openWineSheet(null));
  on('c-set', 'click', openSettings);
  on('c-search', 'input', debounce(() => { S.q = q('c-search').value; refreshCellar(); }, 120));
  q('c-types').addEventListener('click', e => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    S.type = b.dataset.type; refreshCellar();
  });
  q('c-view').addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    S.view = b.dataset.view; S.type = 'All'; refreshCellar();
  });
  q('c-flt').addEventListener('click', e => {
    const b = e.target.closest('[data-flt]'); if (!b) return;
    toggleFilter(b.dataset.flt); refreshCellar();
  });
  q('c-list').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b) {
      e.stopPropagation();
      if (b.dataset.act === 'bought') { S.detailId = b.dataset.id; S.purchases = []; openPurchaseSheet(b.dataset.id); return; }
      adjustQty(b.dataset.id, b.dataset.act === 'inc' ? 1 : -1);
      return;
    }
    const r = e.target.closest('.wine-row');
    if (r) openDetail(r.dataset.id);
  });
}

function toggleFilter(k) {
  if (k === 'keep') S.fKeep = !S.fKeep;
  if (k === 'stock') S.fStock = !S.fStock;
}

function inView(w, view) {
  if (view === 'wish') return !!w.want;
  if (w.want) return false;
    if (view === 'rebuy') return (w.qtyOnHand || 0) <= 0;
  return true;
}

function filteredWines() {
  const t = S.q.trim().toLowerCase();
  return S.wines.filter(w => {
    const qty = w.qtyOnHand || 0;
    if (!inView(w, S.view)) return false;
    if (S.type !== 'All' && w.type !== S.type) return false;
    if (S.view === 'main' && S.fKeep && !w.keeper) return false;
    if (S.view === 'main' && S.fStock && !(qty > 0)) return false;
    if (t) {
      const hay = [w.producer, w.name, w.region, w.type].join(' ').toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  }).sort((a, b) => (a.producer || '').localeCompare(b.producer || '') || (a.name || '').localeCompare(b.name || ''));
}

function emptyHTML(view) {
  const m = view === 'wish'
    ? ['⭐', 'Wish list is empty', 'Tap + Add and switch on "Haven\'t bought it yet" to save something you want to try.']
    : view === 'rebuy'
      ? ['🔁', 'Nothing to rebuy', 'Keepers you have run out of show up here.']
      : ['🍷', 'Nothing on the rack yet', 'Tap + Add to log your first bottle.'];
  return `<div class="empty"><span class="empty-ico">${m[0]}</span><div class="empty-ttl">${m[1]}</div><div class="empty-txt">${m[2]}</div></div>`;
}

function refreshCellar() {
  if (S.screen !== 'cellar' || !q('c-list')) return;
  const owned = S.wines.filter(w => !w.want);
  const bottles = owned.reduce((n, w) => n + (w.qtyOnHand || 0), 0);
  q('c-sub').textContent = `${owned.length} saved, ${bottles} on hand`;

  const count = v => S.wines.filter(w => inView(w, v)).length;
  q('c-view').innerHTML = [['main', 'My list'], ['wish', 'Wish list'], ['rebuy', 'Rebuy']]
    .map(([k, l]) => `<button class="seg-btn ${S.view === k ? 'sel' : ''}" data-view="${k}">${l} <span class="seg-n">${count(k)}</span></button>`).join('');

  const base = S.wines.filter(w => inView(w, S.view));
  const used = [...new Set(base.map(w => w.type).filter(Boolean))];
  const ordered = S.types.filter(t => used.includes(t)).concat(used.filter(t => !S.types.includes(t)));
  if (S.type !== 'All' && !used.includes(S.type)) S.type = 'All';
  q('c-types').innerHTML = ['All', ...ordered].map(t => `<button class="cat-chip ${S.type === t ? 'sel' : ''}" data-type="${esc(t)}">${esc(t)}</button>`).join('');
  q('c-flt').innerHTML = S.view === 'main'
    ? [['keep', 'Keepers', S.fKeep], ['stock', 'In stock', S.fStock]].map(([k, l, s]) => `<button class="cat-chip ${s ? 'sel' : ''}" data-flt="${k}">${l}</button>`).join('')
    : '';

  const list = filteredWines();
  if (!base.length) {
    q('c-list').innerHTML = emptyHTML(S.view);
  } else if (!list.length) {
    q('c-list').innerHTML = `<div class="empty"><span class="empty-ico">🔍</span><div class="empty-ttl">No matches</div><div class="empty-txt">Try a different search or clear a filter.</div></div>`;
  } else {
    q('c-list').innerHTML = `<div class="wine-list">${list.map(rowHTML).join('')}</div>`;
  }
}
}

function rowHTML(w) {
  const qty = w.qtyOnHand || 0;
  const thumb = w.thumbData ? `<img class="wr-thumb" src="${w.thumbData}" alt="">` : `<div class="wr-thumb wr-ph">${typeIcon(w.type)}</div>`;
  const meta = [w.type, w.region].filter(Boolean).map(esc).join(' · ');
  const last = [w.lastPrice != null ? money(w.lastPrice) : '', w.lastStore ? esc(w.lastStore) : ''].filter(Boolean).join(' at ');
  const tags = (w.keeper ? `<span class="tag-keep">Keeper</span>` : '') + (w.rating > 0 ? `<span class="tag-stars">${'★'.repeat(w.rating)}</span>` : '');
  return `
  <div class="wine-row" data-id="${w.id}">
    ${thumb}
    <div class="wr-main">
      <div class="wr-prod">${esc(w.producer)}</div>
      ${w.name ? `<div class="wr-name">${esc(w.name)}</div>` : ''}
      ${meta ? `<div class="wr-meta">${meta}</div>` : ''}
      ${tags ? `<div class="wr-tags">${tags}</div>` : ''}
      ${last ? `<div class="wr-last">${last}</div>` : ''}
    </div>
    <div class="wr-side">
      <div class="have ${qty > 0 ? '' : 'zero'}">Have: ${qty}</div>
      <div class="wr-step">
        <button class="wr-btn" data-act="dec" data-id="${w.id}" aria-label="One less" ${qty <= 0 ? 'disabled' : ''}>−</button>
        <button class="wr-btn" data-act="inc" data-id="${w.id}" aria-label="One more">+</button>
      </div>
    </div>
  </div>`;
}

function adjustQty(id, delta) {
  const w = S.wines.find(x => x.id === id); if (!w) return;
  const cur = w.qtyOnHand || 0;
  const nq = Math.max(0, cur + delta);
  if (nq === cur) return;
  haptic('light');
  w.qtyOnHand = nq;
  refreshCellar(); refreshDetail();
  if (DEV) return;
  updateDoc(doc(db, wpath(id)), { qtyOnHand: nq, updatedAt: serverTimestamp() }).catch(bgFail('Quantity update'));
}

// ═══════════════════════════════════════════
// SHEETS
// ═══════════════════════════════════════════
function openSheet(kind, html, bind) {
  closeSheets(true);
  S.sheet = kind;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet">${html}</div>`;
  q('sheets').appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) closeSheets(); });
  const sheet = ov.querySelector('.sheet');
  if (bind) bind(sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => { ov.classList.add('open'); bindSheetDrag(sheet); }));
}
function setSheetHTML(html, bind) {
  const sheet = document.querySelector('#sheets .sheet'); if (!sheet) return;
  const st = sheet.scrollTop;
  sheet.innerHTML = html;
  if (bind) bind(sheet);
  sheet.scrollTop = st;
}
function closeSheets(immediate) {
  qAll('#sheets .overlay').forEach(el => {
    if (immediate === true) { el.remove(); return; }
    el.classList.remove('open');
    const sh = el.querySelector('.sheet');
    if (sh) { sh.style.transform = ''; sh.style.transition = ''; }
    setTimeout(() => el.remove(), 300);
  });
  if (immediate !== true) S.sheet = null;
}
function bindSheetDrag(sheet) {
  if (!sheet || sheet._dragBound) return; sheet._dragBound = true;
  let sy = 0, going = false;
  sheet.addEventListener('touchstart', e => { if (e.touches[0].clientY > sheet.getBoundingClientRect().top + 48) return; sy = e.touches[0].clientY; going = true; sheet.style.transition = 'none'; }, { passive: true });
  sheet.addEventListener('touchmove', e => { if (!going) return; const dy = e.touches[0].clientY - sy; if (dy > 0) sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sheet.addEventListener('touchend', e => { if (!going) return; going = false; const dy = e.changedTouches[0].clientY - sy; sheet.style.transition = ''; if (dy > 40) closeSheets(); else sheet.style.transform = ''; });
}
function showSheetErr(msg) {
  const el = q('s-err'); if (!el) return;
  el.textContent = msg; el.style.display = 'block';
}

// ─── Wine detail sheet ───────────────────────
function openDetail(id) {
  S.detailId = id; S.purchases = []; S.purchasesLoaded = false;
  openSheet('detail', detailHTML(), bindDetail);
  loadPurchases(id); loadPhoto(id);
}

function refreshDetail() {
  if (S.sheet !== 'detail') return;
  setSheetHTML(detailHTML(), bindDetail);
}

function detailHTML() {
  const w = S.wines.find(x => x.id === S.detailId);
  if (!w) return `<div class="sheet-handle"></div><div class="p-empty">This wine is no longer in the cellar.</div>`;
  const qty = w.qtyOnHand || 0;
  const src = S.photoCache[w.id] || w.thumbData;
  const meta = [w.type, w.region].filter(Boolean).map(esc).join(' · ');
  const tags = (w.keeper ? `<span class="tag-keep">Keeper</span>` : '') + (w.rating > 0 ? `<span class="tag-stars">${'★'.repeat(w.rating)}</span>` : '');
  const hist = !S.purchasesLoaded ? `<div class="p-empty">Loading…</div>`
    : S.purchases.length ? S.purchases.map(purchaseRowHTML).join('') : `<div class="p-empty">No purchases logged yet.</div>`;
  return `
  <div class="sheet-handle"></div>
  <div class="sheet-hdr-row">
    <div class="sheet-title-in">${esc(w.producer)}${w.name ? `<div class="wr-name">${esc(w.name)}</div>` : ''}</div>
    <button class="mini-btn" id="d-edit">Edit</button>
    <button class="ico-btn" id="d-close" aria-label="Close">✕</button>
  </div>
  ${src ? `<img class="d-photo" id="d-photo" src="${src}" alt="Label photo">` : ''}
  ${meta ? `<div class="d-meta">${meta}</div>` : ''}
  ${w.want ? `<div class="d-tags"><span class="tag-keep">Wish list</span></div>` : ''}
  ${tags ? `<div class="d-tags">${tags}</div>` : ''}
  ${w.notes ? `<div class="d-notes">${esc(w.notes)}</div>` : ''}
  ${w.want ? '' : `<div class="d-have">
    <div><div class="d-have-lbl">Have</div><div class="d-count">${qty}</div></div>
    <div class="d-step">
      <button id="d-dec" aria-label="One less" ${qty <= 0 ? 'disabled' : ''}>−</button>
      <button id="d-inc" aria-label="One more">+</button>
    </div>
  </div>`}
  <button class="btn-main" id="d-buy">${w.want ? 'Bought it' : 'Add purchase'}</button>
  <div class="edr-divider">Purchase history</div>
  <div style="margin-top:6px">${hist}</div>`;
}

function purchaseRowHTML(p) {
  const sub = p.sale > 0 ? `<div class="p-sub">${money(p.price)} − ${money(p.sale)}</div>` : '';
  return `
  <div class="p-row">
    <div class="p-main"><div class="p-store">${esc(p.store) || 'Store not noted'}</div><div class="p-date">${fmtDate(p.date)} · ${p.qty} bought</div></div>
    <div class="p-price">${p.price > 0 ? money(p.finalPrice) : '–'}${sub}</div>
  </div>`;
}

function bindDetail() {
  on('d-close', 'click', () => closeSheets());
  on('d-edit', 'click', () => openWineSheet(S.detailId));
  on('d-buy', 'click', () => openPurchaseSheet(S.detailId));
  on('d-dec', 'click', () => adjustQty(S.detailId, -1));
  on('d-inc', 'click', () => adjustQty(S.detailId, 1));
  on('d-photo', 'click', () => { const w = S.wines.find(x => x.id === S.detailId); const s = S.photoCache[S.detailId] || w?.thumbData; if (s) openPhotoLightbox(s); });
}

async function loadPurchases(id) {
  let list = [];
  if (DEV) list = (S.devPurch[id] || []).slice();
  else {
    const c = collection(db, wpath(id) + '/purchases');
    try { list = (await withTimeout(getDocs(c), 8000)).docs.map(d => ({ id: d.id, ...d.data() })); }
    catch (e) { try { list = (await getDocsFromCache(c)).docs.map(d => ({ id: d.id, ...d.data() })); } catch (e2) { list = []; } }
  }
  list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (S.detailId === id) { S.purchases = list; S.purchasesLoaded = true; refreshDetail(); }
}

async function loadPhoto(id) {
  const w = S.wines.find(x => x.id === id);
  if (DEV || !w || !w.hasPhoto || S.photoCache[id]) return;
  const ref = doc(db, wpath(id) + '/photo/main');
  let d = null;
  try { d = await withTimeout(getDoc(ref), 8000); }
  catch (e) { try { d = await getDocFromCache(ref); } catch (e2) { d = null; } }
  if (d && d.exists()) { S.photoCache[id] = d.data().data; refreshDetail(); }
}

// ─── Purchase rows (shared by add-wine and add-purchase sheets) ───
function purchaseRows(p, minQty) {
  return `
  <div class="edr-rows">
    <div class="edr-row"><span class="edr-lbl">Date</span><input class="edr-inp" type="date" id="p-date" value="${esc(p.date)}"></div>
    <div class="edr-row"><span class="edr-lbl">Store</span><input class="edr-inp" id="p-store" value="${esc(p.store)}" placeholder="Where you bought it" autocomplete="off" autocapitalize="words"></div>
    ${S.stores.length ? `<div class="edr-row"><span class="edr-lbl"></span><div class="chip-wrap" id="p-stores">${S.stores.map(s => `<button class="cat-chip" data-store="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>` : ''}
    <div class="edr-row"><span class="edr-lbl">Price</span><input class="edr-inp" id="p-price" type="text" inputmode="decimal" placeholder="0.00" value="${esc(p.price)}"></div>
    <div class="edr-row"><span class="edr-lbl">Sale (off)</span><input class="edr-inp" id="p-sale" type="text" inputmode="decimal" placeholder="0.00" value="${esc(p.sale)}"></div>
    <div class="edr-row"><span class="edr-lbl">Final price</span><span class="edr-wtotal" id="p-final">$0.00</span></div>
    <div class="edr-row"><span class="edr-lbl">Bottles</span>
      <div class="edr-qty-stepper"><button class="qty-btn" id="p-dec" data-min="${minQty}">−</button><input class="edr-inp edr-qty" id="p-qty" type="text" inputmode="numeric" value="${p.qty}"><button class="qty-btn" id="p-inc">+</button></div>
    </div>
  </div>`;
}

function numVal(id) {
  const v = parseFloat(String(q(id)?.value || '').replace(',', '.'));
  return isFinite(v) && v > 0 ? v : 0;
}
function readPurchase() {
  const price = numVal('p-price'), sale = numVal('p-sale');
  return {
    date: q('p-date')?.value || todayStr(),
    store: (q('p-store')?.value || '').trim(),
    price, sale,
    finalPrice: Math.max(0, price - sale),
    qty: Math.max(0, Math.floor(numVal('p-qty'))),
  };
}
function updateFinal() {
  const el = q('p-final'); if (!el) return;
  const p = readPurchase();
  el.textContent = money(p.finalPrice);
}
function bindPurchaseRows() {
  on('p-price', 'input', updateFinal);
  on('p-sale', 'input', updateFinal);
  on('p-dec', 'click', () => { const min = parseInt(q('p-dec').dataset.min, 10) || 0; q('p-qty').value = Math.max(min, Math.floor(numVal('p-qty')) - 1); });
  on('p-inc', 'click', () => { q('p-qty').value = Math.floor(numVal('p-qty')) + 1; });
  const st = q('p-stores');
  if (st) st.addEventListener('click', e => { const b = e.target.closest('[data-store]'); if (b) q('p-store').value = b.dataset.store; });
  updateFinal();
}

// ─── Add purchase sheet ──────────────────────
function openPurchaseSheet(id) {
  const w = S.wines.find(x => x.id === id); if (!w) return;
  const last = S.purchases[0];
  const p = { date: todayStr(), store: last?.store ?? w.lastStore ?? '', price: last?.price || '', sale: '', qty: 1 };
  if (!last && w.lastPrice) p.price = w.lastPrice;
  openSheet('purchase', `
    <div class="sheet-handle"></div>
    <div class="sheet-hdr-row"><div class="sheet-title-in">Add purchase<div class="wr-name">${esc(w.producer)}${w.name ? ' · ' + esc(w.name) : ''}</div></div><button class="ico-btn" id="p-close" aria-label="Close">✕</button></div>
    ${purchaseRows(p, 1)}
    <div class="err-msg" id="s-err" style="display:none;margin:12px 16px 0"></div>
    <button class="btn-main" id="p-save">Save purchase</button>`,
  () => { on('p-close', 'click', () => closeSheets()); on('p-save', 'click', () => savePurchase(id)); bindPurchaseRows(); });
}

function savePurchase(id) {
  const w = S.wines.find(x => x.id === id); if (!w) return;
  const p = readPurchase();
  if (p.qty < 1) { showSheetErr('Enter how many you bought.'); return; }
  haptic('medium');
  const lastPrice = p.price > 0 ? p.finalPrice : null;
  if (DEV) {
    (S.devPurch[id] = S.devPurch[id] || []).push({ id: 'p' + Date.now(), ...p });
    if (p.store && !S.stores.includes(p.store)) S.stores.push(p.store);
  } else {
    const batch = writeBatch(db);
    batch.set(doc(collection(db, wpath(id) + '/purchases')), { ...p, createdAt: serverTimestamp() });
    batch.update(doc(db, wpath(id)), { qtyOnHand: increment(p.qty), lastStore: p.store, lastPrice, want: false, updatedAt: serverTimestamp() });
    if (p.store) batch.set(doc(db, settingsPath()), { stores: arrayUnion(p.store) }, { merge: true });
    batch.commit().catch(bgFail('Saving the purchase'));
  }
  w.qtyOnHand = (w.qtyOnHand || 0) + p.qty; w.lastStore = p.store; w.lastPrice = lastPrice; w.want = false; w.want = false;
  refreshCellar();
  openDetail(id);
}

// ─── Add / edit wine sheet ───────────────────
let _f = null, _addingType = false;

function openWineSheet(id) {
  _addingType = false;
  if (id) {
    const w = S.wines.find(x => x.id === id); if (!w) return;
    _f = { id, producer: w.producer || '', name: w.name || '', type: w.type || S.types[0], region: w.region || '', keeper: !!w.keeper, want: !!w.want, qty: w.qtyOnHand || 0, rating: w.rating || 0, notes: w.notes || '', photo: null, thumb: w.thumbData || null, photoState: 'keep', hadPhoto: !!w.hasPhoto };
  } else {
    _f = { id: null, producer: '', name: '', type: S.type !== 'All' ? S.type : S.types[0], region: '', keeper: false, want: S.view === 'wish', qty: 0, rating: 0, notes: '', photo: null, thumb: null, photoState: 'none', hadPhoto: false };
  }
  openSheet('wine', wineSheetHTML(), bindWineSheet);
}

function wineSheetHTML() {
  const edit = !!_f.id;
  return `
  <div class="sheet-handle"></div>
  <div class="sheet-hdr-row"><div class="sheet-title-in">${edit ? 'Edit wine' : 'Add to the cellar'}</div><button class="ico-btn" id="w-close" aria-label="Close">✕</button></div>
  ${(!edit || _f.want || _f.qty === 0) ? `<div class="edr-rows"><div class="edr-row edr-row-tog"><span class="edr-lbl">Wish list</span><div class="tog-info"><div class="tog-sub" style="margin:0">Haven't bought it yet</div></div><div class="tog ${_f.want ? 'on' : ''}" id="w-want"></div></div></div>` : ''}
  <div class="edr-rows">
    <div class="edr-row"><span class="edr-lbl">Producer</span><input class="edr-inp" id="w-prod" value="${esc(_f.producer)}" placeholder="Winery or brewery" autocomplete="off" autocapitalize="words"></div>
    <div class="edr-row"><span class="edr-lbl">Name</span><input class="edr-inp" id="w-name" value="${esc(_f.name)}" placeholder="Optional" autocomplete="off" autocapitalize="words"></div>
    <div class="edr-row"><span class="edr-lbl">Region</span><input class="edr-inp" id="w-reg" value="${esc(_f.region)}" placeholder="Optional, e.g. Okanagan, BC" autocomplete="off" autocapitalize="words"></div>
  </div>
  <div class="edr-rows">
    <div class="edr-row" style="align-items:flex-start"><span class="edr-lbl" style="padding-top:8px">Type</span><div class="chip-wrap" id="w-types">${typeChipsHTML()}</div></div>
    <div class="edr-row edr-row-tog"><span class="edr-lbl">Keeper</span><div class="tog-info"><div class="tog-sub" style="margin:0">I'd buy this again</div></div><div class="tog ${_f.keeper ? 'on' : ''}" id="w-keep"></div></div>
    <div class="edr-row"><span class="edr-lbl">Rating</span><div class="stars" id="w-stars">${starsHTML()}</div></div>
  </div>
  <div class="edr-rows"><div class="edr-row" style="align-items:flex-start"><span class="edr-lbl" style="padding-top:8px">Label photo</span><div id="w-photo" style="flex:1;min-width:0">${photoBoxHTML()}</div></div></div>
  <div class="edr-rows"><div class="edr-row" style="align-items:flex-start"><span class="edr-lbl" style="padding-top:8px">Notes</span><textarea class="edr-inp edr-ta" id="w-notes" rows="3" placeholder="What did you think?">${esc(_f.notes)}</textarea></div></div>
  ${edit ? '' : `<div id="w-purch" class="${_f.want ? 'hide' : ''}"><div class="edr-divider">First purchase</div>${purchaseRows({ date: todayStr(), store: '', price: '', sale: '', qty: 1 }, 0)}</div>`}
  <div class="err-msg" id="s-err" style="display:none;margin:12px 16px 0"></div>
  <button class="btn-main" id="w-save">${edit ? 'Save changes' : 'Save wine'}</button>
  ${edit ? `<button class="btn-main btn-del" id="w-del">Delete wine</button>` : ''}`;
}

function typeChipsHTML() {
  const list = S.types.slice();
  if (_f.type && !list.some(t => t.toLowerCase() === _f.type.toLowerCase())) list.push(_f.type);
  return list.map(t => `<button class="cat-chip ${t === _f.type ? 'sel' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('') +
    (_addingType
      ? `<span class="newtype"><input class="edr-inp" id="w-newtype" placeholder="New type" maxlength="24" autocapitalize="words"><button class="add-btn-pill" id="w-newtype-ok">Add</button></span>`
      : `<button class="cat-chip" id="w-newtype-btn">+ New</button>`);
}
function starsHTML() {
  return [1, 2, 3, 4, 5].map(n => `<button class="star ${n <= _f.rating ? 'on' : ''}" data-n="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('');
}
function hasPhotoNow() { return _f.photoState === 'new' || (_f.photoState === 'keep' && _f.hadPhoto); }
function photoBoxHTML() {
  const has = hasPhotoNow();
  const src = _f.photoState === 'new' ? _f.photo : (S.photoCache[_f.id] || _f.thumb);
  return `<input type="file" accept="image/*" id="w-file" style="display:none">` + (has
    ? `<img class="editor-photo-preview" src="${src}" alt=""><div class="photo-actions"><button class="mini-btn" id="w-photo-change">Replace</button><button class="mini-btn danger" id="w-photo-rm">Remove photo</button></div>`
    : `<button class="editor-photo-add" id="w-photo-add">📷 Add a label photo</button>`);
}

function bindWineSheet() {
  on('w-close', 'click', () => closeSheets());
  on('w-save', 'click', saveWine);
  on('w-del', 'click', deleteWine);
  on('w-want', 'click', () => { _f.want = !_f.want; q('w-want').classList.toggle('on', _f.want); q('w-purch')?.classList.toggle('hide', _f.want); haptic('light'); });
  q('w-keep').addEventListener('click', () => { _f.keeper = !_f.keeper; q('w-keep').classList.toggle('on', _f.keeper); haptic('light'); });
  q('w-stars').addEventListener('click', e => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    const n = parseInt(b.dataset.n, 10);
    _f.rating = _f.rating === n ? 0 : n;
    q('w-stars').innerHTML = starsHTML();
  });
  const types = q('w-types');
  types.addEventListener('click', e => {
    const t = e.target.closest('[data-t]');
    if (t) { _f.type = t.dataset.t; types.innerHTML = typeChipsHTML(); return; }
    if (e.target.closest('#w-newtype-btn')) { _addingType = true; types.innerHTML = typeChipsHTML(); q('w-newtype')?.focus(); return; }
    if (e.target.closest('#w-newtype-ok')) addType();
  });
  types.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'w-newtype') { e.preventDefault(); addType(); } });
  bindPhotoBox();
  if (!_f.id) bindPurchaseRows();
}

function addType() {
  const v = cap((q('w-newtype')?.value || '').trim());
  _addingType = false;
  if (v) {
    const ex = S.types.find(t => t.toLowerCase() === v.toLowerCase());
    const name = ex || v;
    if (!ex) {
      S.types.push(name); S.customTypes.push(name);
      if (!DEV) setDoc(doc(db, settingsPath()), { types: arrayUnion(name) }, { merge: true }).catch(bgFail('Saving the new type'));
    }
    _f.type = name;
  }
  q('w-types').innerHTML = typeChipsHTML();
}

function refreshPhotoBox() { q('w-photo').innerHTML = photoBoxHTML(); bindPhotoBox(); }
function bindPhotoBox() {
  const pick = () => q('w-file').click();
  on('w-photo-add', 'click', pick);
  on('w-photo-change', 'click', pick);
  on('w-photo-rm', 'click', () => {
    if (!confirm('Remove this label photo?')) return;
    _f.photo = null; _f.thumb = null; _f.photoState = 'removed'; refreshPhotoBox();
  });
  on('w-file', 'change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const full = await compressImage(f, 350000);
    if (!full) { toast('Could not read that photo.'); return; }
    _f.photo = full; _f.thumb = await makeThumb(full); _f.photoState = 'new';
    refreshPhotoBox();
  });
}

function readWineForm() {
  _f.producer = q('w-prod').value.trim();
  _f.name = q('w-name').value.trim();
  _f.region = q('w-reg').value.trim();
  _f.notes = q('w-notes').value.trim();
}

function saveWine() {
  readWineForm();
  if (!_f.producer) { showSheetErr('Add the winery or brewery name.'); return; }
  haptic('medium');
  const fields = { producer: _f.producer, name: _f.name, type: _f.type, region: _f.region, keeper: _f.keeper, want: _f.want, rating: _f.rating, notes: _f.notes };

  if (_f.id) {
    // ── Edit existing wine (qty and purchases are untouched) ──
    const id = _f.id;
    const patch = { ...fields };
    if (_f.photoState === 'new') { patch.thumbData = _f.thumb; patch.hasPhoto = true; S.photoCache[id] = _f.photo; }
    if (_f.photoState === 'removed') { patch.thumbData = null; patch.hasPhoto = false; delete S.photoCache[id]; }
    const w = S.wines.find(x => x.id === id); if (w) Object.assign(w, patch);
    if (!DEV) {
      const batch = writeBatch(db);
      batch.update(doc(db, wpath(id)), { ...patch, updatedAt: serverTimestamp() });
      if (_f.photoState === 'new') batch.set(doc(db, wpath(id) + '/photo/main'), { data: _f.photo });
      if (_f.photoState === 'removed') batch.delete(doc(db, wpath(id) + '/photo/main'));
      batch.commit().catch(bgFail('Saving changes'));
    }
    refreshCellar();
    openDetail(id);
    return;
  }

  // ── New wine (+ optional first purchase) ──
  const p = readPurchase();
  const hasPurchase = !_f.want && (p.qty > 0 || p.price > 0);
  const data = {
    ...fields,
    thumbData: _f.photoState === 'new' ? _f.thumb : null,
    hasPhoto: _f.photoState === 'new',
    qtyOnHand: hasPurchase ? p.qty : 0,
    lastStore: hasPurchase ? p.store : '',
    lastPrice: hasPurchase && p.price > 0 ? p.finalPrice : null,
  };
  if (DEV) {
    const id = 'dev-' + Date.now();
    S.wines.push({ id, ...data });
    if (_f.photoState === 'new') S.photoCache[id] = _f.photo;
    if (hasPurchase) S.devPurch[id] = [{ id: 'p' + Date.now(), ...p }];
    if (p.store && !S.stores.includes(p.store)) S.stores.push(p.store);
  } else {
    const wref = doc(col('wines'));
    const batch = writeBatch(db);
    batch.set(wref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    if (_f.photoState === 'new') batch.set(doc(db, wpath(wref.id) + '/photo/main'), { data: _f.photo });
    if (hasPurchase) batch.set(doc(collection(db, wpath(wref.id) + '/purchases')), { ...p, createdAt: serverTimestamp() });
    if (p.store) batch.set(doc(db, settingsPath()), { stores: arrayUnion(p.store) }, { merge: true });
    if (_f.photoState === 'new') S.photoCache[wref.id] = _f.photo;
    batch.commit().catch(bgFail('Saving the wine'));
  }
  closeSheets();
  refreshCellar();
}

async function deleteWine() {
  const id = _f.id; if (!id) return;
  if (!confirm('Delete this wine and its purchase history? This cannot be undone.')) return;
  if (DEV) { S.wines = S.wines.filter(w => w.id !== id); closeSheets(); refreshCellar(); return; }
  try {
    const c = collection(db, wpath(id) + '/purchases');
    let snap;
    try { snap = await withTimeout(getDocs(c), 8000); } catch (e) { snap = await getDocsFromCache(c); }
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, wpath(id) + '/photo/main'));
    batch.delete(doc(db, wpath(id)));
    batch.commit().catch(bgFail('Deleting the wine'));
    S.wines = S.wines.filter(w => w.id !== id); delete S.photoCache[id];
    closeSheets(); refreshCellar();
  } catch (e) {
    toast('Could not delete. Check your connection.');
  }
}

// ─── Settings sheet ──────────────────────────
function openSettings() {
  openSheet('settings', settingsHTML(), bindSettings);
  loadHouseholdCode();
}
function settingsHTML() {
  return `
  <div class="sheet-handle"></div>
  <div class="sheet-title">Settings</div>
  <div class="tog-row"><div class="tog-info"><div class="tog-lbl">Dark mode</div></div><div class="tog ${S.theme === 'dark' ? 'on' : ''}" id="st-theme"></div></div>
  <div class="code-box"><div class="code-val">${esc(S.householdCode || '······')}</div><div class="code-hint">Household code. Someone joining picks "Join existing household" when signing up.</div></div>
  <div class="settings-row settings-row-danger" id="st-out" style="margin-top:14px"><span class="settings-row-lbl">Sign out</span></div>`;
}
function bindSettings() {
  on('st-theme', 'click', () => { setTheme(S.theme === 'dark' ? 'light' : 'dark'); q('st-theme').classList.toggle('on', S.theme === 'dark'); });
  on('st-out', 'click', doSignOut);
}
async function loadHouseholdCode() {
  if (S.householdCode) return;
  if (DEV) { S.householdCode = 'DEV123'; }
  else {
    try { const d = await withTimeout(getDoc(doc(db, 'households', S.householdId))); S.householdCode = d.exists() ? d.data().code : null; }
    catch (e) { return; }
  }
  if (S.sheet === 'settings') setSheetHTML(settingsHTML(), bindSettings);
}
async function doSignOut() {
  if (!confirm('Sign out of Cork n Count?')) return;
  closeSheets(true); S.sheet = null;
  S.unsubs.forEach(u => u()); S.unsubs = [];
  S.wines = []; S.householdId = null; S.householdCode = null; S.photoCache = {};
  if (DEV) { toast('Dev mode: sign out skipped.'); return; }
  await signOut(auth);
}

// ═══════════════════════════════════════════
// FIRESTORE LOADING
// ═══════════════════════════════════════════
function loadHousehold(hid) {
  S.unsubs.forEach(u => u()); S.unsubs = [];
  S.householdId = hid;
  const wu = onSnapshot(col('wines'), snap => {
    S.wines = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshCellar(); refreshDetail();
  }, err => console.error('wines listener', err));
  const su = onSnapshot(doc(db, settingsPath()), snap => {
    const d = snap.exists() ? snap.data() : {};
    S.customTypes = d.types || [];
    S.types = mergeTypes(S.customTypes);
    S.stores = (d.stores || []).slice().sort((a, b) => a.localeCompare(b));
    refreshCellar();
  }, err => console.error('settings listener', err));
  S.unsubs.push(wu, su);
}

// ═══════════════════════════════════════════
// SERVICE WORKER + UPDATE TOAST
// ═══════════════════════════════════════════
function showUpdateToast(reg) {
  if (document.getElementById('update-toast')) return;
  const el = document.createElement('div');
  el.id = 'update-toast';
  el.className = 'update-toast';
  el.innerHTML = `<span>A new version is available</span><button id="update-toast-btn">Reload</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  el.querySelector('#update-toast-btn').addEventListener('click', () => { reg.waiting?.postMessage('SKIP_WAITING'); });
}

if ('serviceWorker' in navigator && location.pathname.startsWith(BASE + '/')) {
  navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' }).then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(reg);
      });
    });
  }).catch(() => {});
  let _reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_reloaded) return; _reloaded = true; location.reload();
  });
}
try { screen.orientation?.lock?.('portrait').catch(() => {}); } catch (_) {}

// ═══════════════════════════════════════════
// DEV MODE (?dev=1) — mock data, no Firestore reads or writes
// ═══════════════════════════════════════════
if (DEV) {
  S.householdId = 'dev-household';
  S.user = { uid: 'dev-user', email: 'dev@local' };
  S.stores = ['BC Liquor Store', 'Costco Langley'];
  S.wines = [
    { id: 'd1', producer: 'Mission Hill', name: 'Reserve Red', type: 'Red Blend', region: 'Okanagan, BC', keeper: true, rating: 4, notes: 'Smooth, good with pasta. Buy again when on sale.', thumbData: null, hasPhoto: false, qtyOnHand: 2, lastStore: 'Costco Langley', lastPrice: 15.99 },
    { id: 'd2', producer: 'Gray Monk', name: '', type: 'Rosé', region: 'BC', keeper: true, rating: 0, notes: '', thumbData: null, hasPhoto: false, qtyOnHand: 0, lastStore: 'BC Liquor Store', lastPrice: 17.49 },
    { id: 'd3', producer: 'Barefoot', name: 'Moscato', type: 'Moscato', region: '', keeper: false, rating: 3, notes: 'Sweet. Fine for a patio day.', thumbData: null, hasPhoto: false, qtyOnHand: 1, lastStore: 'BC Liquor Store', lastPrice: 9.99 },
    { id: 'd4', producer: 'Big Rock', name: 'Traditional Ale', type: 'Beer', region: 'Alberta', keeper: false, rating: 0, notes: '', thumbData: null, hasPhoto: false, qtyOnHand: 6, lastStore: 'Costco Langley', lastPrice: 24.5 },
    { id: 'd5', producer: 'Backyard Vineyards', name: 'Pinot Grigio', type: 'White', region: 'Langley, BC', keeper: false, rating: 2, notes: 'Too sharp for us.', thumbData: null, hasPhoto: false, qtyOnHand: 0, lastStore: 'BC Liquor Store', lastPrice: 14.99 },
  ];
  S.devPurch = {
    d1: [{ id: 'p1', date: '2026-10-02', store: 'Costco Langley', price: 19.99, sale: 4, finalPrice: 15.99, qty: 2 }, { id: 'p2', date: '2026-08-14', store: 'BC Liquor Store', price: 21.99, sale: 0, finalPrice: 21.99, qty: 1 }],
  };
  go('cellar');
} else {
  onAuthStateChanged(auth, async user => {
    if (user) {
      S.user = user;
      let ud;
      try { ud = await withTimeout(getDoc(doc(db, 'users', user.uid))); }
      catch (e) { try { ud = await getDocFromCache(doc(db, 'users', user.uid)); } catch (e2) { ud = null; } }
      if (ud && !ud.exists()) { await new Promise(r => setTimeout(r, 1500)); try { ud = await withTimeout(getDoc(doc(db, 'users', user.uid))); } catch (e) {} }
      if (ud && ud.exists()) { loadHousehold(ud.data().householdId); go('cellar'); }
      else if (ud) { await signOut(auth); go('auth'); }
      else { go('auth'); }
    } else go('auth');
  });
}
