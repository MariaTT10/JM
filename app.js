/* Jurnalul Meu – aplicația de pe iPhone (E2: textul original)
 * Reguli:
 *  - Textul se salvează exact cum a fost introdus, într-un .txt (UTF-8, fără BOM),
 *    numit AAAALLZZ_HH_MM.txt (al doilea din același minut: _2, apoi _3 …),
 *    în 01_Text_original/AAAA/LL/.
 *  - Ora este ora apăsării pe „Salvează”, de pe telefon.
 *  - Fără internet, intrarea rămâne pe telefon și urcă automat mai târziu.
 *  - Aplicația doar CREEAZĂ fișiere. Nu modifică și nu șterge nimic, niciodată.
 */
(() => {
  'use strict';
  const C = window.JM_CONFIG;
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const $ = id => document.getElementById(id);

  // ---------- stocare locală ----------
  const LS = {
    get(k, d = null) { try { const v = localStorage.getItem('jm.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('jm.' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('jm.' + k); } catch {} }
  };

  // Coada de intrări: IndexedDB (rezistă mai bine decât localStorage)
  const DB = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('jm', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('entries', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('entries', mode);
        const st = t.objectStore('entries');
        const out = fn(st);
        t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
        t.onerror = () => rej(t.error);
      });
    };
    return {
      put: e => tx('readwrite', st => st.put(e)),
      all: () => tx('readonly', st => st.getAll())
    };
  })();

  // ---------- timp și nume de fișier ----------
  const pad = n => String(n).padStart(2, '0');
  function isoLocal(d) {
    const off = -d.getTimezoneOffset(), s = off >= 0 ? '+' : '-', a = Math.abs(off);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${s}${pad(a / 60 | 0)}:${pad(a % 60)}`;
  }
  const baseName = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}`;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

  // ---------- autentificare Google (redirect, potrivit pentru aplicații pe ecranul principal) ----------
  function startAuth() {
    const state = uuid();
    LS.set('authState', state);
    const p = new URLSearchParams({
      client_id: C.CLIENT_ID, redirect_uri: C.REDIRECT_URI, response_type: 'token',
      scope: C.SCOPE, include_granted_scopes: 'true', state
    });
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
      LS.set('token', { t: tok, exp: Date.now() + (Number(h.get('expires_in') || 3600) - 60) * 1000 });
      LS.del('authState');
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
    LS.set('folders', found);
    return found;
  }
  async function ensureFolder(name, parentId) {
    const cache = LS.get('sub', {}), key = parentId + '/' + name;
    if (cache[key]) return cache[key];
    const f = await list(`'${q(parentId)}' in parents and name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`);
    const id = f.length ? f[0].id : (await api(`${DRIVE}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] })
    })).id;
    cache[key] = id; LS.set('sub', cache);
    return id;
  }

  // ---------- încărcarea unei intrări (doar creare, niciodată suprascriere) ----------
  async function upload(e) {
    // 1. A fost deja încărcată (de ex. răspunsul s-a pierdut)? Nu o dublăm.
    const prev = await list(`appProperties has { key='jmEntryId' and value='${q(e.id)}' } and trashed=false`, 'files(id,name)');
    if (prev.length) return prev[0].name;

    const root = (LS.get('folders', {}))[C.TEXT_FOLDER];
    if (!root) throw new Error('Folderul 01_Text_original nu e ales.');
    const [Y, M] = [e.base.slice(0, 4), e.base.slice(4, 6)];
    const monthId = await ensureFolder(M, await ensureFolder(Y, root));

    // 2. Primul nume liber: AAAALLZZ_HH_MM.txt, apoi _2, _3 …
    const names = new Set((await list(`'${q(monthId)}' in parents and trashed=false`, 'files(name)')).map(f => f.name));
    let name = e.base + '.txt', k = 2;
    while (names.has(name)) name = `${e.base}_${k++}.txt`;

    // 3. Creare fișier text, conținut identic cu ce s-a scris
    const meta = { name, parents: [monthId], mimeType: 'text/plain', appProperties: { jmEntryId: e.id, jmCreatedAt: e.createdAt } };
    const b = 'jm' + uuid().replace(/-/g, '');
    const body = new Blob([
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${b}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n`, e.text, `\r\n--${b}--`
    ], { type: `multipart/related; boundary=${b}` });
    const r = await api(UPLOAD, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
    return r.name;
  }

  let syncing = false;
  async function sync() {
    if (syncing || !navigator.onLine || !token()) { render(); return; }
    const folders = LS.get('folders', {});
    if (!folders[C.TEXT_FOLDER]) { render(); return; }
    syncing = true;
    let n = 0;
    try {
      const pending = (await DB.all()).filter(e => e.status === 'local').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const e of pending) {
        const name = await upload(e);
        // după urcare, textul nu mai e ținut pe telefon; rămâne doar în Drive
        await DB.put({ ...e, text: null, status: 'sync', fileName: name, syncedAt: isoLocal(new Date()) });
        n++;
      }
      if (n) toast(n === 1 ? 'Sincronizat în Drive' : `${n} intrări sincronizate în Drive`);
    } catch (err) {
      if (!(err instanceof AuthError)) { console.error(err); toast('Sincronizarea a eșuat. Reîncerc mai târziu.'); }
    } finally { syncing = false; render(); }
  }

  // ---------- Google Picker (alegerea folderelor, o singură dată) ----------
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  async function pickFolders() {
    if (!token()) return startAuth();
    if (!window.gapi) await loadScript('https://apis.google.com/js/api.js');
    await new Promise(r => gapi.load('picker', r));
    const P = google.picker;
    const view = new P.DocsView(P.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME).setMode(P.DocsViewMode.LIST);
    new P.PickerBuilder()
      .setTitle('Selectează cele 5 foldere din Aplicatie_jurnal_wellness')
      .addView(view).enableFeature(P.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token()).setDeveloperKey(C.API_KEY).setAppId(C.APP_ID)
      .setCallback(async d => {
        if (d.action === P.Action.PICKED) {
          await discoverFolders(); render(); sync();
          const f = LS.get('folders', {}), lipsa = C.FOLDERS.filter(n => !f[n]);
          toast(lipsa.length ? 'Lipsesc: ' + lipsa.join(', ') : 'Folderele sunt conectate');
        }
      }).build().setVisible(true);
  }

  // ---------- interfață ----------
  let toastT;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }

  const ZILE = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'];
  const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
  const fmtDay = d => `${ZILE[d.getDay()]}, ${d.getDate()} ${LUNI[d.getMonth()]} ${d.getFullYear()}`;

  async function render() {
    $('today').textContent = fmtDay(new Date());
    const tok = !!token(), everConnected = !!LS.get('connected'), folders = LS.get('folders', {});
    const all = (await DB.all()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const pending = all.filter(e => e.status === 'local').length;

    $('connectBanner').hidden = tok || everConnected;
    $('reconnectBanner').hidden = tok || !everConnected || !navigator.onLine;
    $('foldersBanner').hidden = !tok || !!folders[C.TEXT_FOLDER];

    const dot = $('dot');
    if (!navigator.onLine) { dot.className = 'dot warn'; $('statusText').textContent = 'Fără internet'; }
    else if (!tok) { dot.className = 'dot warn'; $('statusText').textContent = 'Neconectat'; }
    else if (pending) { dot.className = 'dot warn'; $('statusText').textContent = `${pending} de urcat`; }
    else { dot.className = 'dot ok'; $('statusText').textContent = 'Sincronizat'; }

    const today = baseName(new Date()).slice(0, 8);
    const ul = $('list'); ul.innerHTML = '';
    if (!all.length) ul.innerHTML = '<li class="empty">Încă nicio intrare.</li>';
    for (const e of all.slice(0, 20)) {
      const li = document.createElement('li');
      const hh = e.base.slice(9, 11) + ':' + e.base.slice(12, 14);
      const day = e.base.slice(0, 8) === today ? '' : `${e.base.slice(6, 8)}.${e.base.slice(4, 6)} `;
      li.innerHTML = `<span class="t"></span><span class="n"></span><span class="s ${e.status === 'sync' ? 'sync' : 'local'}"></span>`;
      li.children[0].textContent = day + hh;
      li.children[1].textContent = e.status === 'sync' ? e.fileName : (e.text || '').replace(/\s+/g, ' ');
      li.children[2].textContent = e.status === 'sync' ? 'sincronizat' : 'salvat local';
      ul.appendChild(li);
    }

    $('folderList').innerHTML = C.FOLDERS.map(n =>
      `<li class="${folders[n] ? 'y' : 'x'}">${folders[n] ? '✓' : '○'} ${n}</li>`).join('');
    const em = LS.get('email');
    $('acct').textContent = em ? `Cont Google: ${em}` : '';
    $('ver').textContent = C.VERSION;
  }

  async function save() {
    const ta = $('entry'), text = ta.value;
    if (!text.trim()) return;
    $('saveBtn').disabled = true;
    const d = new Date();
    await DB.put({ id: uuid(), text, createdAt: isoLocal(d), base: baseName(d), status: 'local' });
    ta.value = ''; LS.del('draft'); updateCount();
    toast(navigator.onLine && token() ? 'Salvat. Se urcă în Drive…' : 'Salvat pe telefon. Urcă automat mai târziu.');
    await render(); sync();
  }

  function updateCount() {
    const v = $('entry').value;
    $('saveBtn').disabled = !v.trim();
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
      if (!f[C.TEXT_FOLDER]) await discoverFolders();
    } catch (e) { if (!(e instanceof AuthError)) console.error(e); }
  }

  // ---------- pornire ----------
  async function init() {
    handleRedirect();
    const ta = $('entry');
    ta.value = LS.get('draft', '') || '';
    ta.addEventListener('input', () => { LS.set('draft', ta.value); updateCount(); });
    updateCount();
    $('saveBtn').onclick = save;
    $('connectBtn').onclick = startAuth;
    $('reconnectBtn').onclick = startAuth;
    $('pickBtn').onclick = pickFolders;
    $('pickBtn2').onclick = pickFolders;
    $('syncBtn').onclick = () => token() ? sync() : startAuth();
    addEventListener('online', sync);
    addEventListener('offline', render);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    await afterLogin();
    await render();
    sync();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
