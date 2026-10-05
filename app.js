/* Jurnalul Meu – aplicația de pe iPhone
 * v1.1: textul original + datele zilei (10 categorii) + completare pentru zile din urmă.
 * Reguli:
 *  - Textul se salvează exact cum a fost introdus, în 01_Text_original/AAAA/LL/AAAALLZZ_HH_MM.txt
 *    (al doilea din același minut: _2, _3 …). Data/ora din nume = ziua și ora pentru care scrii.
 *    Momentul real al salvării se păstrează în detaliile fișierului din Drive (jmCreatedAt).
 *  - Datele zilei: un fișier JSON la fiecare salvare, în 02_Date_zilnice/AAAA/LL/AAAALLZZ_HH_MM_<categorie>.json.
 *    Fotografiile: 03_Foto/AAAA/LL/AAAALLZZ_HH_MM_<categorie>.jpg
 *  - Fără internet, totul rămâne pe telefon și urcă automat mai târziu.
 *  - Aplicația doar CREEAZĂ fișiere. Nu modifică și nu șterge nimic, niciodată.
 */
(() => {
  'use strict';
  const C = window.JM_CONFIG;
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const DATA_FOLDER = '02_Date_zilnice', PHOTO_FOLDER = '03_Foto';
  const $ = id => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  };

  // ---------- stocare locală ----------
  const LS = {
    get(k, d = null) { try { const v = localStorage.getItem('jm.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('jm.' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('jm.' + k); } catch {} }
  };
  const DB = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('jm', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('entries', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('entries', mode); const out = fn(t.objectStore('entries'));
        t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error);
      });
    };
    return { put: e => tx('readwrite', st => st.put(e)), all: () => tx('readonly', st => st.getAll()) };
  })();

  // ---------- timp ----------
  const pad = n => String(n).padStart(2, '0');
  function isoLocal(d) {
    const off = -d.getTimezoneOffset(), s = off >= 0 ? '+' : '-', a = Math.abs(off);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${s}${pad(a / 60 | 0)}:${pad(a % 60)}`;
  }
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const todayStr = () => ymd(new Date());
  const baseOf = (date, time) => `${date.replace(/-/g, '')}_${time.replace(':', '_')}`;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const ZILE = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'];
  const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
  const fmtDay = s => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${ZILE[dt.getDay()]}, ${d} ${LUNI[m - 1]} ${y}`; };

  // Ziua selectată. Azi: ora = momentul salvării. Altă zi: ora aleasă.
  const S = { day: todayStr(), time: '' };
  const isToday = () => S.day === todayStr();
  function stamp() {
    const now = new Date();
    if (isToday()) return { forDate: ymd(now), forTime: hm(now), retro: false, createdAt: isoLocal(now) };
    return { forDate: S.day, forTime: S.time || '21:00', retro: true, createdAt: isoLocal(now) };
  }

  // ---------- autentificare Google ----------
  function startAuth() {
    const state = uuid(); LS.set('authState', state);
    const p = new URLSearchParams({ client_id: C.CLIENT_ID, redirect_uri: C.REDIRECT_URI, response_type: 'token', scope: C.SCOPE, include_granted_scopes: 'true', state });
    const hint = LS.get('email'); if (hint) p.set('login_hint', hint);
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
  }
  function handleRedirect() {
    if (!location.hash || location.hash.length < 2) return;
    const h = new URLSearchParams(location.hash.slice(1));
    const tok = h.get('access_token'), state = h.get('state'), err = h.get('error');
    history.replaceState(null, '', location.pathname + location.search);
    if (err) { toast('Conectarea nu s-a făcut: ' + err); return; }
    if (tok && state && state === LS.get('authState')) {
      LS.set('token', { t: tok, exp: Date.now() + (Number(h.get('expires_in') || 3600) - 60) * 1000 }); LS.del('authState');
    }
  }
  const token = () => { const t = LS.get('token'); return t && t.exp > Date.now() ? t.t : null; };
  class AuthError extends Error {}
  async function api(url, opts = {}) {
    const t = token(); if (!t) throw new AuthError('fără token');
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
    if (r.status === 401) { LS.del('token'); throw new AuthError('token expirat'); }
    if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  const q = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const list = (query, fields = 'files(id,name,parents)') =>
    api(`${DRIVE}/files?${new URLSearchParams({ q: query, fields, pageSize: '1000', spaces: 'drive' })}`).then(r => r.files || []);

  // ---------- foldere ----------
  async function discoverFolders() {
    const found = {};
    for (const name of C.FOLDERS) {
      const f = await list(`name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`);
      if (f.length) found[name] = f[0].id;
    }
    LS.set('folders', found); return found;
  }
  async function ensureFolder(name, parentId) {
    const cache = LS.get('sub', {}), key = parentId + '/' + name;
    if (cache[key]) return cache[key];
    const f = await list(`'${q(parentId)}' in parents and name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`);
    const id = f.length ? f[0].id : (await api(`${DRIVE}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] })
    })).id;
    cache[key] = id; LS.set('sub', cache); return id;
  }
  async function monthFolder(rootName, base) {
    const root = (LS.get('folders', {}))[rootName];
    if (!root) throw new Error(`Folderul ${rootName} nu e ales.`);
    return ensureFolder(base.slice(4, 6), await ensureFolder(base.slice(0, 4), root));
  }

  // ---------- creare fișier (niciodată suprascriere) ----------
  async function createFile({ key, folderId, stem, ext, mime, content, props }) {
    const prev = await list(`appProperties has { key='jmKey' and value='${q(key)}' } and trashed=false`, 'files(id,name)');
    if (prev.length) return prev[0].name;                                   // deja urcat: nu dublăm
    const names = new Set((await list(`'${q(folderId)}' in parents and trashed=false`, 'files(name)')).map(f => f.name));
    let name = `${stem}.${ext}`, k = 2;
    while (names.has(name)) name = `${stem}_${k++}.${ext}`;
    const meta = { name, parents: [folderId], mimeType: mime, appProperties: { jmKey: key, ...props } };
    const b = 'jm' + uuid().replace(/-/g, '');
    const body = new Blob([
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${b}\r\nContent-Type: ${mime}${mime.startsWith('text/') || mime.includes('json') ? '; charset=UTF-8' : ''}\r\n\r\n`, content, `\r\n--${b}--`
    ], { type: `multipart/related; boundary=${b}` });
    return (await api(UPLOAD, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body })).name;
  }
  const propsOf = e => ({ jmCreatedAt: e.createdAt, jmForDate: e.forDate, jmForTime: e.forTime, jmRetro: e.retro ? '1' : '0' });

  async function upload(e) {
    if (e.kind === 'text') {
      const name = await createFile({ key: e.id, folderId: await monthFolder(C.TEXT_FOLDER, e.base), stem: e.base, ext: 'txt',
        mime: 'text/plain', content: e.text, props: propsOf(e) });
      return { fileName: name };
    }
    // date zilnice (+ fotografie)
    const stem = `${e.base}_${e.cat}`;
    let photoName = e.photoName || null;
    if (e.photo && !photoName) {
      photoName = await createFile({ key: e.id + ':foto', folderId: await monthFolder(PHOTO_FOLDER, e.base), stem, ext: 'jpg',
        mime: 'image/jpeg', content: e.photo, props: propsOf(e) });
      await DB.put({ ...e, photoName });
    }
    const doc = {
      schema: 1, id: e.id, categorie: e.cat, ziua: e.forDate, ora: e.forTime,
      salvat_la: e.createdAt, retroactiv: e.retro, valori: e.values, foto: photoName
    };
    const name = await createFile({ key: e.id, folderId: await monthFolder(DATA_FOLDER, e.base), stem, ext: 'json',
      mime: 'application/json', content: JSON.stringify(doc, null, 2), props: { ...propsOf(e), jmCat: e.cat } });
    return { fileName: name, photoName };
  }

  let syncing = false;
  async function sync() {
    if (syncing || !navigator.onLine || !token()) { renderStatus(); return; }
    const folders = LS.get('folders', {});
    if (!folders[C.TEXT_FOLDER]) { renderStatus(); return; }
    syncing = true; let n = 0;
    try {
      const pending = (await DB.all()).filter(e => e.status === 'local').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const e of pending) {
        const r = await upload(e);
        // după urcare, textul și fotografia nu mai sunt ținute pe telefon
        await DB.put({ ...e, text: null, photo: null, status: 'sync', ...r, syncedAt: isoLocal(new Date()) });
        n++;
      }
      if (n) toast(n === 1 ? 'Sincronizat în Drive' : `${n} intrări sincronizate în Drive`);
    } catch (err) {
      if (!(err instanceof AuthError)) { console.error(err); toast('Sincronizarea a eșuat. Reîncerc mai târziu.'); }
    } finally { syncing = false; renderAll(); }
  }

  // ---------- Google Picker ----------
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  async function pickFolders() {
    if (!token()) return startAuth();
    if (!window.gapi) await loadScript('https://apis.google.com/js/api.js');
    await new Promise(r => gapi.load('picker', r));
    const P = google.picker;
    const view = new P.DocsView(P.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME).setMode(P.DocsViewMode.LIST);
    new P.PickerBuilder().setTitle('Selectează cele 5 foldere din Aplicatie_jurnal_wellness')
      .addView(view).enableFeature(P.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token()).setDeveloperKey(C.API_KEY).setAppId(C.APP_ID)
      .setCallback(async d => {
        if (d.action === P.Action.PICKED) {
          await discoverFolders(); renderAll(); sync();
          const f = LS.get('folders', {}), lipsa = C.FOLDERS.filter(n => !f[n]);
          toast(lipsa.length ? 'Lipsesc: ' + lipsa.join(', ') : 'Folderele sunt conectate');
        }
      }).build().setVisible(true);
  }

  // ---------- configurare locală: stări și îngrijiri ----------
  const DEFAULT_MOODS = ['Nervoasă', 'Stresată', 'Îngrijorată', 'Veselă', 'Confuză'];
  const DEFAULT_CARE = [
    ['Cetaphil', 'Față · dimineața'], ['Allergica', 'Față · dimineața'], ['Vea Mix', 'Față · dimineața'],
    ['Cetaphil', 'Față · seara'], ['Vea Mix', 'Față · seara'], ['Allergica', 'Față · seara'],
    ['Vea Zinco', 'Axilă'], ['Deodorant', 'Axilă'], ['Săpun de Alep', 'Corp'], ['Șampon Crisia sau Ceramol', 'Scalp']
  ].map(([nume, cand], i) => ({ id: 'c' + (i + 1), nume, cand }));
  const moods = () => LS.get('moods', DEFAULT_MOODS);
  const care = () => LS.get('care', DEFAULT_CARE);
  const careGroup = c => /diminea/i.test(c.cand) ? 'Dimineața' : /seara/i.test(c.cand) ? 'Seara' : 'Restul zilei';
  const SYMPTOMS = ['Abundență', 'Balonare', 'Eczeme față', 'Eczeme scalp', 'Eczeme corp'];
  const WATER = [100, 250, 400, 500, 1000, 2000];
  const MEAS = [['greutate_kg', 'Greutate (kg)'], ['talie_cm', 'Talie (cm)'], ['bust_cm', 'Bust (cm)'], ['solduri_cm', 'Șolduri (cm)'],
    ['coapse_cm', 'Coapse (cm)'], ['brate_cm', 'Brațe (cm)'], ['fund_cm', 'Fund (cm)']];
  const fmtMl = ml => ml >= 1000 ? `${String(ml / 1000).replace('.', ',')} l` : `${ml} ml`;

  // ---------- categorii ----------
  const F = {};            // formularele în lucru (se golesc după salvare)
  const OPEN = new Set();  // categoriile deschise
  const CATS = [
    { id: 'masa', t: 'Ce am mâncat' }, { id: 'apa', t: 'Apă' }, { id: 'stare', t: 'Cum mă simt' },
    { id: 'ciclu', t: 'Ciclu menstrual' }, { id: 'miscare', t: 'Mișcare' }, { id: 'somn', t: 'Somn' },
    { id: 'ingrijire', t: 'Îngrijire' }, { id: 'masuratori', t: 'Măsurători' }, { id: 'insight', t: 'Insight' },
    { id: 'medical', t: 'Medical' }
  ];
  const form = id => F[id] || (F[id] = {});

  function starsW(value, onSet) {
    const w = el('div', { class: 'stars' });
    for (let i = 1; i <= 5; i++) w.append(el('button', { class: i <= (value || 0) ? 'on' : '', 'aria-label': `${i} din 5`, text: '★', onclick: () => onSet(value === i ? 0 : i) }));
    return w;
  }
  const field = (label, ...kids) => el('div', { class: 'field' }, el('span', { class: 'fl', text: label }), ...kids);
  function photoW(f, rerender) {
    const inp = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async ev => {
      const file = ev.target.files[0]; if (!file) return;
      try { f.photo = await shrink(file); f.photoUrl && URL.revokeObjectURL(f.photoUrl); f.photoUrl = URL.createObjectURL(f.photo); rerender(); }
      catch { toast('Fotografia nu a putut fi citită.'); }
    } });
    return el('div', { class: 'photo field' }, inp,
      f.photoUrl ? el('img', { src: f.photoUrl, alt: '' }) : null,
      el('button', { class: 'btn ghost small', text: f.photo ? 'Schimbă fotografia' : 'Adaugă fotografie', onclick: () => inp.click() }),
      f.photo ? el('button', { class: 'linkbtn', text: 'scoate', onclick: () => { f.photo = null; f.photoUrl = null; rerender(); } }) : null);
  }
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    } finally { URL.revokeObjectURL(url); }
  }

  // Fiecare categorie: body(f, rerender, saved) -> noduri; build(f) -> {values, photo} sau mesaj de eroare
  const DEF = {
    masa: {
      body: (f, rr) => [field('Ce ai mâncat', el('textarea', { class: 'small', placeholder: 'ex. omletă cu legume, o cafea', oninput: e => f.text = e.target.value }, f.text || '')), photoW(f, rr)],
      build: f => (f.text || '').trim() || f.photo ? { values: { text: f.text || '' }, photo: f.photo } : 'Scrie ce ai mâncat sau adaugă o fotografie.',
      sum: v => v.text ? v.text.replace(/\s+/g, ' ').slice(0, 40) : 'fotografie'
    },
    apa: {
      body: (f, rr, saved) => {
        const total = saved.reduce((s, e) => s + (e.values.ml || 0), 0);
        return [el('div', { class: 'waterbtns field' }, WATER.map(ml => el('button', { class: 'chip' + (f.ml === ml ? ' on' : ''), text: fmtMl(ml), onclick: () => { f.ml = f.ml === ml ? null : ml; rr(); } }))),
          el('div', { class: 'total', text: `Total salvat în ziua aceasta: ${fmtMl(total)}` })];
      },
      build: f => f.ml ? { values: { ml: f.ml } } : 'Alege cantitatea.',
      sum: v => fmtMl(v.ml)
    },
    stare: {
      body: (f, rr) => {
        f.sel = f.sel || {};
        const add = el('input', { class: 'in', placeholder: 'altă stare…' });
        return [
          el('div', { class: 'chips field' }, moods().map(m => el('button', { class: 'chip' + (m in f.sel ? ' on' : ''), text: m, onclick: () => { if (m in f.sel) delete f.sel[m]; else f.sel[m] = 0; rr(); } }))),
          el('div', { class: 'grid2 field' }, add, el('button', { class: 'btn ghost small', text: 'Adaugă', onclick: () => {
            const v = add.value.trim(); if (!v) return; const ms = moods(); if (!ms.includes(v)) LS.set('moods', [...ms, v]); f.sel[v] = 0; rr(); } })),
          Object.keys(f.sel).map(m => el('div', { class: 'starrow' }, el('span', { class: 'nm', text: m }), starsW(f.sel[m], v => { f.sel[m] = v; rr(); })))
        ];
      },
      build: f => {
        const s = Object.entries(f.sel || {});
        if (!s.length) return 'Alege cel puțin o stare.';
        if (s.some(([, v]) => !v)) return 'Dă stele fiecărei stări alese.';
        return { values: { stari: s.map(([nume, stele]) => ({ nume, stele })) } };
      },
      sum: v => v.stari.map(s => `${s.nume} ${s.stele}★`).join(', ')
    },
    ciclu: {
      body: (f, rr) => {
        f.sym = f.sym || {};
        return [field('Zi de ciclu', el('div', { class: 'seg' }, ['Da', 'Nu'].map(x => el('button', { class: f.zi === x ? 'on' : '', text: x, onclick: () => { f.zi = x; rr(); } })))),
          f.zi === 'Da' ? el('div', { class: 'field' }, SYMPTOMS.map(s => el('div', { class: 'starrow' }, el('span', { class: 'nm', text: s }), starsW(f.sym[s], v => { f.sym[s] = v; rr(); })))) : null];
      },
      build: f => {
        if (!f.zi) return 'Alege Da sau Nu.';
        const simptome = {}; if (f.zi === 'Da') for (const [k, v] of Object.entries(f.sym || {})) if (v) simptome[k] = v;
        return { values: { zi_de_ciclu: f.zi, simptome } };
      },
      sum: v => v.zi_de_ciclu === 'Da' ? `Da${v.simptome['Abundență'] ? ' · abundență ' + v.simptome['Abundență'] + '★' : ''}` : 'Nu'
    },
    miscare: {
      body: f => [
        el('label', { class: 'check' + (f.mers ? ' on' : ''), onclick: e => { e.preventDefault(); f.mers = !f.mers; renderCats(); } },
          el('span', { class: 'box', text: f.mers ? '✓' : '' }), el('span', { class: 'nm', text: 'Am mers pe jos' })),
        field('Număr de pași (opțional)', el('input', { class: 'in', type: 'number', inputmode: 'numeric', min: 0, value: f.pasi || '', oninput: e => f.pasi = e.target.value })),
        field('Mișcare intensă (tipul)', el('input', { class: 'in', placeholder: 'ex. pilates, alergare, sală', value: f.intensa || '', oninput: e => f.intensa = e.target.value }))
      ],
      build: f => {
        const pasi = parseInt(f.pasi, 10), intensa = (f.intensa || '').trim();
        if (!f.mers && !pasi && !intensa) return 'Completează mersul pe jos sau mișcarea intensă.';
        return { values: { mers_pe_jos: !!(f.mers || pasi), pasi: pasi || null, intensa: intensa || null } };
      },
      sum: v => [v.mers_pe_jos ? 'Mers pe jos' + (v.pasi ? ` · ${v.pasi.toLocaleString('ro-RO')} pași` : '') : null, v.intensa].filter(Boolean).join(' · ')
    },
    somn: {
      body: (f, rr) => [
        el('div', { class: 'grid2' },
          field('Ora de culcare', el('input', { class: 'in', type: 'time', value: f.culcare || '', oninput: e => f.culcare = e.target.value })),
          field('Ora de trezire', el('input', { class: 'in', type: 'time', value: f.trezire || '', oninput: e => f.trezire = e.target.value }))),
        el('div', { class: 'starrow field' }, el('span', { class: 'nm', text: 'Calitatea somnului' }), starsW(f.calitate, v => { f.calitate = v; rr(); }))
      ],
      build: f => (f.culcare || f.trezire || f.calitate) ? { values: { culcare: f.culcare || null, trezire: f.trezire || null, calitate: f.calitate || null } } : 'Completează cel puțin un câmp.',
      sum: v => [v.culcare && v.trezire ? `${v.culcare}–${v.trezire}` : (v.culcare || v.trezire), v.calitate ? v.calitate + '★' : null].filter(Boolean).join(' · ')
    },
    ingrijire: {
      body: (f, rr, saved) => {
        f.tick = f.tick || {};
        const done = new Set(saved.flatMap(e => e.values.bifate.map(b => b.id)));
        const groups = ['Dimineața', 'Seara', 'Restul zilei'];
        return groups.map(g => {
          const items = care().filter(c => careGroup(c) === g); if (!items.length) return null;
          return [el('div', { class: 'grp', text: g }), items.map(c => {
            const locked = done.has(c.id), on = locked || f.tick[c.id];
            return el('div', { class: 'check' + (locked ? ' locked' : on ? ' on' : ''), onclick: () => { if (locked) return; f.tick[c.id] = !f.tick[c.id]; rr(); } },
              el('span', { class: 'box', text: on ? '✓' : '' }), el('span', { class: 'nm', text: c.nume }), el('span', { class: 'ds', text: c.cand }));
          })];
        });
      },
      build: (f, saved) => {
        const done = new Set(saved.flatMap(e => e.values.bifate.map(b => b.id)));
        const bifate = care().filter(c => f.tick && f.tick[c.id] && !done.has(c.id)).map(c => ({ id: c.id, nume: c.nume, cand: c.cand }));
        return bifate.length ? { values: { bifate, total_lista: care().length } } : 'Bifează cel puțin o îngrijire nouă.';
      },
      sum: v => `${v.bifate.length} bifate`
    },
    masuratori: {
      body: f => [el('div', { class: 'grid2' }, MEAS.map(([k, l]) => field(l, el('input', { class: 'in', type: 'number', inputmode: 'decimal', step: '0.1', min: 0, value: f[k] || '', oninput: e => f[k] = e.target.value }))))],
      build: f => {
        const v = {}; for (const [k] of MEAS) { const n = parseFloat(String(f[k] || '').replace(',', '.')); if (n > 0) v[k] = n; }
        return Object.keys(v).length ? { values: v } : 'Completează cel puțin o măsurătoare.';
      },
      sum: v => MEAS.filter(([k]) => v[k]).map(([k, l]) => `${l.split(' ')[0]} ${String(v[k]).replace('.', ',')}`).join(' · ')
    },
    insight: {
      body: (f, rr) => [field('Ce ai observat', el('textarea', { class: 'small', placeholder: 'o idee, o observație…', oninput: e => f.text = e.target.value }, f.text || '')), photoW(f, rr)],
      build: f => (f.text || '').trim() || f.photo ? { values: { text: f.text || '' }, photo: f.photo } : 'Scrie ceva sau adaugă o fotografie.',
      sum: v => v.text ? v.text.replace(/\s+/g, ' ').slice(0, 40) : 'fotografie'
    },
    medical: {
      body: f => [
        field('Tip', el('select', { class: 'in', onchange: e => f.tip = e.target.value },
          ['', 'Programare', 'Consultație', 'Rezultat'].map(x => el('option', { value: x, selected: f.tip === x, text: x || '— alege —' })))),
        el('div', { class: 'grid2' },
          field('Data', el('input', { class: 'in', type: 'date', value: f.data || '', oninput: e => f.data = e.target.value })),
          field('Ora', el('input', { class: 'in', type: 'time', value: f.ora || '', oninput: e => f.ora = e.target.value }))),
        field('Medic sau specialitate', el('input', { class: 'in', placeholder: 'ex. dermatolog', value: f.medic || '', oninput: e => f.medic = e.target.value })),
        field('Motiv sau notă', el('textarea', { class: 'small', placeholder: 'motivul vizitei, rezultatul…', oninput: e => f.nota = e.target.value }, f.nota || ''))
      ],
      build: f => {
        if (!f.tip) return 'Alege tipul.';
        if (!f.data && !(f.medic || '').trim() && !(f.nota || '').trim()) return 'Completează data, medicul sau o notă.';
        return { values: { tip: f.tip, data: f.data || null, ora: f.ora || null, medic: (f.medic || '').trim() || null, nota: f.nota || null } };
      },
      sum: v => [v.tip, v.medic, v.data ? v.data.split('-').reverse().join('.') : null].filter(Boolean).join(' · ')
    }
  };

  let ENTRIES = [];
  const savedFor = (cat, day = S.day) => ENTRIES.filter(e => e.kind === 'data' && e.cat === cat && e.forDate === day)
    .sort((a, b) => (a.forTime + a.createdAt).localeCompare(b.forTime + b.createdAt));
  function cycleActive() {
    const c = ENTRIES.filter(e => e.kind === 'data' && e.cat === 'ciclu').sort((a, b) => (a.forDate + a.forTime + a.createdAt).localeCompare(b.forDate + b.forTime + b.createdAt));
    return c.length > 0 && c[c.length - 1].values.zi_de_ciclu === 'Da';
  }

  function renderCats() {
    const box = $('cats'); box.innerHTML = '';
    const hl = cycleActive();
    const order = hl ? [CATS.find(c => c.id === 'ciclu'), ...CATS.filter(c => c.id !== 'ciclu')] : CATS;
    for (const c of order) {
      const saved = savedFor(c.id), open = OPEN.has(c.id), f = form(c.id), d = DEF[c.id];
      const rr = () => renderCats();
      const errBox = el('div', { class: 'err', hidden: true });
      const section = el('div', { class: 'cat' + (c.id === 'ciclu' && hl ? ' hl' : '') },
        el('button', { class: 'head', onclick: () => { open ? OPEN.delete(c.id) : OPEN.add(c.id); renderCats(); } },
          el('span', { class: 't', text: c.t }), saved.length ? el('span', { class: 's', text: `✓ ${saved.length}` }) : null,
          el('span', { class: 'chev', text: open ? '–' : '+' })));
      if (open) {
        section.append(el('div', { class: 'body' },
          d.body(f, rr, saved),
          errBox,
          el('div', { class: 'row' }, el('button', { class: 'btn wide', text: 'Salvează', onclick: async ev => {
            const r = d.build(f, saved);
            if (typeof r === 'string') { errBox.textContent = r; errBox.hidden = false; return; }
            ev.target.disabled = true;
            const st = stamp();
            await DB.put({ id: uuid(), kind: 'data', cat: c.id, ...st, base: baseOf(st.forDate, st.forTime), values: r.values, photo: r.photo || null, status: 'local' });
            if (f.photoUrl) URL.revokeObjectURL(f.photoUrl);
            delete F[c.id];
            toast(navigator.onLine && token() ? 'Salvat. Se urcă în Drive…' : 'Salvat pe telefon. Urcă automat mai târziu.');
            await renderAll(); sync();
          } })),
          saved.length ? el('div', { class: 'saved' }, el('b', { text: 'Salvat: ' }),
            saved.map(e => `${e.forTime} · ${d.sum(e.values)}`).join('  |  ')) : null));
      }
      box.append(section);
    }
  }

  // ---------- interfață generală ----------
  let toastT;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }

  function renderDay() {
    const today = todayStr();
    $('day').max = today;
    if ($('day').value !== S.day) $('day').value = S.day;
    $('dayName').textContent = fmtDay(S.day) + (isToday() ? ' · azi' : '');
    $('time').hidden = isToday(); $('todayBtn').hidden = isToday();
    if (!isToday() && !S.time) { S.time = '21:00'; }
    if ($('time').value !== S.time && !isToday()) $('time').value = S.time;
    const r = $('retroNote');
    r.hidden = isToday();
    r.textContent = isToday() ? '' : `Completezi pentru ${fmtDay(S.day)}, ora ${S.time}. Ce salvezi acum primește această dată; momentul real al scrierii se păstrează separat.`;
    $('saveBtn').textContent = isToday() ? 'Salvează textul' : `Salvează textul pentru ${S.day.split('-').reverse().slice(0, 2).join('.')}`;
  }

  function renderStatus() {
    const tok = !!token(), everConnected = !!LS.get('connected'), folders = LS.get('folders', {});
    const pending = ENTRIES.filter(e => e.status === 'local').length;
    $('connectBanner').hidden = tok || everConnected;
    $('reconnectBanner').hidden = tok || !everConnected || !navigator.onLine;
    $('foldersBanner').hidden = !tok || !!folders[C.TEXT_FOLDER];
    const dot = $('dot');
    if (!navigator.onLine) { dot.className = 'dot warn'; $('statusText').textContent = 'Fără internet'; }
    else if (!tok) { dot.className = 'dot warn'; $('statusText').textContent = 'Neconectat'; }
    else if (pending) { dot.className = 'dot warn'; $('statusText').textContent = `${pending} de urcat`; }
    else { dot.className = 'dot ok'; $('statusText').textContent = 'Sincronizat'; }
  }

  function renderList() {
    const today = todayStr();
    const ul = $('list'); ul.innerHTML = '';
    const all = [...ENTRIES].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!all.length) ul.innerHTML = '<li class="empty">Încă nicio intrare.</li>';
    for (const e of all.slice(0, 25)) {
      const day = e.forDate === today ? '' : e.forDate.slice(8, 10) + '.' + e.forDate.slice(5, 7) + ' ';
      const label = e.kind === 'text'
        ? (e.status === 'sync' ? e.fileName : (e.text || '').replace(/\s+/g, ' '))
        : `${(CATS.find(c => c.id === e.cat) || {}).t} · ${DEF[e.cat].sum(e.values)}`;
      ul.append(el('li', {}, el('span', { class: 't', text: day + e.forTime }), el('span', { class: 'n', text: label }),
        el('span', { class: 's ' + (e.status === 'sync' ? 'sync' : 'local'), text: e.status === 'sync' ? 'sincronizat' : 'salvat local' })));
    }
  }

  function renderSettings() {
    const folders = LS.get('folders', {});
    $('folderList').innerHTML = C.FOLDERS.map(n => `<li class="${folders[n] ? 'y' : 'x'}">${folders[n] ? '✓' : '○'} ${n}</li>`).join('');
    const cl = $('careList'); cl.innerHTML = '';
    for (const c of care()) cl.append(el('li', {}, el('span', { text: `${c.nume} · ${c.cand}` }),
      el('button', { class: 'linkbtn', text: 'scoate din listă', onclick: () => { LS.set('care', care().filter(x => x.id !== c.id)); renderAll(); } })));
    const em = LS.get('email'); $('acct').textContent = em ? `Cont Google: ${em}` : '';
    $('ver').textContent = C.VERSION;
  }

  async function renderAll() {
    ENTRIES = await DB.all();
    renderDay(); renderStatus(); renderCats(); renderList(); renderSettings();
  }

  async function saveText() {
    const ta = $('entry'), text = ta.value;
    if (!text.trim()) return;
    $('saveBtn').disabled = true;
    const st = stamp();
    await DB.put({ id: uuid(), kind: 'text', ...st, base: baseOf(st.forDate, st.forTime), text, status: 'local' });
    ta.value = ''; LS.del('draft'); updateCount();
    toast(navigator.onLine && token() ? 'Salvat. Se urcă în Drive…' : 'Salvat pe telefon. Urcă automat mai târziu.');
    await renderAll(); sync();
  }
  function updateCount() {
    const v = $('entry').value; $('saveBtn').disabled = !v.trim();
    const w = v.trim() ? v.trim().split(/\s+/).length : 0;
    $('count').textContent = w ? `${w} ${w === 1 ? 'cuvânt' : 'cuvinte'}` : '';
  }

  async function afterLogin() {
    if (!token()) return;
    LS.set('connected', true);
    try {
      const a = await api(`${DRIVE}/about?fields=user(emailAddress)`);
      if (a.user && a.user.emailAddress) LS.set('email', a.user.emailAddress);
      const f = LS.get('folders', {});
      if (C.FOLDERS.some(n => !f[n])) await discoverFolders();
    } catch (e) { if (!(e instanceof AuthError)) console.error(e); }
  }

  // migrare: intrările din v1.0 (doar text) primesc câmpurile noi
  async function migrate() {
    for (const e of await DB.all()) {
      if (e.kind) continue;
      const fd = `${e.base.slice(0, 4)}-${e.base.slice(4, 6)}-${e.base.slice(6, 8)}`, ft = `${e.base.slice(9, 11)}:${e.base.slice(12, 14)}`;
      await DB.put({ ...e, kind: 'text', forDate: fd, forTime: ft, retro: false });
    }
  }

  async function init() {
    handleRedirect();
    await migrate();
    const ta = $('entry');
    ta.value = LS.get('draft', '') || '';
    ta.addEventListener('input', () => { LS.set('draft', ta.value); updateCount(); });
    updateCount();
    $('day').addEventListener('change', e => {
      const v = e.target.value; const t = todayStr();
      if (!v || v > t) { toast('Poți alege doar azi sau o zi din urmă.'); S.day = t; } else S.day = v;
      if (!isToday() && !S.time) S.time = '21:00';
      renderAll();
    });
    $('time').addEventListener('change', e => { S.time = e.target.value || '21:00'; renderDay(); });
    $('todayBtn').onclick = () => { S.day = todayStr(); S.time = ''; renderAll(); };
    $('saveBtn').onclick = saveText;
    $('connectBtn').onclick = startAuth; $('reconnectBtn').onclick = startAuth;
    $('pickBtn').onclick = pickFolders; $('pickBtn2').onclick = pickFolders;
    $('syncBtn').onclick = () => token() ? sync() : startAuth();
    $('careAdd').onclick = () => {
      const n = $('careName').value.trim(), d = $('careDose').value.trim(); if (!n) return;
      LS.set('care', [...care(), { id: 'c' + Date.now(), nume: n, cand: d }]);
      $('careName').value = ''; $('careDose').value = ''; renderAll();
    };
    addEventListener('online', sync); addEventListener('offline', renderStatus);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (S.day > todayStr()) S.day = todayStr(); sync(); } });
    await afterLogin();
    await renderAll();
    sync();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
