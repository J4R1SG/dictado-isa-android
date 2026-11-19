/* Neo Records para el teléfono. La pantalla nunca habla con la red: todo pasa por el puente NeoBridge
   (lo pone la app de Android; en las pruebas lo pone un puente de mentira antes de cargar este archivo).
   Sin librerías, sin CDN, sin scripts en línea (CSP: default-src 'self'). */
(function () {
'use strict';

const CFG = Object.assign({ job: 1200, cola: 2000, hoy: 2500, buscar: 1400, toast: 3500, transcribiendo: 60000, manual: 5000 }, window.NeoUIConfig || {});

// ---------------------------------------------------------------- utilidades
const $ = (s) => document.querySelector(s);
// Una hoja nueva no hace caso a los toques de los primeros instantes: un segundo toque rápido en el mismo lugar caía en el botón de la hoja sin que se leyera.
const SHEET_GUARD = () => (typeof CFG.sheetGuard === 'number' ? CFG.sheetGuard : (navigator.webdriver ? 0 : 450));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
const MSG_FALLA = 'Algo falló. Intenta otra vez.';
const MSG_NOAPP = 'Esta pantalla solo funciona dentro de la app Neo Records.';
const MSG_EDITANDO = 'Primero toca «Listo» o «Cancelar» en la tarjeta que estás editando.';
const MSG_GUARDANDO = 'Espera: esa parte se está guardando en Neo.';
const MSG_RED = 'La computadora no contestó. Revisa que esté prendida y que el teléfono esté en el wifi de la clínica.';

const ICONS = {
  back: '<path d="M15 6l-6 6 6 6"/>', next: '<path d="M9 6l6 6-6 6"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>', mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', kbd: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A9.6 9.6 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 004.2 4.2"/>',
  alert: '<path d="M12 3l10 18H2L12 3zM12 10v5M12 18h.01"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  circle: '<circle cx="12" cy="12" r="8"/>', cart: '<path d="M3 4h2l2.4 11h10.2L20 7H6.2"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 018-2.7A4.5 4.5 0 0120 9c0 6-8 11-8 11z"/>',
  note: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7"/>', send: '<path d="M4 12l16-8-6 16-3-7-7-1z"/>', doc: '<path d="M6 3h9l4 4v14H6zM14 3v5h5"/>',
  chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>', up: '<path d="M6 15l6-6 6 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', pin: '<path d="M12 16v6M8 3h8l-1 6 4 4v3H5v-3l4-4-1-6z"/>', wifi: '<path d="M2 9a15 15 0 0120 0M5 13a10 10 0 0114 0M8.5 16.5a5 5 0 017 0M12 20h.01"/>',
};
const ic = (n) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';
const PAW = '<svg class="paw" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="20" r="6"/><circle cx="9" cy="12" r="3"/><circle cx="14" cy="8" r="3"/><circle cx="19" cy="8" r="3"/><circle cx="24" cy="12" r="3"/></svg>';
const spin = (cls) => '<span class="spin' + (cls ? ' ' + cls : '') + '" aria-hidden="true"></span>';
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const p2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '-' + d.getFullYear();
const sameDay = (a, b) => dayKey(a) === dayKey(b);
function dayLabel(d) { return DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()]; }
function daySub(d) {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  const x = new Date(d); x.setHours(12, 0, 0, 0);
  const diff = Math.round((x - t) / 864e5);
  return diff === 0 ? 'Hoy' : diff === -1 ? 'Ayer' : diff === 1 ? 'Mañana' : String(d.getFullYear());
}
const SPECIES = { Canine: 'Perro', Feline: 'Gato' };
const speciesEs = (s) => SPECIES[s] || s || '';
const ESTADOS = { 'sin nota': ['Sin nota', 'sin'], 'nota escrita': ['Nota escrita', 'nota'], soap: ['SOAP', 'soap'], cirugia: ['Cirugía', 'cx'], guardada: ['Guardada', 'ok'] };
const tagOf = (s) => STATUS_TAG[s] || [s || '', ''];
const FINAL = { guardada: 1, 'sin cambios': 1, error: 1 };
const STATUS_TAG = { 'en cola': ['En cola', ''], 'esperando Neo': ['Esperando a Neo', 'amber'], guardando: ['Guardando…', 'pen'], guardada: ['Guardada', 'ok'], 'sin cambios': ['Sin cambios', ''], error: ['Error', 'red'] };
// Mismas reglas y misma lista que la app de Android (PasswordPolicy.kt) y la PC (cuentas.politica_clave); la PC decide.
// Las palabras propias de la clínica van como SHA-256 para que este código público no las deletree.
const COMMON = new Set(['password', 'password1', 'password123', 'passw0rd', '12345678', '123456789', '1234567890', '123456789a',
  '11111111', '00000000', '87654321', '12341234', 'qwertyui', 'qwerty123', 'qwerty12', 'asdfghjk', 'abcd1234',
  'abc12345', 'iloveyou', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'trustno1', 'welcome1',
  'admin123', 'administrator', 'letmein1', 'contraseña', 'contrasena', 'contraseña1', 'contrasena1',
  'micontraseña', 'clave123', 'clave1234', '12345678a', 'a1234567', 'veterinaria', 'veterinario', 'clinica1',
  'clinica123', 'neorecords', 'idexxneo', 'doctor123', 'doctora1',
  'perro123', 'gato1234', 'mascota1', 'q1w2e3r4', '1q2w3e4r', 'zaq12wsx', 'changeme', 'cambiame', 'temporal']);
const COMMON_SHA256 = new Set(['a1e5109600fbf93c1f8ac9a9c6629737eea67e2294dfd596f9fe43a96b986a09',
  '46e2439f98242057aa479c4410e406518339a21396165754b98765d63cd789a8', '6b9f6ffd19b3c60f1258a0d9b9251b182ae097033b8138f6b83705b80c4d9bb8']);
const SHA_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
function sha256hex(text) {
  const m = new TextEncoder().encode(text), n = m.length;
  const w = new Uint8Array(((n + 9 + 63) >> 6) << 6);
  w.set(m); w[n] = 0x80;
  const dv = new DataView(w.buffer);
  dv.setUint32(w.length - 8, Math.floor((n * 8) / 4294967296)); dv.setUint32(w.length - 4, (n * 8) >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const r = (x, k) => (x >>> k) | (x << (32 - k));
  const x = new Array(64);
  for (let o = 0; o < w.length; o += 64) {
    for (let i = 0; i < 16; i++) x[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = r(x[i - 15], 7) ^ r(x[i - 15], 18) ^ (x[i - 15] >>> 3), s1 = r(x[i - 2], 17) ^ r(x[i - 2], 19) ^ (x[i - 2] >>> 10);
      x[i] = (x[i - 16] + s0 + x[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + x[i]) | 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}
const isCommon = (low) => COMMON.has(low) || COMMON_SHA256.has(sha256hex(low));

function mkErr(msg, status) { const e = new Error(msg || MSG_FALLA); e.status = status; return e; }
// Mensajes de la PC con palabras que la doctora no puede usar («actualiza la app», «PC principal») se dicen más simple.
const MSG_CIERRA = 'Cierra y abre la app. Si sigue igual, avisa a quien se encarga de Neo Records.';
const MSG_OTRA = 'La computadora de la clínica cambió. Si cambiaron la computadora o reinstalaron Neo Records, toca «Olvidar esta computadora».';
const MSG_NO_ES = 'Esa no es la computadora de la clínica. Busca otra vez. Solo si cambiaron la computadora o reinstalaron Neo Records, toca «Olvidar esta computadora».';
const errText = (e) => (e && (e.status === 495 || /certificado distinto/i.test(e.message || ''))) ? MSG_OTRA : String((e && e.message) || MSG_FALLA).replace(/Actualiza la app\.?/gi, MSG_CIERRA).replace(/\bLa PC principal\b/g, 'La computadora').replace(/\bla PC principal\b/g, 'la computadora');

// ---------------------------------------------------------------- puente con la app de Android
let seq = 0;
const pend = new Map();
let hooked = null;
function onBridge(ev) {
  let d = ev && ev.data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
  if (!d || typeof d !== 'object') return;
  if (d.event) { onEvent(d.event, d.data); return; }
  const p = pend.get(d.id);
  if (!p) return;
  pend.delete(d.id);
  clearTimeout(p.t);
  if (d.ok) p.res(d.data); else p.rej(mkErr(d.error, d.status));
}
function call(op, args, ms) {
  return new Promise((res, rej) => {
    const b = window.NeoBridge;
    if (!b || typeof b.postMessage !== 'function') { rej(mkErr(MSG_NOAPP)); return; }
    if (hooked !== b) { b.onmessage = onBridge; hooked = b; }
    const id = ++seq;
    const t = setTimeout(() => { pend.delete(id); rej(mkErr(MSG_RED)); }, ms || 40000);
    pend.set(id, { res, rej, t });
    try { b.postMessage(JSON.stringify({ id, op, args: args || {} })); } catch (e) { pend.delete(id); clearTimeout(t); rej(mkErr(MSG_FALLA)); }
  });
}
// Llamada a la API de la PC. Si falla, se revisa si la sesión sigue viva (el puente no manda el código HTTP).
async function api(method, path, body) {
  const a = { method, path };
  if (body !== undefined) a.body = body;
  try {
    return await call('api', a, 40000);
  } catch (e) {
    if (S.user && S.screen !== 'entrar') await checkSession(e);
    throw e;
  }
}
async function checkSession(e) {
  let alive = true;
  if (e && e.status === 401) alive = false;
  else {
    try { alive = !!(await call('me', {}, 8000)); } catch (x) { alive = true; }   // sin respuesta: no se cierra la sesión
  }
  if (!alive) { e.handled = true; sessionLost(); }
}
function sessionLost() {
  if (S.screen === 'entrar') return;
  stashNota();                                    // lo escrito y no mandado se guarda (solo en memoria) para cuando la misma persona vuelva a entrar
  S.user = null;
  resetWork();
  S.login = newLogin();
  S.login.notice = 'Tu sesión se cerró. Entra otra vez.';
  replace('entrar');
  discover();
}

// ---------------------------------------------------------------- estado
function newLogin() { return { phase: 'buscando', pcs: [], host: '', hostInput: '', user: '', pass: '', show: false, err: '', notice: '', busy: '', run: 0, canManual: false, otra: false }; }
const S = {
  screen: 'boot', user: null, pc: null, day: new Date(), todayKey: dayKey(new Date()), login: newLogin(),
  cp: { old: '', nw: '', rep: '', show: false, err: '', busy: false, forced: false },
  hoy: { rows: null, loading: false, err: '', srvErr: '', updated: '', seq: 0 },
  cid: null, cola: [], cons: null, nota: null, sheet: null, model: { ready: null, name: '', status: '' }, device: '',
  mic: { state: 'idle', err: '' }, aj: { busy: '', err: '' },
};
// Lo escrito y no mandado de cada consulta (solo en memoria): no se pierde al cambiar de paciente ni cuando la sesión se cierra a media nota.
S.keep = {};
function keepKey(N) { return String(N.day || dayKey(S.day)) + '|' + String(N.cid); }   // el día de la nota, no el que se está mirando
function stashNota() {
  const N = S.nota;
  if (!N || !S.user || noteClosed()) return;
  let text = String(N.text || '');
  let unsure = null;
  if (N.sentRaw != null) {
    const sent = String(N.sentRaw);
    if (N.sentOk) text = text === sent ? '' : text.startsWith(sent) ? text.slice(sent.length).trim() : text;     // la PC confirmó que la tiene (la IA aún piensa): no se guarda, o volvería al cuadro y se mandaría dos veces
    else if (text.trim()) unsure = { sent, snap: N.snap };                                                         // no se sabe si llegó (falló el wifi): se guarda todo y al reabrir se compara con el borrador de la PC
  }
  if (!text.trim() && !N.edit && !N.pin) return;
  S.keep[keepKey(N)] = { user: S.user.user, text, typing: N.typing, unsure, edit: N.edit ? Object.assign({}, N.edit, { busy: false }) : null, pin: N.pin || null };
}
function unstashNota(N) {
  const k = S.keep[keepKey(N)];
  if (!k) return;
  delete S.keep[keepKey(N)];
  if (!S.user || k.user !== S.user.user) return;
  N.text = k.text; N.typing = !!k.typing || !!k.text; N.edit = k.edit; N.unsure = k.unsure || null; N.pin = k.pin || null;
}
function settleUnsure(N) {                // la PC ¿usó la respuesta que se guardó sin saber si llegó? si el borrador cambió, sí: se quita del cuadro
  const u = N.unsure; N.unsure = null;
  if (!u || !N.draft || JSON.stringify(N.draft.text_es || {}) === u.snap) return;
  const t = String(N.text || '');
  if (t === u.sent) { N.text = ''; N.typing = false; }
  else if (t.startsWith(u.sent)) N.text = t.slice(u.sent.length).trim();
}
const T = { hoy: null, cola: null, job: null, mic: null, toast: null, find: null };
function clearT(k) { if (T[k]) { clearTimeout(T[k]); T[k] = null; } }
function resetWork() {
  Object.keys(T).forEach(clearT);
  micCancelQuiet();
  S.cid = null; S.cola = []; S.cons = null; S.nota = null; S.sheet = null; S.hoy = { rows: null, loading: false, err: '', srvErr: '', updated: '', seq: S.hoy.seq + 1 };
}

// ---------------------------------------------------------------- navegación (el botón Atrás de Android usa el historial)
const navI = () => (history.state && history.state.i) || 0;
function go(screen) { S.sheet = null; history.pushState({ s: screen, i: navI() + 1 }, ''); enter(screen); }
function replace(screen) { S.sheet = null; history.replaceState({ s: screen, i: navI() }, ''); enter(screen); }
function back() { if (history.state && history.state.s !== 'hoy' && history.length > 1) history.back(); else go('hoy'); }
// Vuelve a la lista de consultas quitando de la historia las pantallas de en medio (así «Atrás» después sale de la app).
function goHoy() { const n = navI() - (S.hoyI || 0); if (S.screen !== 'hoy' && n > 0 && history.length > n) history.go(-n); else go('hoy'); }
window.addEventListener('popstate', (e) => {
  const s = e.state && e.state.s;
  if (!s) return;
  if (!S.user && s !== 'entrar') { replace('entrar'); return; }
  if (S.sheet) { S.sheet = null; history.pushState({ s: S.screen, i: navI() + 1 }, ''); render(); return; }   // «Atrás» con una hoja abierta: solo la cierra
  enter(s, true);
});
function enter(screen, fromPop) {
  const prev = S.screen;
  if (prev === 'nota' && S.nota) { const m = $('#main'); S.nota.scrollY = m ? m.scrollTop : 0; }
  S.screen = screen;
  if (prev === 'nota' && screen !== 'nota' && screen !== 'revisar') { micCancelQuiet(); clearT('job'); }
  if (screen !== 'hoy') clearT('hoy');
  if (screen !== 'nota' && screen !== 'revisar') S.scrollTo = null;
  if (prev === 'nota' && screen !== 'nota') S.mic.err = '';
  if (!/^(consulta|nota|revisar)$/.test(screen)) { clearT('cola'); }
  S.scrollTop = (screen === 'nota' && fromPop && S.nota && S.nota.loaded && S.nota.scrollY != null) ? S.nota.scrollY : true;
  if (screen === 'hoy') { S.hoyI = navI(); rollDay(); loadHoy(false); }
  else if (screen === 'consulta') { if (!S.cons) { S.screen = 'hoy'; loadHoy(false); return; } loadCons(); }
  else if (screen === 'nota') {
    if (!S.nota) { S.screen = 'hoy'; loadHoy(false); return; }
    if (fromPop && S.nota.loaded) ensureCola();
    if (S.nota.busy === 'ia' && S.nota.job && !T.job) pollJob(S.nota, S.nota.job, 0);        // se salió mientras la IA pensaba: se sigue esperando
  }
  else if (screen === 'ajustes') { loadAjustes(); }
  else if (screen === 'revisar') { if (!S.nota) { S.screen = 'hoy'; loadHoy(false); return; } }
  if (/^(consulta|nota|revisar)$/.test(S.screen) && colaPending()) ensureCola();
  render();
}
function rollDay() {                    // pasó la medianoche con la app abierta: si no cambió de día, la lista se pasa a hoy
  if (S.screen !== 'hoy') return false;
  const k = dayKey(new Date());
  if (k === S.todayKey) return false;
  const was = dayKey(S.day) === S.todayKey;
  S.todayKey = k;
  if (was) { S.day = new Date(); S.cola = []; S.hoy.rows = null; }
  return was;
}
function closeSheet() { if (!S.sheet) return; S.sheet = null; render(); }

// ---------------------------------------------------------------- entrar
async function boot() {
  history.replaceState({ s: 'boot' }, '');
  render();
  let me = null;
  try { me = await call('me', {}, 8000); } catch (e) { me = null; }
  try { S.device = (await call('deviceName', {}, 5000)).name || ''; } catch (e) { S.device = ''; }
  if (me && me.user) { S.user = me; afterLogin(); } else { replace('entrar'); discover(); }
}
function afterLogin() {
  if (S.user.must_change) { S.cp = { old: '', nw: '', rep: '', show: false, err: '', busy: false, forced: true }; replace('clave'); }
  else replace('hoy');
}
function startFind(L) {                  // cada búsqueda tiene su número: si la doctora escribe la dirección a mano, la búsqueda vieja ya no pisa nada
  const my = ++L.run;
  L.canManual = false; clearT('find');
  T.find = setTimeout(() => { if (L.run === my && L.phase === 'buscando' && S.screen === 'entrar') { L.canManual = true; render(); } }, CFG.manual);
  return my;
}
const hostOnly = (h) => { const t = String(h || '').trim().toLowerCase(); return (t.match(/:/g) || []).length === 1 ? t.replace(/:\d+$/, '') : t; };    // con o sin puerto es la misma computadora
const isRogue = (L, host) => !!L.otra && (!L.lastHost || hostOnly(host) !== hostOnly(L.lastHost));      // sin saber cuál es la de siempre, otro certificado se trata como ajena (lo seguro)
async function discover() {
  const L = S.login;
  L.phase = 'buscando'; L.err = ''; L.busy = '';
  const my = startFind(L);
  render();
  const t0 = Date.now();
  let r = null, failed = '';
  try { r = await call('discover', {}, 12000); } catch (e) { failed = errText(e); }
  if (r && r.last && r.last.host) L.lastHost = r.last.host;       // aunque esta búsqueda ya no valga, se sabe cuál es la de siempre
  const wait = CFG.buscar - (Date.now() - t0);
  if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
  if (S.screen !== 'entrar' || L.run !== my) return;
  const pcs = (r && Array.isArray(r.pcs)) ? r.pcs.filter((p) => p && p.host) : [];
  const last = r && r.last && r.last.host ? r.last : null;
  L.pcs = pcs; L.hadLast = !!last; L.lastHost = last ? last.host : ''; L.rogue = false;
  if (last) {
    // La computadora que ya se conocía va primero, aunque no haya contestado a la búsqueda: otra que conteste no la reemplaza sola.
    const same = pcs.find((p) => p.host === last.host);
    const port = (same && same.port) || last.port;
    const ok = await connect(last.host, { quiet: true, port });
    if (ok !== false || S.screen !== 'entrar' || L.phase !== 'no' || L.otra) return;      // salió bien, o es una búsqueda vieja, o ya se cambió de pantalla, o la doctora pasó a escribirla, o es otro certificado
    const otras = pcs.filter((p) => p.host !== last.host);                                 // la que acaba de fallar no se vuelve a ofrecer
    if (otras.length) { clearT('find'); L.canManual = false; L.err = ''; L.pcs = otras; L.phase = 'varias'; render(); }
    return;
  }
  if (pcs.length === 1) return connect(pcs[0].host, { port: pcs[0].port });
  if (pcs.length > 1) { clearT('find'); L.canManual = false; L.phase = 'varias'; render(); return; }
  clearT('find'); L.canManual = false; L.phase = 'no'; L.err = failed; render();
}
async function connect(host, o) {
  o = o || {};
  const L = S.login;
  L.phase = 'buscando'; L.host = host; L.err = ''; L.busy = 'conectando'; L.otra = false; L.rogue = false;
  const my = startFind(L);
  render();
  const args = { host };
  if (o.port) args.port = o.port;
  let ok = false;
  try {
    const r = await call('connect', args, 15000);
    if (L.run !== my) return null;
    S.pc = { host, name: (r && r.name) || host };
    L.phase = 'form'; L.busy = ''; ok = true;
  } catch (e) {
    if (L.run !== my) return null;
    L.phase = o.manual ? 'manual' : 'no'; L.busy = '';
    L.otra = !!(e && e.status === 495);
    L.rogue = isRogue(L, host);       // otra computadora (no la de siempre) con otro certificado: no es la de la clínica
    L.err = L.rogue ? MSG_NO_ES : (o.quiet && !L.otra) ? 'No encontré la computadora de la clínica.' : errText(e);
  }
  clearT('find'); L.canManual = false;
  render();
  return ok;
}
async function doLogin() {
  const L = S.login;
  if (L.busy || !L.user.trim() || !L.pass) return;
  L.busy = 'entrando'; L.err = ''; L.notice = ''; render();
  try {
    const r = await call('login', { user: L.user.trim().toLowerCase(), pass: L.pass }, 60000);
    S.user = r.user;
    L.pass = ''; L.busy = '';
    afterLogin();
  } catch (e) {
    // Solo si la PC dijo «contraseña mala» (401, o ese mismo texto si el puente no manda el código) se borra lo escrito; si fue la red o el wifi, no hay que volver a teclearla.
    // aquí ya se conectó a S.pc.host con éxito: sin pista de otra computadora, es la misma
    L.busy = ''; if (e && (e.status === 401 || /incorrectos/i.test(e.message || ''))) L.pass = ''; L.otra = !!(e && e.status === 495); L.rogue = L.otra && !!S.pc && !!L.lastHost && isRogue(L, S.pc.host); L.err = L.rogue ? MSG_NO_ES : errText(e); render();
  }
}
function policy(pw, user, old, rep) {
  const p = String(pw || '');
  let n = '', bad = false;
  try { n = p.normalize('NFKC'); bad = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u.test(n); } catch (e) { n = p; }
  const low = n.toLowerCase();
  const len = Array.from(n).length;
  const u = String(user || '').toLowerCase();
  const easy = len > 0 && (isCommon(low) || new Set(Array.from(low)).size <= 2);
  return [
    { ok: len >= 8 && len <= 128 && !bad, t: 'Al menos 8 letras o números' },
    { ok: len > 0 && low !== u, t: 'No puede ser igual a tu usuario' },
    { ok: len > 0 && !easy, t: 'No puede ser una clave fácil de adivinar' },
    { ok: len > 0 && p !== old, t: 'Distinta a la que tenías' },
    { ok: len > 0 && p === rep, t: 'Las dos claves nuevas son iguales' },
  ];
}
const cpOk = () => !!S.cp.old && policy(S.cp.nw, S.user && S.user.user, S.cp.old, S.cp.rep).every((x) => x.ok);
async function doChangePw() {
  const C = S.cp;
  if (C.busy || !cpOk()) return;
  C.busy = true; C.err = ''; render();
  try {
    await call('changePassword', { old: C.old, new: C.nw }, 90000);
    C.old = C.nw = C.rep = ''; C.busy = false;
    let me = null;
    try { me = await call('me', {}, 8000); } catch (e) { me = null; }
    if (me && me.user) S.user = me; else S.user = Object.assign({}, S.user, { must_change: false });
    toast('Contraseña cambiada.');
    if (C.forced) replace('hoy'); else back();
  } catch (e) { C.busy = false; C.err = errText(e); render(); }       // no se borra nada de lo escrito
}

// ---------------------------------------------------------------- hoy
async function loadHoy(refresh) {
  const H = S.hoy;
  const my = ++H.seq;
  clearT('hoy');
  H.loading = true; H.err = '';
  render();
  try {
    const r = await api('GET', '/api/v1/consultas?date=' + dayKey(S.day) + '&refresh=' + (refresh ? 1 : 0));
    if (my !== H.seq || S.screen !== 'hoy') return;
    H.rows = Array.isArray(r.rows) ? r.rows : [];
    H.updated = r.updated || ''; H.srvErr = r.error || '';
    H.loading = !!r.loading;
    if (r.loading) T.hoy = setTimeout(() => { if (S.screen === 'hoy') loadHoy(false); }, CFG.hoy);
  } catch (e) {
    if (my !== H.seq || e.handled) return;
    H.loading = false; H.err = errText(e);
  }
  render();
}
function goToday() { S.day = new Date(); S.todayKey = dayKey(S.day); S.hoy.rows = null; S.cola = []; loadHoy(false); }
function rescanHoy() { stashNota(); S.user = null; resetWork(); S.login = newLogin(); S.login.notice = 'Busquemos la computadora otra vez.'; replace('entrar'); discover(); }
function moveDay(n) { const d = new Date(S.day); d.setDate(d.getDate() + n); S.day = d; S.hoy.rows = null; S.cola = []; loadHoy(false); }

// ---------------------------------------------------------------- consulta (lo que hay en Neo)
async function openCons(rawId) {
  const id = /^\d+$/.test(String(rawId)) ? Number(rawId) : rawId;
  S.cid = id;
  const row = ((S.hoy.rows || []).find((r) => String(r.id) === String(id))) || {};
  S.cons = { id, row, c: null, err: '', loading: true, prepErr: '', picking: false, plantillas: null };
  go('consulta');
}
async function loadCons(quiet) {
  const K = S.cons;
  if (!K) return;
  if (!quiet) { K.loading = true; K.err = ''; render(); }
  try {
    const r = await api('GET', '/api/v1/consulta?date=' + dayKey(S.day) + '&id=' + encodeURIComponent(K.id));
    if (S.cons !== K) return;
    K.c = r.c; K.loading = false; K.err = '';
    if (!quiet && canInterview(r.c)) loadDraftInfo(K);
    S.cola = S.cola.filter((it) => String(it.cid) !== String(K.id)).concat(Array.isArray(r.c.cola) ? r.c.cola : []);
    if (colaPending()) ensureCola(true);
  } catch (e) {
    if (S.cons !== K || e.handled) return;
    K.loading = false; K.err = errText(e);
  }
  render();
}
async function loadDraftInfo(K) {      // solo para decir «Seguir con la nota» o «Ver la nota terminada»; si falla, el botón dice lo de siempre
  try {
    const br = await api('GET', '/api/v1/borrador?date=' + dayKey(S.day) + '&id=' + encodeURIComponent(K.id));
    const d = br && br.draft;
    if (!d) return;
    const started = !!(br.turn || Object.keys(d.text_es || {}).length || (d.saved || []).length || (d.objective || []).length || d.objective_tests || d.subjective || (d.assessment || []).length || (d.plan_items || []).length || (d.home_items || []).length || d.recheck);
    K.draftInfo = { state: d.terminada ? 'terminada' : started ? 'empezada' : '' };
    if (S.cons === K && S.screen === 'consulta') render();
  } catch (e) { /* queda el texto de siempre */ }
}
const colaOf = () => S.cola.filter((it) => String(it.cid) === String(S.cid));
const colaPending = () => colaOf().some((it) => !FINAL[it.status]);
const prepPending = () => colaOf().some((it) => /^(SOAP|Plantilla)$/.test(it.section) && !FINAL[it.status]);
function canInterview(c) {
  if (!c || c.locked) return false;
  if (prepPending()) return true;
  if (typeof c.puede_entrevista === 'boolean') return c.puede_entrevista;
  return !!(c.has_soap || (c.notes_text || '').trim());
}
function ensureCola(now) {
  clearT('cola');
  T.cola = setTimeout(tickCola, now ? 40 : CFG.cola);
}
async function tickCola() {
  T.cola = null;
  if (!S.user || S.cid == null || !/^(consulta|nota|revisar)$/.test(S.screen)) return;
  const before = {};
  colaOf().forEach((it) => { before[it.qid + '|' + it.section] = it.status; });
  try {
    const list = await api('GET', '/api/v1/cola?date=' + dayKey(S.day));
    if (!Array.isArray(list)) throw mkErr(MSG_FALLA);
    const sig = (l) => JSON.stringify(l.map((it) => [it.qid, it.section, it.status, it.detail]));
    const old = sig(colaOf());
    S.cola = S.cola.filter((it) => String(it.cid) !== String(S.cid)).concat(list.filter((it) => String(it.cid) === String(S.cid)));
    colaChanged(before);
    if (sig(colaOf()) !== old) render();                // sin cambios no se redibuja: no se pierde lo que se está escribiendo
  } catch (e) { if (e.handled) return; }
  if (colaPending() && S.user) ensureCola();
}
function colaChanged(before) {
  let reload = false, finished = false;
  colaOf().forEach((it) => {
    const was = before[it.qid + '|' + it.section];
    if (FINAL[it.status] && was !== it.status) {
      reload = true;
      if (it.section === 'Terminar' && S.nota) { S.nota.finishing = false; if (it.status === 'error') S.nota.finishErr = it.detail || MSG_FALLA; else finished = true; }
    }
  });
  if (!reload) return;
  if (S.screen === 'consulta') loadCons(true);
  if (S.nota) { refreshNota(); }
  if (finished && S.nota) { S.nota.finished = true; S.nota.finishing = false; if (S.screen === 'nota') go('revisar'); }
}

// ---------------------------------------------------------------- crear SOAP y plantillas
function askSoap() {
  S.sheet = { type: 'confirm', title: 'Crear SOAP', text: 'Se pondrá la plantilla SOAP vacía en la nota de ' + ((S.cons.c && S.cons.c.patient) || 'este paciente') + ' en Neo. No se borra nada.', ok: 'Sí, crear SOAP', act: 'doSoap' };
  render();
}
async function doSoap() {
  const K = S.cons; S.sheet = null; K.prepErr = ''; K.busyPrep = 'Creando el SOAP en Neo…'; render();
  try {
    const r = await api('POST', '/api/v1/crear-soap', { date: dayKey(S.day), id: K.id });
    addLocalCola(r.qid, 'SOAP');
  } catch (e) { if (!e.handled) K.prepErr = errText(e); }
  K.busyPrep = ''; render();
}
async function askPlantilla() {
  const K = S.cons;
  K.prepErr = ''; K.busyPrep = 'Buscando las plantillas de cirugía…'; render();
  try {
    const r = await api('GET', '/api/v1/plantillas');
    K.plantillas = Array.isArray(r.plantillas) ? r.plantillas : [];
    S.sheet = { type: 'plantillas' };
  } catch (e) { if (!e.handled) K.prepErr = errText(e); }
  K.busyPrep = ''; render();
}
function confirmPlantilla(id) {
  const K = S.cons, p = (K.plantillas || []).find((x) => String(x.id) === String(id));
  if (!p) return;
  S.sheet = { type: 'confirm', title: 'Poner la plantilla', text: 'Se pondrá el texto de la plantilla «' + p.nombre + '» en la nota de ' + ((K.c && K.c.patient) || 'este paciente') + ' en Neo. No se agrega nada de lo que cobra la plantilla. Después no se puede quitar desde aquí.',
    ok: 'Sí, poner plantilla', act: 'doPlantillaOk', arg: String(p.id), cancel: 'Elegir otra', cancelAct: 'askPlantillaList' };
  render();
}
async function doPlantilla(id) {
  const K = S.cons; S.sheet = null; K.prepErr = ''; K.busyPrep = 'Poniendo la plantilla en Neo…'; render();
  try {
    const r = await api('POST', '/api/v1/aplicar-plantilla', { date: dayKey(S.day), id: K.id, plantilla: Number(id) || id });
    addLocalCola(r.qid, 'Plantilla');
  } catch (e) { if (!e.handled) K.prepErr = errText(e); }
  K.busyPrep = ''; render();
}
function addLocalCola(qid, section, extra) {
  S.cola.push(Object.assign({ qid, cid: S.cid, patient: (S.cons && S.cons.c && S.cons.c.patient) || '', doctor: '', status: 'en cola', detail: '', when: '', section }, extra || {}));
  ensureCola(true);
}

// ---------------------------------------------------------------- nota con IA
const SEC_TITLE = { S: 'S · Lo que cuenta el dueño', O: 'O · Examen', Notas: 'Doctor\'s Notes · Notas del doctor', A: 'A · Diagnóstico', P: 'P · Plan', Home: 'Home · Para la casa', Recheck: 'Recheck · Revisión', Vitales: 'Vitales', Anestesia: 'Anestesia' };
const SEC_SHORT = { S: 'S', O: 'O', Notas: 'Notas', A: 'A', P: 'P', Home: 'Home', Recheck: 'Recheck', Vitales: 'Vitales', Anestesia: 'Anestesia' };
const MODE_SECTIONS = { soap: ['S', 'O', 'Notas', 'A', 'P', 'Home', 'Recheck', 'Vitales'], simple: ['O', 'Notas', 'A', 'P', 'Home', 'Recheck', 'Vitales'], cirugia: ['Anestesia', 'Home', 'Recheck', 'Vitales'] };
const O_ROWS = ['Attitude', 'BCS', 'Eyes', 'Ears', 'Nose and Throat', 'Mouth / Teeth / Gums', 'Heart', 'Respiratory', 'GI Tract / Abdomen', 'Urinary and Genitals', 'Lymph Nodes', 'Legs / Paws / Back', 'Coat and Skin', 'Neurology'];
const O_STATES = ['WNL', 'Abnormal', 'DNE'];
const VITALS = [['weight_lb', 'Peso', 'lb'], ['temperature_f', 'Temperatura', '°F'], ['pulse_bpm', 'Pulso', 'lpm'], ['respiration_bpm', 'Respiración', 'rpm']];
const SECTION_KEY = { S: 'subjective', Notas: 'objective_tests', A: 'assessment', P: 'plan_items', Anestesia: 'plan_items', Home: 'home_items', Recheck: 'recheck' };
const LIST_SEC = { A: 1, P: 1, Anestesia: 1, Home: 1 };

function newNota(id) {
  return { cid: id, day: dayKey(S.day), c: null, draft: null, turn: null, loaded: false, loading: true, err: '', busy: '', last: null, target: null, localQ: null, skip: [], text: '', typing: false,
    edit: null, changed: [], saving: {}, finishing: false, finished: false, finishErr: '', saveErr: {}, warn: {}, job: 0, jobLost: false, sentRaw: null, sentOk: false, unsure: null, snap: '', pin: null, saveAll: null };
}
async function openNota() {
  const c = S.cons && S.cons.c;
  if (!c || !canInterview(c)) return;
  const old = S.nota;
  if (old && old.loaded && String(old.cid) === String(S.cid) && !noteClosed()) { go('nota'); refreshNota(); return; }    // la misma consulta: no se pierde lo escrito ni lo saltado
  stashNota();
  S.nota = newNota(S.cid);
  unstashNota(S.nota);
  go('nota');
  loadNota();
}
async function loadNota() {
  const N = S.nota;
  N.loading = true; N.err = ''; render();
  try {
    const [cr, br] = await Promise.all([
      api('GET', '/api/v1/consulta?date=' + dayKey(S.day) + '&id=' + encodeURIComponent(N.cid)),
      api('GET', '/api/v1/borrador?date=' + dayKey(S.day) + '&id=' + encodeURIComponent(N.cid)),
    ]);
    if (S.nota !== N) return;
    N.c = cr.c; N.draft = br.draft || null; N.loading = false; N.loaded = true;
    settleUnsure(N);
    S.cola = S.cola.filter((it) => String(it.cid) !== String(N.cid)).concat(Array.isArray(cr.c.cola) ? cr.c.cola : []);
    modelStatus();
    if (N.draft && N.draft.terminada) { N.finished = true; if (br.turn) N.turn = br.turn; replace('revisar'); return; }    // ya se terminó: la PC no deja cambiar nada
    if (br.turn) applyTurn(br.turn, true);
    else { render(); startJob({ answer_es: '', start: true }); }
    if (colaPending()) ensureCola(true);
    return;
  } catch (e) {
    if (S.nota !== N || e.handled) return;
    N.loading = false; N.err = errText(e);
  }
  render();
}
async function refreshNota(tries) {
  const N = S.nota;
  if (!N || !N.loaded) return;
  tries = tries || 0;
  try {
    const [cr, br] = await Promise.all([
      api('GET', '/api/v1/consulta?date=' + dayKey(S.day) + '&id=' + encodeURIComponent(N.cid)),
      api('GET', '/api/v1/borrador?date=' + dayKey(S.day) + '&id=' + encodeURIComponent(N.cid)),
    ]);
    if (S.nota !== N) return;
    const pv = N.pvFresh && N.turn && br.preview && typeof br.preview === 'object' ? br.preview : null;      // el texto fresco solo cambia si el que se ve es fresco
    const changed = JSON.stringify([N.c, N.draft]) !== JSON.stringify([cr.c, br.draft || N.draft]) || (pv && JSON.stringify(pv) !== JSON.stringify(N.turn.preview || null));
    N.c = cr.c;
    if (br.draft) { N.draft = br.draft; if (N.turn) N.turn.draft = br.draft; }
    if (pv) N.turn.preview = pv;
    if (br.draft && br.draft.terminada && N.finishing) { N.finished = true; N.finishing = false; }
    if (changed) render();
  } catch (e) {
    if (!e.handled && tries < 3 && S.nota === N) setTimeout(() => refreshNota(tries + 1), 700);     // sin esto se perdería la duda en ámbar
  }
}
const noteClosed = () => !!(S.nota && (S.nota.finished || (S.nota.draft && S.nota.draft.terminada)));
const noteMode = () => {
  const N = S.nota, d = N && N.draft, c = N && N.c;
  const m = (d && d.modo) || (c && c.modo) || '';
  if (MODE_SECTIONS[m]) return m;
  if (c && c.surgery) return 'cirugia';
  if (colaOf().some((it) => it.section === 'Plantilla' && it.status !== 'error')) return 'cirugia';
  if (c && (c.has_soap || colaOf().some((it) => it.section === 'SOAP' && it.status !== 'error'))) return 'soap';
  if (c && (c.notes_text || '').trim()) return 'simple';
  return 'soap';
};
const sections = () => MODE_SECTIONS[noteMode()];
function applyTurn(turn, resume) {
  const N = S.nota;
  N.turn = turn;
  N.pvFresh = !resume;            // el texto de «preview» solo vale en un turno recién hecho (después de editar o al reabrir queda viejo)
  if (turn.draft) N.draft = turn.draft;
  N.busy = ''; N.err = ''; N.localQ = null;
  pinCheck(N);
  N.target = N.pin || (turn.question && turn.question.section) || null;          // con una tarjeta marcada, la pregunta de la IA no cambia el destino
  N.changed = Array.isArray(turn.changed) ? turn.changed : [];
  render();                       // la lista se queda donde estaba: la pregunta nueva se ve arriba (o en la burbuja)
}
const aiBusy = () => !!(S.nota && S.nota.busy === 'ia');
const snapText = (N) => JSON.stringify((N.draft && N.draft.text_es) || {});
function afterSent(N) {                 // lo que escribió la doctora mientras la IA pensaba no se borra; solo se quita lo que ya se mandó
  const sent = N.sentRaw; N.sentRaw = null;
  if (sent == null) return;
  const t = String(N.text || '');
  if (t === sent) { N.text = ''; N.typing = false; }
  else if (t.startsWith(sent)) N.text = t.slice(sent.length).trim();
}
function unsend(N) { if (N.sentRaw != null) { N.refusedRaw = N.sentRaw; N.sentRaw = null; } N.sentOk = false; }      // el trabajo acabó mal: la IA no usó esa respuesta, sigue siendo texto sin mandar (Reintentar la vuelve a mandar)
function startJob(payload, retry) {
  const N = S.nota;
  const body = Object.assign({ date: dayKey(S.day), id: N.cid, answer_es: '', target: null, skip: N.skip.slice(), edits: {}, start: false, solo: false }, payload);
  N.last = body; N.busy = 'ia'; N.err = ''; N.job = 0; N.jobLost = false; N.failSince = 0; N.sentOk = false;
  if (!retry) { N.snap = snapText(N); N.dirty = false; N.refusedRaw = null; }
  render();
  api('POST', '/api/v1/entrevista', body).then((r) => { N.job = r.job; N.sentOk = true; pollJob(N, r.job, 0); }).catch((e) => {
    if (S.nota !== N || e.handled) return;
    if (e.status) { N.refusedRaw = N.sentRaw; N.sentRaw = null; }                 // la PC contestó que no (409, 429...): esa respuesta no se mandó, el texto de la doctora se queda en el cuadro
    N.busy = ''; N.err = errText(e); render();
  });
}
// Si la doctora editó o guardó una tarjeta después de que empezó este trabajo, el borrador que trae la respuesta es viejo: se pide el de ahora y no se pisa lo que cambió.
async function freshTurn(N, turn) {
  if (!N.dirty) { applyTurn(turn); return; }
  let t = turn;
  try {
    const br = await api('GET', '/api/v1/borrador?date=' + dayKey(S.day) + '&id=' + encodeURIComponent(N.cid));
    if (S.nota !== N) return;
    if (br && br.draft) t = Object.assign({}, turn, { draft: br.draft });
  } catch (e) { if (S.nota !== N) return; t = Object.assign({}, turn, { draft: N.draft || turn.draft }); }
  applyTurn(t, true);
}
function pollJob(N, job, fails) {
  clearT('job');
  T.job = setTimeout(async () => {
    T.job = null;
    if (S.nota !== N || !S.user) return;
    const t1 = Date.now();
    try {
      const r = await api('GET', '/api/v1/trabajo?job=' + encodeURIComponent(job));
      if (S.nota !== N) return;
      N.failSince = 0;
      if (r.status === 'trabajando') return pollJob(N, job, 0);
      N.job = 0;
      if (r.status === 'listo' && r.turn) { afterSent(N); await freshTurn(N, r.turn); return; }
      unsend(N);
      N.busy = ''; N.err = r.error || 'La IA no respondió. Toca Reintentar.'; render();
    } catch (e) {
      if (S.nota !== N || e.handled) return;
      if (!e.status || e.status >= 500) {                       // un fallo del wifi no pierde la respuesta: se sigue preguntando por el mismo trabajo
        if (!N.failSince) N.failSince = t1;
        if ((fails || 0) < 4 && Date.now() - N.failSince < 30000) return pollJob(N, job, (fails || 0) + 1);      // se insiste unos segundos, no minutos
        N.failSince = 0; N.jobLost = true;
      } else { N.job = 0; unsend(N); }
      N.busy = ''; N.err = errText(e); render();
    }
  }, fails ? 2000 : CFG.job);
}
async function retryJob() {
  const N = S.nota;
  if (!N || N.edit || N.saveAll) return;           // con una tarjeta abierta o mientras «Guardar todo» manda secciones no se reintenta
  if (!N.last) { loadNota(); return; }
  const tg = N.last.solo && N.last.target;
  if (tg && !(N.job && N.jobLost) && (N.saving[tg] || secState(tg).pending)) { toast(MSG_GUARDANDO); return; }    // la tarjeta marcada se está guardando: esa respuesta no tendría dónde ir
  N.busy = 'ia'; N.err = ''; render();
  if (N.job && N.jobLost) { N.jobLost = false; pollJob(N, N.job, 0); return; }      // el trabajo sigue en la PC: se espera ese, no se manda otra vez
  let br = null;
  try {                                                         // ¿la PC ya procesó esa respuesta y solo se perdió el aviso? entonces no se manda dos veces
    br = await api('GET', '/api/v1/borrador?date=' + dayKey(S.day) + '&id=' + encodeURIComponent(N.cid));
    if (S.nota !== N) return;
    if (br.turn && br.draft && JSON.stringify(br.draft.text_es || {}) !== N.snap) { N.job = 0; N.refusedRaw = null; afterSent(N); applyTurn(N.dirty ? Object.assign({}, br.turn, { draft: br.draft }) : br.turn, !!N.dirty); return; }
  } catch (e) { if (S.nota !== N || e.handled) return; N.busy = ''; N.err = errText(e); render(); return; }
  if (br && br.draft) { N.draft = br.draft; if (N.turn) N.turn.draft = br.draft; }
  if (tg && secState(tg).locked) { N.last = Object.assign({}, N.last, { solo: false, target: null }); pinCheck(N); }    // la tarjeta marcada ya se guardó: la respuesta va sin marca (la PC no dejaría escribir ahí)
  if (N.sentRaw == null && N.refusedRaw != null) N.sentRaw = N.refusedRaw;      // se vuelve a mandar la misma respuesta: ahora sí se puede quitar del cuadro
  N.refusedRaw = null;
  startJob(N.last, true);
}
function sendAnswer(text, opts) {
  const N = S.nota;
  if (!N || N.busy) return;
  if (N.edit) { toast(MSG_EDITANDO); return; }
  if (N.saveAll) { toast('Espera un momento: estoy mandando las secciones a Neo.'); return; }
  if (N.pin && (N.saving[N.pin] || secState(N.pin).pending)) { toast(MSG_GUARDANDO); return; }        // lo escrito se queda en el cuadro
  if (N.pin && secState(N.pin).locked) { unpin(N); render(); toast('Esa parte ya está guardada en Neo. Quité la marca. Manda otra vez.'); return; }
  pinCheck(N);
  const q = N.localQ;
  let a = String(text || '').trim();
  if (q && a && !(N.pin && q.section && q.section !== N.pin)) a = 'Sobre «' + q.text_es + '»: ' + a;      // la sugerencia es de otra parte: no se mezcla con la tarjeta marcada
  if (opts && opts.skipAbout) { if (N.skip.indexOf(opts.skipAbout) < 0) N.skip.push(opts.skipAbout); }
  N.sentRaw = opts && opts.fromBox ? String(N.text || '') : null;
  if (N.pin) { startJob({ answer_es: a, target: N.pin, solo: true }); return; }        // tarjeta marcada: todo va solo ahí (la PC no deja cambiar las otras)
  startJob({ answer_es: a, target: N.target && !secState(N.target).locked ? N.target : null });
}
function skipQuestion() {
  const N = S.nota, q = N.turn && N.turn.question;
  if (!q) return;
  sendAnswer('', { skipAbout: q.about });
}
// Tocar una tarjeta la marca: todo lo que se diga va solo ahí hasta quitarla (otro toque, «Quitar», guardarla o terminar la nota).
const askedSec = (N) => (N.localQ && N.localQ.section) || (N.turn && N.turn.question && N.turn.question.section) || null;
function unpin(N) { N.pin = null; const s = askedSec(N); N.target = s && !secState(s).locked ? s : null; }
const NO_PIN = 'Vitales';                // los vitales no se marcan: el toque solo dice a dónde va lo próximo (como antes)
function pinCheck(N) { if (N && N.pin && (N.pin === NO_PIN || noteClosed() || secState(N.pin).locked || sections().indexOf(N.pin) < 0)) unpin(N); }
function setTarget(sec) {
  const N = S.nota;
  if (!N || N.edit) { if (N && N.edit && N.edit.sec !== sec) toast(MSG_EDITANDO); return; }     // con una tarjeta abierta para editar, tocar no marca nada
  if (secState(sec).locked) { toast('Esa parte ya está guardada en Neo.'); return; }
  if (N.pin === sec) unpin(N);
  else if (N.saving[sec] || secState(sec).pending) { toast(MSG_GUARDANDO); return; }
  else if (sec === NO_PIN) { N.pin = null; N.target = N.target === sec ? null : sec; }
  else { N.pin = sec; N.target = sec; if (N.localQ && N.localQ.section !== sec) N.localQ = null; }      // la sugerencia era de otra parte: se quita
  render();
}

// --- estado de cada tarjeta
function lastCola(sec) { const l = colaOf().filter((it) => it.section === sec); return l.length ? l[l.length - 1] : null; }
function secState(sec) {
  const N = S.nota, d = N.draft || {};
  const it = lastCola(sec);
  const est = (d.estado || {})[sec];
  const st = it ? { status: it.status, detail: it.detail || '' } : (est ? { status: est.status, detail: est.detail || '' } : null);
  const inSaved = (d.saved || []).indexOf(sec) >= 0;
  const status = st ? st.status : '';
  const locked = noteClosed() || inSaved || status === 'guardada' || status === 'sin cambios';        // con error y aun «guardada» en la PC (no coincidió al releer): sigue con candado
  return { status, detail: st ? st.detail : '', locked, done: status === 'guardada' || status === 'sin cambios', pending: !!status && !FINAL[status], error: status === 'error',
    doubt: (d.dudas_neo || {})[sec] || '' };
}
function filled(sec) {
  const d = (S.nota && S.nota.draft) || {};
  if (sec === 'O') return !!((d.objective || []).length || d.objective_rest_normal);
  if (sec === 'Notas') return !!testsText(d);
  if (sec === 'Vitales') return VITALS.some((v) => (d.vitals || {})[v[0]] != null);
  if (sec === 'P' && autoP(d).length) return true;           // lo cobrado ya cuenta: P se puede guardar aunque no se haya dicho nada
  const v = d[SECTION_KEY[sec]];
  return Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());
}
// Lo cobrado (no declinado) se pone solo en P, como en el record de la PC: la PC lo manda en draft.plan_auto (ya sin lo que la doctora dijo) hasta que P se guarda.
// Ya guardada (o con la nota terminada) manda lo que de verdad se puso en draft.plan_auto_sent. Home igual si la PC manda home_auto / home_auto_sent.
const AUTO = { P: 'plan_auto', Home: 'home_auto' };
const cleanL = (v) => Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];
const autoOpen = (d, sec) => (!AUTO[sec] || (d.saved || []).indexOf(sec) >= 0 || d.terminada) ? [] : cleanL(d[AUTO[sec]]);     // lo que todavía se va a poner
const autoP = (d) => autoOpen(d, 'P');
function autoShown(sec) {                   // lo que se ve en la tarjeta y en Revisar
  const d = (S.nota && S.nota.draft) || {};
  if (!AUTO[sec]) return [];
  if (!secState(sec).locked) return autoOpen(d, sec);
  const s = d[AUTO[sec] + '_sent'];
  return Array.isArray(s) ? cleanL(s) : cleanL(d[AUTO[sec]]);       // una PC vieja sin «_sent»: lo que haya
}
// Con lo suyo: P y Home cuentan solo con lo que dijo la doctora (lo cobrado se pone con su «Guardar sección» o al terminar).
const ownFilled = (d, s) => AUTO[s] ? (d[SECTION_KEY[s]] || []).length > 0 : filled(s);
function enLines(sec) {
  const N = S.nota, d = N.draft || {};
  const pv = N.pvFresh && N.turn && N.turn.preview && N.turn.preview[sec];
  let t = typeof pv === 'string' ? pv : '';
  if (!t) { const v = sec === 'Notas' ? testsText(d) : d[SECTION_KEY[sec]]; t = Array.isArray(v) ? v.join('\n') : (v || ''); }
  const l = String(t).split('\n').map((x) => x.trim()).filter(Boolean);
  autoShown(sec).forEach((x) => { if (l.indexOf(x) < 0) l.push(x); });     // el texto fresco de la IA ya las trae: no se repiten
  return l;
}
function oText() {
  const d = (S.nota && S.nota.draft) || {};
  const l = (d.objective || []).map((f) => f.row + ': ' + f.state + (f.note ? ' - ' + f.note : ''));
  if (d.objective_rest_normal) l.push('Lo demás: WNL');
  return l;
}
// Notas del doctor (su propia tarjeta «Notas»; en Neo va en la fila «Doctor's Notes» de la O): tests, lo que vio y otras notas (inglés). La PC puede mandarlo como texto o como lista de renglones.
const testsText = (d) => { const v = d && (d.objective_tests != null ? d.objective_tests : d.tests); return String(Array.isArray(v) ? v.join('\n') : (v || '')).trim(); };

// --- editar a mano
function startEdit(sec) {
  const N = S.nota, d = N.draft || {};
  if (secState(sec).locked || aiBusy() || N.saving[sec] || secState(sec).pending || N.saveAll) return;
  if (N.edit) { toast(MSG_EDITANDO); return; }
  const e = { sec };
  if (sec === 'O') { e.rows = {}; (d.objective || []).forEach((f) => { e.rows[f.row] = { state: f.state, note: f.note || '' }; }); e.rest = !!d.objective_rest_normal; }
  else if (sec === 'Vitales') { e.vit = {}; VITALS.forEach((v) => { const x = (d.vitals || {})[v[0]]; e.vit[v[0]] = x == null ? '' : String(x); }); }
  else if (sec === 'Notas') { e.text = testsText(d); }
  else if (LIST_SEC[sec]) { const v = d[SECTION_KEY[sec]]; e.text = (Array.isArray(v) ? v : []).join('\n'); }
  else { e.text = d[SECTION_KEY[sec]] || ''; }
  N.edit = e; render();
}
function editValue(e) {
  if (e.sec === 'O') {
    return { objective: O_ROWS.filter((r) => e.rows[r] && e.rows[r].state).map((r) => ({ row: r, state: e.rows[r].state, note: (e.rows[r].note || '').trim() })), objective_rest_normal: !!e.rest };
  }
  if (e.sec === 'Vitales') {
    const o = {};
    VITALS.forEach((v) => { const t = String(e.vit[v[0]] || '').trim().replace(',', '.'); o[v[0]] = t === '' ? null : Number(t); });
    return o;
  }
  if (e.sec === 'Notas') return String(e.text || '').split('\n').map((x) => x.trim()).filter(Boolean).join('\n');     // texto; vacío = borrar
  if (LIST_SEC[e.sec]) return e.text.split('\n').map((x) => x.trim()).filter(Boolean);
  return e.text.trim() || null;
}
async function saveEdit() {
  const N = S.nota, e = N.edit;
  if (!e || aiBusy() || e.busy) return;
  const val = editValue(e);
  if (e.sec === 'Vitales' && VITALS.some((v) => val[v[0]] !== null && !isFinite(val[v[0]]))) { e.err = 'Escribe solo números en los signos vitales.'; render(); return; }
  e.busy = true; e.err = ''; render();
  try {
    const r = await api('POST', '/api/v1/editar', { date: dayKey(S.day), id: N.cid, edits: { [e.sec]: val } });
    if (r.draft) {
      N.draft = r.draft;
      if (N.turn) { N.turn.draft = r.draft; if (r.preview && typeof r.preview === 'object') N.turn.preview = r.preview; else if (N.turn.preview) delete N.turn.preview[e.sec]; }     // la PC manda el texto ya hecho con lo editado
    }
    N.edit = null; N.dirty = true;
  } catch (x) { if (x.handled) return; e.busy = false; e.err = errText(x); }
  render();
}

// --- guardar sección y terminar
async function saveSection(sec) {           // devuelve true si la PC la recibió para mandarla a Neo
  const N = S.nota;
  if (aiBusy() || N.saving[sec]) return false;
  if (N.edit && N.edit.sec === sec) { N.saveErr[sec] = 'Primero toca «Listo» para terminar de editar.'; render(); return false; }
  N.saving[sec] = true; N.saveErr[sec] = ''; N.warn[sec] = ''; render();
  let ok = false;
  try {
    const r = await api('POST', '/api/v1/guardar-seccion', { date: dayKey(S.day), id: N.cid, section: sec });
    addLocalCola(r.qid, sec);
    if (r.warning) N.warn[sec] = r.warning;
    N.dirty = true; ok = true;
    if (N.pin === sec) unpin(N);                  // ya va para Neo: deja de estar marcada
    refreshNota();
  } catch (e) {
    if (!e.handled) {
      // Se perdió la respuesta o la PC dice que ya estaba guardada: la PC pudo haberla puesto en cola. Se mira cómo quedó antes de mostrar un error.
      if (!(e.status === 409 && /ya está guardada/i.test(e.message || ''))) N.saveErr[sec] = errText(e);
      N.dirty = true;
      await refreshNota();
      if (S.nota === N) { ensureCola(true); if (secState(sec).locked && !noteClosed()) { N.saveErr[sec] = ''; ok = true; } pinCheck(N); }
    }
  }
  N.saving[sec] = false; render();
  return ok;
}
// «Guardar todo en Neo»: las secciones con texto que faltan, una tras otra, con el mismo «Guardar sección» de cada tarjeta.
// P con solo lo cobrado no se manda (se cerraría y lo que se dicte después se perdería): eso se pone con su botón o al terminar.
const saveAllList = (N) => sections().filter((s) => ownFilled(N.draft || {}, s) && !secState(s).locked && !secState(s).pending && !N.saving[s]);
const canSaveAll = (N) => !N.saveAll && !N.finishing && !aiBusy() && !N.edit && !noteClosed() && saveAllList(N).length > 0;
async function saveAll() {
  const N = S.nota;
  if (!N || N.saveAll || noteClosed()) return;
  if (N.edit) { toast(MSG_EDITANDO); return; }
  if (aiBusy()) return;
  const list = saveAllList(N);
  if (!list.length) return;
  N.saveAll = { i: 0, n: list.length };
  let sent = 0, bad = 0;
  const left = [];                                                           // las que no se mandaron y no tienen aviso en su tarjeta
  for (let k = 0; k < list.length; k++) {
    if (S.nota !== N || aiBusy() || noteClosed()) { left.push(...list.slice(k)); break; }
    N.saveAll.i = k + 1; render();
    const st = secState(list[k]);
    if (st.locked || st.pending) { sent++; continue; }                      // ya va para Neo: no se manda dos veces
    if (await saveSection(list[k])) sent++;
    else if (S.nota === N && N.saveErr[list[k]]) bad++;                      // falló y su tarjeta lo dice
    else left.push(list[k]);
  }
  if (S.nota !== N) return;
  N.saveAll = null; render();
  const sec = (n) => n + (n === 1 ? ' sección' : ' secciones');
  if (sent === list.length) { toast('Listo: mandé ' + sec(sent) + ' a Neo.'); return; }
  const t = [];
  if (sent) t.push('Mandé ' + sec(sent) + ' a Neo.');
  if (bad) t.push(bad === list.length ? 'No se pudo mandar nada a Neo. Mira el aviso en cada tarjeta.' : (bad === 1 ? 'Una no se pudo' : bad + ' no se pudieron') + ': mira el aviso en su tarjeta.');
  if (left.length) t.push('No se mandaron todavía: ' + left.map((x) => SEC_SHORT[x]).join(', ') + '.');
  toast(t.join(' '));
}
function saveAllBtn(N) {
  const s = N.saveAll;
  return '<button class="btn save block" id="saveAllBtn" data-act="saveAll"' + (canSaveAll(N) ? '' : ' disabled') + '>' + (s ? spin() + 'Guardando ' + s.i + ' de ' + s.n + '…' : 'Guardar todo en Neo') + '</button>';
}
function askFinish() {
  const N = S.nota;
  if (!N || aiBusy() || N.edit || N.finishing || N.saveAll) return;
  const wait = sections().filter((s) => filled(s) && (secState(s).pending || N.saving[s]));          // ya mandadas: se están guardando
  const d = N.draft || {};                                                                             // P solo con lo cobrado no se pierde: se pone al terminar
  const open = sections().filter((s) => ownFilled(d, s) && !secState(s).locked && wait.indexOf(s) < 0);
  let t = open.length
    ? 'Estas secciones tienen texto pero no las has guardado en Neo: ' + open.map((s) => SEC_SHORT[s]).join(', ') + '. Si terminas ahora, se perderán.'
    : 'Se guardará lo que falta' + (autoP(d).length && !secState('P').locked ? ', lo que se cobró se pone en el Plan' : '') + ' y se agregará lo que el cliente declinó. Después ya no se puede cambiar desde aquí.';
  if (wait.length) t += ' Estas ya las mandaste y se están guardando: ' + wait.map((s) => SEC_SHORT[s]).join(', ') + '.';
  S.sheet = { type: 'confirm', title: 'Terminar la nota', text: t, ok: open.length ? 'Terminar así' : 'Sí, terminar', act: 'doFinish', cancel: open.length ? 'Guardar todo primero' : 'Todavía no', cancelAct: open.length ? 'saveAllFirst' : '', first: open[0] || '', bad: open.length > 0 };
  render();
}
async function doFinish() {
  const N = S.nota; S.sheet = null;
  if (aiBusy() || N.edit || N.saveAll) { render(); return; }
  N.finishing = true; N.finishErr = ''; render();
  try {
    const r = await api('POST', '/api/v1/terminar', { date: dayKey(S.day), id: N.cid });
    addLocalCola(r.qid, 'Terminar');
  } catch (e) { N.finishing = false; if (!e.handled) N.finishErr = errText(e); }
  render();
}

// --- micrófono
const micOk = () => S.model.ready !== false;
function micBusy() { return S.mic.state === 'cargando' || S.mic.state === 'transcribiendo'; }
async function micTap() {
  const N = S.nota;
  if (!N) return;
  if (S.mic.state === 'idle') {
    if (N.busy || N.edit) return;
    if (!micOk()) { S.mic.err = 'Falta el modelo de voz. Entra a Ajustes e importa el modelo, o escribe tu respuesta.'; render(); return; }
    S.mic.err = ''; S.mic.state = 'escuchando'; render();
    try { await call('micStart', {}, 15000); } catch (e) { S.mic.state = 'idle'; S.mic.err = 'No se pudo prender el micrófono. Abre los ajustes del teléfono, entra a esta app y dale permiso al micrófono. Mientras tanto puedes escribir.'; render(); }
  } else if (S.mic.state === 'escuchando') {
    S.mic.state = 'transcribiendo'; render(); armTranscribe();
    try { await call('micStop', {}, 15000); } catch (e) { S.mic.state = 'idle'; S.mic.err = errText(e); render(); }
  }
}
function armTranscribe() { clearT('mic'); T.mic = setTimeout(() => { if (S.mic.state === 'transcribiendo') { S.mic.state = 'idle'; S.mic.err = 'No se pudo pasar la voz a texto. Intenta otra vez o escribe.'; render(); } }, CFG.transcribiendo); }
function micCancelQuiet() { if (S.mic && (S.mic.state === 'escuchando' || S.mic.state === 'transcribiendo' || S.mic.state === 'cargando')) { call('micCancel', {}, 5000).catch(() => {}); } S.mic.state = 'idle'; clearT('mic'); }
async function micCancel() { micCancelQuiet(); render(); }
function onEvent(ev, data) {
  if (ev === 'mic_level') {
    const v = Math.max(0, Math.min(1, Math.sqrt(Math.max(0, Number(data && typeof data === 'object' ? data.level : data) || 0)) * 1.4));
    const b = $('#micBtn'); if (b) b.style.setProperty('--lvl', v.toFixed(2));
  } else if (ev === 'mic_status') {
    const s = String(data && typeof data === 'object' ? data.status : data || '');
    if (/^Listening/i.test(s)) S.mic.state = 'escuchando';
    else if (/^Transcribing/i.test(s)) { S.mic.state = 'transcribiendo'; armTranscribe(); }
    else if (/^(Waiting for model|Loading model)/i.test(s)) S.mic.state = 'cargando';
    else if (/^Error/i.test(s)) { S.mic.state = 'idle'; S.mic.err = 'El micrófono falló. Intenta otra vez o escribe tu respuesta.'; }
    else if (/^Ready/i.test(s) && S.mic.state === 'escuchando') { /* «Ready» del motor mientras se graba: se sigue escuchando */ }
    else if (/^(Ready|Cancel)/i.test(s)) {
      if (S.mic.state === 'transcribiendo' && /^Ready/i.test(s)) { clearT('mic'); T.mic = setTimeout(() => { if (S.mic.state === 'transcribiendo') { S.mic.state = 'idle'; S.mic.err = 'No se escuchó nada. Intenta otra vez o escribe.'; render(); } }, 2500); }
      else S.mic.state = 'idle';
    }
    render();
  } else if (ev === 'mic_text') {
    clearT('mic');
    S.mic.state = 'idle';
    const t = String(data && typeof data === 'object' ? data.text : data || '').trim();
    const N = S.nota;
    if (!t) S.mic.err = 'No se escuchó nada. Intenta otra vez o escribe.';
    else if (N) { S.mic.err = ''; N.text = (N.text ? N.text + ' ' : '') + t; N.typing = true; }
    render();
  }
}
async function modelStatus() {
  try { const r = await call('modelStatus', {}, 8000); S.model = { ready: !!r.ready, name: r.name || '', status: r.status || '' }; } catch (e) { S.model = { ready: null, name: '', status: '' }; }
  if (S.screen === 'nota' || S.screen === 'ajustes') render();
}

// ---------------------------------------------------------------- ajustes
async function loadAjustes() { S.aj.err = ''; modelStatus(); try { S.device = (await call('deviceName', {}, 5000)).name || S.device; } catch (e) { /* sin nombre */ } if (S.screen === 'ajustes') render(); }
async function doImport() {
  S.aj.err = '';
  try { await call('importModel', {}, 15000); toast('Elige el archivo del modelo de voz.'); } catch (e) { S.aj.err = errText(e); render(); }
}
// La PC cambió de certificado (otra PC o Neo Records reinstalado): el teléfono deja de confiar en ella y la busca de nuevo.
function askForget() { S.sheet = { type: 'confirm', title: 'Olvidar esta computadora', text: 'El teléfono dejará de confiar en la computadora guardada y tendrás que entrar otra vez con tu usuario y contraseña. Úsalo solo si cambiaron la computadora o reinstalaron Neo Records.', ok: 'Sí, olvidarla', act: 'doForget', cancel: 'Cancelar' }; render(); }
async function doForget() {
  S.sheet = null; S.aj.busy = 'Olvidando…'; render();
  let err = '';
  try { await call('forget', {}, 15000); } catch (e) { err = errText(e); }
  S.aj.busy = '';
  if (!err) S.keep = {};
  if (err) { if (S.screen === 'ajustes') S.aj.err = err; else S.login.err = err; render(); return; }
  S.user = null; S.pc = null; resetWork(); S.login = newLogin(); replace('entrar'); toast('Listo. Ahora busco la computadora otra vez.'); discover();
}
function askLogout() { S.sheet = { type: 'confirm', title: 'Salir de la cuenta', text: 'Tendrás que entrar otra vez con tu usuario y contraseña.', ok: 'Sí, salir', act: 'doLogout', cancel: 'Quedarme' }; render(); }
async function doLogout() {
  S.keep = {};
  S.sheet = null; S.aj.busy = 'Saliendo…'; render();
  try { await call('logout', {}, 15000); } catch (e) { /* aun así se sale de la pantalla */ }
  S.aj.busy = ''; S.user = null; resetWork(); S.login = newLogin(); replace('entrar'); discover();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (S.screen === 'ajustes') modelStatus();
  else if (S.screen === 'hoy' && S.user && rollDay()) loadHoy(false);
});

// ---------------------------------------------------------------- avisos
function toast(msg) {
  const t = $('#toast');
  t.innerHTML = '<div>' + esc(msg) + '</div>';
  clearT('toast');
  T.toast = setTimeout(() => { t.innerHTML = ''; }, CFG.toast);
}

// ---------------------------------------------------------------- pantallas
const topBar = (o) => '<div class="top-l">' + (o.back ? '<button class="icon-btn" data-act="back" aria-label="Volver">' + ic('back') + '</button>' : PAW) + '</div>' +
  '<div class="top-t"><b>' + esc(o.title) + '</b>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</div><div class="top-r">' + (o.right || '') + '</div>';

function vBoot() { return { top: topBar({ title: 'Neo Records' }), main: '<div class="wait">' + spin('big') + '<span>Abriendo…</span></div>' }; }

const FORGET_BTN = (cls) => '<button class="btn ' + cls + ' block" data-act="askForget">Olvidar esta computadora</button>';
function vEntrar() {
  const L = S.login;
  // «Olvidar» es la acción principal solo cuando la de siempre cambió de certificado; si fue otra computadora, queda al final y sin color.
  const forgetFirst = () => (L.otra && !L.rogue ? FORGET_BTN('primary') : '');
  const forgetLast = () => (L.otra && L.rogue ? FORGET_BTN('ghost') : '');
  let main = '', bar = '';
  const notice = L.notice ? '<div class="msg warn">' + ic('alert') + '<span>' + esc(L.notice) + '</span></div>' : '';
  if (L.phase === 'buscando') {
    main = notice + '<div class="radar" aria-hidden="true">' + PAW + '<i></i><i></i><i></i></div>' +
      '<h1 class="center" role="status">' + (L.busy === 'conectando' ? 'Conectando con la computadora…' : 'Buscando la computadora de la clínica…') + '</h1>' +
      '<p class="muted center">Tu teléfono tiene que estar en el wifi de la clínica.</p>';
    if (L.canManual) bar = '<button class="btn ghost block" data-act="manual">Escribir la dirección a mano</button>';
  } else if (L.phase === 'varias') {
    main = notice + '<h1>Elige la computadora</h1><p class="muted">' + (L.hadLast ? 'No encontré la computadora de siempre. Encontré ' + (L.pcs.length === 1 ? 'esta otra' : 'estas otras') + '. Toca la de la clínica solo si la reconoces.' : 'Encontré más de una. Toca la de la clínica.') + '</p><div class="pcs">' +
      L.pcs.map((p) => '<button class="btn ghost block" data-act="pick" data-host="' + esc(p.host) + '">' + ic('wifi') + esc(p.name || p.host) + '</button>').join('') + '</div>';
    bar = '<button class="btn ghost block" data-act="rescan">Buscar otra vez</button>';
  } else if (L.phase === 'no') {
    main = notice + '<h1>' + (L.rogue ? 'Esa no es la computadora de la clínica' : L.otra ? 'La computadora cambió' : 'No encontré la computadora') + '</h1>' + (L.err ? '<div class="msg err">' + ic('alert') + '<span>' + esc(L.err) + '</span></div>' : '') +
      (L.otra ? '' : '<div class="card flat"><p><b>Revisa estas tres cosas:</b></p><ul><li>La computadora de la clínica está prendida.</li><li>Neo Records está abierto en ella.</li><li>Tu teléfono está en el wifi de la clínica.</li></ul></div>');
    bar = forgetFirst() + '<button class="btn ' + (L.otra && !L.rogue ? 'ghost' : 'primary') + ' block" data-act="rescan">Buscar otra vez</button>' + '<button class="btn ghost block" data-act="manual">Escribir la dirección a mano</button>' + forgetLast();
  } else if (L.phase === 'manual') {
    main = '<h1>Dirección de la computadora</h1><p class="muted">Pídesela a quien se encarga de la computadora. Son números separados por puntos (a veces con dos puntos y otro número al final).</p>' +
      (L.err ? '<div class="msg err">' + ic('alert') + '<span>' + esc(L.err) + '</span></div>' : '') +
      '<label class="field"><span>Dirección</span><input class="input" id="hostIn" data-bind="login.hostInput" value="' + esc(L.hostInput) + '" inputmode="decimal" autocomplete="off" autocapitalize="none" spellcheck="false"></label>';
    bar = forgetFirst() + '<button class="btn ' + (L.otra && !L.rogue ? 'ghost' : 'primary') + ' block" data-act="connectManual">Conectar</button><button class="btn ghost block" data-act="rescan">Buscar sola otra vez</button>' + forgetLast();
  } else {
    const busy = L.busy === 'entrando';
    main = notice + '<div class="msg ok">' + ic('check') + '<span>Encontré la computadora <b>' + esc(S.pc ? S.pc.name : '') + '</b>.</span></div>' +
      '<h1>Entra con tu cuenta</h1>' + (L.err ? '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(L.err) + '</span></div>' : '') +
      '<label class="field"><span>Usuario</span><input class="input" id="userIn" data-bind="login.user" value="' + esc(L.user) + '" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label>' +
      '<label class="field"><span>Contraseña</span><span class="pw"><input class="input" id="passIn" data-bind="login.pass" type="' + (L.show ? 'text' : 'password') + '" value="' + esc(L.pass) + '" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false">' +
      '<button class="icon-btn" data-act="showPw" type="button" aria-label="' + (L.show ? 'Ocultar la contraseña' : 'Ver la contraseña') + '" aria-pressed="' + L.show + '">' + ic(L.show ? 'eyeoff' : 'eye') + '</button></span></label>' +
      '<p class="hint">Si olvidaste tu contraseña, pídele a quien se encarga de Neo Records que la reinicie en la computadora.</p>';
    bar = '<button class="btn primary block" id="loginBtn" data-act="login"' + ((busy || !L.user.trim() || !L.pass) ? ' disabled' : '') + '>' + (busy ? spin() + 'Entrando…' : 'Entrar') + '</button>' +
      (busy ? '' : forgetFirst() + '<button class="btn ghost block" data-act="rescan">Buscar la computadora otra vez</button>' + forgetLast());
  }
  return { top: topBar({ title: 'Neo Records', sub: S.pc && S.login.phase === 'form' ? S.pc.name : '' }), main, bar };
}

function vClave() {
  const C = S.cp, un = S.user && S.user.user;
  const pol = policy(C.nw, un, C.old, C.rep);
  const t = C.show ? 'text' : 'password';
  const main = (C.forced ? '<div class="msg warn">' + ic('alert') + '<span>Tu contraseña es temporal. Elige una nueva para seguir.</span></div>' : '') +
    '<h1>Cambiar contraseña</h1>' + (C.err ? '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(C.err) + '</span></div>' : '') +
    '<label class="field"><span>' + (C.forced ? 'Contraseña temporal' : 'Contraseña de ahora') + '</span><input class="input" id="oldIn" data-bind="cp.old" type="' + t + '" value="' + esc(C.old) + '" autocomplete="off" autocapitalize="none" spellcheck="false"></label>' +
    '<label class="field"><span>Contraseña nueva</span><span class="pw"><input class="input" id="nwIn" data-bind="cp.nw" type="' + t + '" value="' + esc(C.nw) + '" autocomplete="off" autocapitalize="none" spellcheck="false">' +
    '<button class="icon-btn" data-act="showCp" type="button" aria-label="' + (C.show ? 'Ocultar las contraseñas' : 'Ver las contraseñas') + '" aria-pressed="' + C.show + '">' + ic(C.show ? 'eyeoff' : 'eye') + '</button></span></label>' +
    '<label class="field"><span>Repite la contraseña nueva</span><input class="input" id="repIn" data-bind="cp.rep" type="' + t + '" value="' + esc(C.rep) + '" autocomplete="off" autocapitalize="none" spellcheck="false"></label>' +
    '<ul class="checks" id="cpChecks">' + pol.map(checkLi).join('') + '</ul>';
  const bar = '<button class="btn save block" id="cpBtn" data-act="doCp"' + ((C.busy || !cpOk()) ? ' disabled' : '') + '>' + (C.busy ? spin() + 'Guardando tu contraseña…' : 'Guardar contraseña') + '</button>' +
    (C.forced ? '<button class="btn ghost block" data-act="askLogout">Salir y entrar con otra cuenta</button>' : '');
  return { top: topBar({ title: 'Cambiar contraseña', sub: S.user ? S.user.name : '', back: !C.forced }), main, bar };
}
const checkLi = (x) => '<li class="' + (x.ok ? 'ok' : '') + '">' + ic(x.ok ? 'check' : 'circle') + '<span>' + esc(x.t) + '</span></li>';

function vHoy() {
  const H = S.hoy;
  let body = '';
  const mine = (H.rows || []).filter((r) => r.mio), others = (H.rows || []).filter((r) => !r.mio);
  const rowHtml = (r) => {
    const e = ESTADOS[r.estado] || [r.estado || '', 'nota'];
    return '<button class="cons' + (r.mio ? ' mine' : '') + '" data-act="open" data-id="' + esc(r.id) + '"><span class="who"><b>' + esc(r.patient) + '</b><span>' + esc(speciesEs(r.species)) + (r.client ? ' · ' + esc(r.client) : '') + '</span>' +
      (r.description ? '<span>' + esc(r.description) + '</span>' : '') + (!r.mio && r.provider ? '<span>' + esc(r.provider) + '</span>' : '') + '</span><span class="side"><span class="tag ' + e[1] + '">' + esc(e[0]) + '</span>' + ic('next').replace('<svg ', '<svg class="chev" ') + '</span></button>';
  };
  if (H.err) body = '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(H.err) + '</span></div><button class="btn ghost block" data-act="reload">Intentar otra vez</button><button class="btn ghost block" data-act="rescanHoy">Buscar la computadora otra vez</button>';
  else if (H.rows === null) body = '<div class="wait" role="status">' + spin('big') + '<span>Buscando las consultas en Neo…</span></div>';
  else {
    if (H.srvErr) body += '<div class="msg warn">' + ic('alert') + '<span>' + esc(H.srvErr) + '</span></div>';
    if (H.loading) body += '<div class="wait" role="status">' + spin() + '<span>Neo está cargando la lista…</span></div>';
    if (!H.rows.length && !H.loading) body += '<div class="card center"><p><b>No hay consultas este día.</b></p><p class="muted">Usa las flechas para ver otro día.</p></div>';
    if (mine.length) body += '<div class="list-h">Mis consultas · ' + mine.length + '</div>' + mine.map(rowHtml).join('');
    if (others.length) body += '<div class="list-h">' + (mine.length ? 'Otras consultas' : 'Consultas') + ' · ' + others.length + '</div>' + others.map(rowHtml).join('');
  }
  const nav = '<div class="daynav"><button class="icon-btn" data-act="prevDay" aria-label="Día anterior">' + ic('back') + '</button><div class="day"><b>' + esc(dayLabel(S.day)) + '</b><small>' + esc(daySub(S.day)) + (H.updated ? ' · Actualizado ' + esc(H.updated) : '') + '</small></div><button class="icon-btn" data-act="nextDay" aria-label="Día siguiente">' + ic('next') + '</button></div>' +
    (sameDay(S.day, new Date()) ? '' : '<button class="btn ghost block today" data-act="today">Ir a hoy</button>');
  const bar = '<button class="btn primary block" data-act="refresh"' + (H.loading ? ' disabled' : '') + '>' + (H.loading ? spin() + 'Actualizando…' : ic('refresh') + 'Actualizar') + '</button>';
  return { top: topBar({ title: 'Consultas', sub: S.user ? S.user.name : '', right: '<button class="icon-btn" data-act="ajustes" aria-label="Ajustes">' + ic('gear') + '</button>' }), main: nav + body, bar };
}

const vitalCell = (lbl, v, u) => '<div><b>' + (v == null || v === '' ? '—' : esc(v) + ' <small>' + esc(u) + '</small>') + '</b><span>' + esc(lbl) + '</span></div>';
function oGridNeo(c) {
  return '<div class="ogrid">' + O_ROWS.map((r) => {
    const o = (c.o_rows || {})[r] || {};
    return '<div class="r"><span class="n">' + esc(r) + '</span>' + (o.state ? '<span class="chip ' + esc(o.state) + '">' + esc(o.state) + '</span>' : '<span class="chip dim">Vacío</span>') + (o.note ? '<span class="note">' + esc(o.note) + '</span>' : '') + '</div>';
  }).join('') + '</div>';
}
function colaItemsHtml(items) {
  if (!items.length) return '';
  return '<ul class="queue">' + items.map((it) => { const st = tagOf(it.status); return '<li><span>' + esc(sectionName(it.section)) + (it.detail && it.status === 'error' ? '<br><small class="muted">' + esc(it.detail) + '</small>' : '') + '</span><span class="tag ' + st[1] + '">' + (it.status === 'guardando' ? spin() : '') + esc(st[0]) + '</span></li>'; }).join('') + '</ul>';
}
const sectionName = (s) => ({ SOAP: 'Crear SOAP', Plantilla: 'Plantilla de cirugía', Terminar: 'Terminar la nota' })[s] || (SEC_TITLE[s] ? SEC_SHORT[s] : s || 'Nota');

function vConsulta() {
  const K = S.cons, c = K.c, row = K.row || {};
  const top = topBar({ back: true, title: (c && c.patient) || row.patient || 'Consulta', sub: dayLabel(S.day) });
  if (K.loading && !c) return { top, main: '<div class="wait" role="status">' + spin('big') + '<span>Leyendo la consulta de Neo…</span></div>' };
  if (!c) return { top, main: '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(K.err || MSG_FALLA) + '</span></div><button class="btn ghost block" data-act="reloadCons">Intentar otra vez</button>' };
  const e = ESTADOS[c.estado] || [c.estado || '', 'nota'];
  let m = '<div class="card hdr"><h1>' + esc(c.patient) + '</h1><p class="sub">' + esc(speciesEs(c.species)) + (c.client ? ' · ' + esc(c.client) : '') + '</p>' +
    '<span class="tag ' + e[1] + '">' + esc(e[0]) + '</span>' + (c.provider ? ' <span class="tag">' + esc(c.provider) + '</span>' : '') + (c.description ? '<p class="desc">' + esc(c.description) + '</p>' : '') + '</div>';
  if (K.err) m += '<div class="msg err">' + ic('alert') + '<span>' + esc(K.err) + '</span></div>';
  if (c.locked) m += '<div class="msg warn">' + ic('lock') + '<span>Esta nota está bloqueada en Neo. Aquí solo se puede mirar.</span></div>';
  if ((c.alerts || []).length) m += '<div class="card amber alerts"><h3>Avisos de Neo</h3><ul>' + c.alerts.map((a) => '<li>' + ic('alert') + '<span>' + esc(a) + '</span></li>').join('') + '</ul></div>';
  const q = colaOf();
  if (q.length) m += '<div class="card flat"><h3>Lo que va para Neo</h3>' + colaItemsHtml(q) + '</div>';
  const soap = c.soap || {};
  const cell = (lab, v) => '<div class="cell"><p class="lab">' + esc(lab) + '</p><div class="v' + (v && String(v).trim() ? '' : ' empty') + ' en" lang="en">' + (v && String(v).trim() ? esc(v) : 'Vacío') + '</div></div>';
  if (c.has_soap) {
    m += '<div class="card"><h3>Lo que hay en Neo</h3>' + cell('S · Motivo', soap.s) + (testsText({ tests: soap.tests }) ? cell("O · Doctor's Notes", testsText({ tests: soap.tests })) : '') + cell('A · Diagnóstico', soap.a) + cell('P · Plan', soap.p) + cell('Recheck', soap.recheck) + '</div>';
    m += '<div class="card"><h3>O · Examen</h3>' + oGridNeo(c) + '</div>';
  } else if ((c.notes_text || '').trim()) {
    m += '<div class="card"><h3>Nota en Neo</h3><div class="v en" lang="en">' + esc(c.notes_text) + '</div></div>';
  } else if (!prepPending()) {
    m += '<div class="card"><h3>La nota está vacía</h3><p class="muted">Primero hay que crear el SOAP o poner una plantilla de cirugía.</p></div>';
  }
  const vv = c.vitals || {};
  if (VITALS.some((v) => vv[v[0]] != null)) m += '<div class="card"><h3>Signos vitales en Neo</h3><div class="vit">' + VITALS.map((v) => vitalCell(v[1], vv[v[0]], v[2])).join('') + '</div></div>';
  if ((c.lines || []).length) m += '<div class="card"><h3>Lo que se cobró</h3><ul class="lines">' + c.lines.map((l) => '<li class="' + (l.declined ? 'declined' : '') + '"><span class="nm">' + esc(l.name) + (l.label ? '<small>' + esc(l.label) + '</small>' : '') + '</span><span>' + (l.declined ? '<span class="tag red">Declinado</span>' : (l.qty ? '× ' + esc(l.qty) : '')) + '</span></li>').join('') + '</ul></div>';
  const empty = !c.has_soap && !(c.notes_text || '').trim() && !prepPending();
  const can = canInterview(c);
  if (K.prepErr) m += '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(K.prepErr) + '</span></div>';
  if (K.busyPrep) m += '<div class="wait" role="status">' + spin() + '<span>' + esc(K.busyPrep) + '</span></div>';
  else if (prepPending()) {
    const p = colaOf().filter((it) => /^(SOAP|Plantilla)$/.test(it.section)).pop();
    m += '<div class="card green" role="status"><div class="wait">' + spin() + '<span>' + (p && p.section === 'Plantilla' ? 'Poniendo la plantilla en Neo' : 'Creando el SOAP en Neo') + '… (' + esc(tagOf(p && p.status)[0]) + ')</span></div><p class="hint">Ya puedes empezar la nota con la IA mientras tanto.</p></div>';
  }
  if (!c.locked && (empty || (!c.has_soap && !(c.notes_text || '').trim()))) {
    m += '<div class="card prep"><h3>Preparar la nota</h3><button class="btn ' + (empty ? 'primary' : 'ghost') + ' block" data-act="askSoap"' + (K.busyPrep || prepPending() ? ' disabled' : '') + '>' + ic('doc') + 'Crear SOAP</button>' +
      '<button class="btn ghost block" data-act="askPlantilla"' + (K.busyPrep || prepPending() ? ' disabled' : '') + '>' + ic('heart') + 'Plantilla de cirugía</button></div>';
  }
  const dst = (K.draftInfo || {}).state, lbl = dst === 'terminada' ? 'Ver la nota terminada' : dst === 'empezada' ? 'Seguir con la nota' : 'Empezar nota con IA';
  const bar = '<button class="btn primary block" data-act="empezar"' + (can ? '' : ' disabled') + '>' + ic('mic') + lbl + '</button>' +
    (can ? '' : '<p class="note">' + esc(c.locked ? 'La nota está bloqueada en Neo.' : (c.aviso || 'Primero toca Crear SOAP o Plantilla de cirugía')) + '</p>');
  return { top, main: m, bar };
}

// --- tarjetas de la nota
function oCard(sec, st) {
  const N = S.nota, d = N.draft || {}, c = N.c || {};
  const ed = N.edit && N.edit.sec === 'O' ? N.edit : null;
  if (ed) {
    return '<div class="edit-o">' + O_ROWS.map((r) => {
      const neo = ((c.o_rows || {})[r] || {});
      if (neo.state) return '<div class="r"><p class="n">' + esc(r) + ' <span class="tag">Ya está en Neo</span></p></div>';
      const cur = ed.rows[r] || { state: '', note: '' };
      return '<div class="r"><p class="n">' + esc(r) + '</p><div class="opts">' + O_STATES.map((s) => '<button class="opt ' + s + '" data-act="oState" data-row="' + esc(r) + '" data-state="' + s + '" aria-pressed="' + (cur.state === s) + '">' + s + '</button>').join('') + '</div>' +
        (cur.state === 'Abnormal' ? '<input class="input" data-bind="oNote" data-key="' + esc(r) + '" value="' + esc(cur.note) + '" placeholder="¿Qué se vio?" aria-label="Nota de ' + esc(r) + '">' : '') + '</div>';
    }).join('') + '<label class="small"><input type="checkbox" data-bind="oRest"' + (ed.rest ? ' checked' : '') + '> Lo demás está normal (WNL)</label></div>';
  }
  const rows = O_ROWS.map((r) => {
    const neo = (c.o_rows || {})[r] || {};
    const dr = (d.objective || []).find((f) => f.row === r);
    let chip, note = '';
    if (neo.state) { chip = '<span class="chip ' + esc(neo.state) + '">' + esc(neo.state) + '</span> <small class="muted">en Neo</small>'; note = neo.note; }
    else if (dr) { chip = '<span class="chip ' + esc(dr.state) + '">' + esc(dr.state) + '</span>'; note = dr.note; }
    else if (d.objective_rest_normal) chip = '<span class="chip WNL dim">WNL</span>';
    else chip = '<span class="chip dim">—</span>';
    return '<div class="r"><span class="n">' + esc(r) + '</span><span>' + chip + '</span>' + (note ? '<span class="note en" lang="en">' + esc(note) + '</span>' : '') + '</div>';
  }).join('');
  return '<div class="ogrid">' + rows + '</div>' + (d.objective_rest_normal ? '<p class="hint">«Lo demás normal»: las filas sin nota se escriben como WNL.</p>' : '');
}
function vitCard() {
  const N = S.nota, d = N.draft || {}, c = N.c || {};
  const ed = N.edit && N.edit.sec === 'Vitales' ? N.edit : null;
  if (ed) {
    return '<div class="vedit">' + VITALS.map((v) => '<label class="field"><span>' + v[1] + ' (' + v[2] + ')</span><input class="input" inputmode="decimal" data-bind="vit" data-key="' + v[0] + '" value="' + esc(ed.vit[v[0]]) + '"></label>').join('') + '</div>';
  }
  return VITALS.map((v) => {
    const o = (c.vitals || {})[v[0]], n = (d.vitals || {})[v[0]];
    return '<div class="vrow"><span class="n">' + v[1] + '</span><span class="val">' + (o == null ? '<span class="old">Neo: vacío</span>' : '<span class="old">Neo: ' + esc(o) + ' ' + v[2] + '</span>') +
      (n != null ? ' → <span class="new">nuevo: ' + esc(n) + ' ' + v[2] + '</span>' : '') + '</span></div>';
  }).join('');
}
function bodyCard(sec) {
  const N = S.nota;
  if (sec === 'O') return oCard(sec);
  if (sec === 'Vitales') return vitCard();
  const ed = N.edit && N.edit.sec === sec ? N.edit : null;
  if (ed) return '<textarea class="input" data-bind="edit.text" id="editTx" lang="en" aria-label="Texto en inglés de ' + esc(SEC_SHORT[sec]) + '"' + (sec === 'Notas' ? ' placeholder="Resultados de tests, lo que viste y otras notas (inglés)"' : '') + '>' + esc(ed.text) + '</textarea>' + (LIST_SEC[sec] ? '<p class="hint">Una línea por cada renglón.</p>' : '');
  const lines = enLines(sec);
  if (!lines.length) return '<p class="en empty">Todavía no hay nada aquí. Habla o escribe lo que va en esta parte.</p>';
  if (LIST_SEC[sec]) return '<ul class="en" lang="en">' + lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>';
  return '<p class="en" lang="en">' + esc(lines.join('\n')) + '</p>';
}
function card(sec) {
  const N = S.nota, d = N.draft || {}, t = N.turn || {};
  const st = secState(sec);
  const isT = N.target === sec;
  const ready = (t.complete || []).indexOf(sec) >= 0 && !st.locked && filled(sec);
  const ed = N.edit && N.edit.sec === sec;
  const es = (d.text_es || {})[sec];
  const tg = tagOf(st.status);
  const chip = st.status ? '<span class="tag ' + tg[1] + '">' + (st.status === 'guardando' ? spin() : '') + esc(tg[0]) + '</span>' : (N.saving[sec] ? '<span class="tag pen">' + spin() + 'Enviando…</span>' : '');
  const lockAI = aiBusy();
  const isP = N.pin === sec && !st.locked && !noteClosed();
  const cls = 'ncard' + (isT ? ' target' : '') + (isP ? ' pinned' : '') + (st.done ? ' saved' : '') + (N.changed.indexOf(sec) >= 0 ? ' changed' : '');
  let h = '<article class="' + cls + '" data-act="target" data-sec="' + sec + '" id="card-' + sec + '"><div class="nhead"><h3>' + esc(SEC_TITLE[sec]) + '</h3>' + chip + '</div>';
  if (isP) h += '<div class="pinline">' + ic('pin') + '<span>Marcada: todo lo que digas va solo aquí</span><button class="btn ghost small" data-act="unpin" aria-label="Quitar la marca de ' + esc(SEC_SHORT[sec]) + '">Quitar</button></div>';
  else if (isT && !st.locked) h += '<p class="here">' + ic('mic') + 'Aquí va lo que digas</p>';
  h += bodyCard(sec);
  if (AUTO[sec] && !st.locked && autoOpen(d, sec).length) h += '<p class="hint auto">' + ic('cart') + '<span>' + (sec === 'P' ? 'Lo que se cobró se pone solo en el Plan.' : 'Lo que se cobró para la casa se pone solo aquí.') + ' No hace falta decirlo.</span></p>';
  if (es && !ed) h += '<p class="es">Lo que dijiste: «' + esc(es) + '»</p>';
  if (st.done) h += '<div class="msg ok">' + ic('lock') + '<span><b>Guardada en Neo.</b> Ya no se puede cambiar desde aquí.</span></div>';
  if (st.doubt) h += '<div class="msg warn" role="alert">' + ic('alert') + '<span>' + esc(st.doubt) + '</span></div>';
  if (st.error) h += '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(st.detail || 'No se pudo guardar en Neo.') + (st.locked ? '' : ' Toca «Guardar sección» para intentar otra vez.') + '</span></div>';
  if (N.saveErr[sec]) h += '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(N.saveErr[sec]) + '</span></div>';
  if (N.warn[sec]) h += '<div class="msg warn" role="alert">' + ic('alert') + '<span>' + esc(N.warn[sec]) + '</span></div>';
  if (ed && N.edit.err) h += '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(N.edit.err) + '</span></div>';
  h += '<div class="nfoot">';
  if (ed) h += '<button class="btn save" data-act="editOk"' + ((N.edit.busy || lockAI) ? ' disabled' : '') + '>' + (N.edit.busy ? spin() + 'Guardando…' : 'Listo') + '</button><button class="btn ghost" data-act="editCancel">Cancelar</button>';
  else {
    h += '<button class="btn ghost" data-act="edit" data-sec="' + sec + '"' + ((st.locked || lockAI || N.saving[sec] || st.pending || N.edit || N.saveAll) ? ' disabled' : '') + '>' + ic('edit') + 'Editar</button>';
    const busy = N.saving[sec] || st.pending;
    h += '<button class="btn save' + (ready ? ' ready' : '') + '" data-act="save" data-sec="' + sec + '"' + ((st.locked || busy || lockAI || !filled(sec) || N.saveAll) ? ' disabled' : '') + '>' + (busy ? spin() + 'Guardando…' : (st.locked ? (st.error ? 'Revisar en Neo' : 'Guardada') : 'Guardar sección')) + '</button>';
  }
  return h + '</div></article>';
}
// La pregunta de arriba se puede achicar a una burbuja (S.qMin, sigue así en los turnos nuevos). La burbuja avisa con un punto si llegó una pregunta que no ha visto, con el giro si la IA piensa y con un punto rojo si hubo un error.
const curQ = (N) => N.localQ || (N.turn && N.turn.question) || null;
const qKey = (N) => { const q = curQ(N); return q ? String(N.cid) + '|' + (q.about || '') + '|' + (q.text_es || '') : ''; };
const qHead = (lab) => '<div class="qhead"><p class="qlab">' + lab + '</p><button class="icon-btn qmin" data-act="minQ" aria-label="Ocultar la pregunta (queda como burbuja arriba)">' + ic('up') + '<span>Ocultar</span></button></div>';
function bubbleHtml() {
  const N = S.nota, busy = N.busy === 'ia', err = !busy && !!N.err, nueva = !busy && !err && !!qKey(N) && qKey(N) !== N.seenQ;
  const why = busy ? ': la IA está pensando' : err ? ': hubo un error' : nueva ? ': hay una pregunta nueva' : '';
  return '<div class="qbub-wrap"><button class="qbub' + (err ? ' err' : nueva ? ' new' : '') + '" id="qBub" data-act="maxQ" aria-expanded="false" aria-label="Abrir la pregunta de la IA' + why + '">' +
    (busy ? spin() : ic(err ? 'alert' : 'chat')) + '<span>Pregunta de la IA</span>' + (err || nueva ? '<i class="qdot" aria-hidden="true"></i>' : '') + '</button></div>';
}
function bannerHtml() {
  const N = S.nota, t = N.turn;
  if (S.qMin) return bubbleHtml();
  if (N.busy === 'ia') return '<div class="banner" role="status">' + qHead('La IA') + '<p class="q wait">' + spin() + '<span>La IA está pensando…</span></p></div>';
  if (N.err) return '<div class="banner">' + qHead('La IA') + '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(N.err) + '</span></div><div class="quick"><button class="btn" data-act="retry"' + (N.edit || N.saveAll ? ' disabled' : '') + '>' + ic('refresh') + 'Reintentar</button></div>' + (N.edit ? '<p class="hint">Termina de editar la tarjeta («Listo» o «Cancelar») y luego toca Reintentar.</p>' : '') + '</div>';
  if (N.edit) return '<div class="banner">' + qHead('Editando') + '<p class="q">Termina de editar la tarjeta: toca «Listo» o «Cancelar».</p></div>';
  const q = curQ(N);
  if (q) {
    N.seenQ = qKey(N);            // la pregunta está a la vista: ya la vio
    // Con una tarjeta marcada, las respuestas rápidas de una pregunta sobre otra parte no se ofrecen: irían a la tarjeta marcada
    const other = !!(N.pin && q.section && q.section !== N.pin);
    const quick = N.localQ || other ? (other ? '<p class="hint pinq">Marcaste ' + esc(SEC_TITLE[N.pin]) + ': lo que digas va ahí. Para contestar esta pregunta, toca «Quitar» en esa tarjeta.</p>' : '') : (q.quick_replies_es || []).map((r, i) => '<button class="btn" data-act="quick" data-i="' + i + '"' + (N.edit ? ' disabled' : '') + '>' + esc(r) + '</button>').join('');
    return '<div class="banner">' + qHead(N.localQ ? 'Sugerencia' : 'La IA pregunta') + '<p class="q" id="qText">' + esc(q.text_es) + '</p><div class="quick">' + quick +
      (N.localQ ? '<button class="btn skip" data-act="dropSugg">Quitar</button>' : '<button class="btn skip" data-act="skip"' + (N.edit ? ' disabled' : '') + '>Saltar</button>') + '</div></div>';
  }
  if (t && t.done) return '<div class="banner done">' + qHead('Listo') + '<p class="q">Ya tengo todo. Revisa las tarjetas, guarda cada sección y toca «Terminar nota».</p></div>';
  return '<div class="banner">' + qHead('La IA') + '<p class="q">Habla o escribe lo que quieras agregar.</p></div>';
}
function setQMin(on) {
  const N = S.nota;
  S.qMin = !!on;
  if (N && on) N.seenQ = qKey(N);  // la que estaba a la vista ya la vio
  render();
  if (!on) { const b = $('.banner .qmin'); if (b) b.focus({ preventScroll: true }); }
  else { const b = $('#qBub'); if (b) b.focus({ preventScroll: true }); }
}
function finishBtn(N) {
  const lock = N.finishing || aiBusy() || !!N.edit || !!N.saveAll;
  return '<button class="btn primary block" data-act="askFinish"' + (lock ? ' disabled' : '') + '>' + (N.finishing ? spin() + 'Terminando la nota…' : aiBusy() ? spin() + 'La IA está pensando…' : 'Terminar nota') + '</button>';
}
function vNota() {
  const N = S.nota, c = N.c;
  const top = topBar({ back: true, title: (c && c.patient) || (S.cons && S.cons.row && S.cons.row.patient) || 'Nota', sub: 'Nota con IA', right: '<button class="icon-btn txt" data-act="revisar">Revisar</button>' });
  if (N.loading) return { top, main: '<div class="wait" role="status">' + spin('big') + '<span>Abriendo la nota…</span></div>' };
  if (N.err && !N.loaded) return { top, main: '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(N.err) + '</span></div><button class="btn ghost block" data-act="reloadNota">Intentar otra vez</button>' };
  const closed = noteClosed();
  pinCheck(N);                    // se guardó o se terminó la nota: la marca se quita sola
  let m = closed ? '<div class="banner done"><p class="qlab">Nota terminada</p><p class="q">Ya no se puede cambiar desde aquí. Si falta algo, corrígelo en Neo.</p></div>' : bannerHtml();
  if (!closed && noteMode() === 'simple') m += '<div class="msg warn">' + ic('note') + '<span>Esta nota ya tiene texto sin SOAP. La IA escribirá cada parte como un párrafo nuevo.</span></div>';
  m += sections().map(card).join('');
  if (closed) return { top, main: m, bar: '<button class="btn primary block" data-act="revisar">Ver el resumen</button>' };
  m += '<div class="card flat center finish">' + saveAllBtn(N) + finishBtn(N) +
    (N.finishErr ? '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(N.finishErr) + '</span></div>' : '') + '<p class="hint">' + (N.edit ? MSG_EDITANDO : 'Primero guarda cada sección (o toca «Guardar todo en Neo»). Al terminar se agrega lo que el cliente declinó.') + '</p></div>';
  // dock del micrófono
  const ms = S.mic.state, busy = N.busy === 'ia';
  const showBox = N.typing || !!N.text;
  let dock = '';
  const editing = !!N.edit;
  if (showBox) dock += '<div class="answer"><textarea class="input" id="ans" data-bind="nota.text" placeholder="Escribe o habla tu respuesta en español" aria-label="Tu respuesta en español">' + esc(N.text) + '</textarea>' +
    '<div class="row"><button class="btn primary" id="sendBtn" data-act="send"' + ((busy || editing || !String(N.text).trim()) ? ' disabled' : '') + '>' + ic('send') + 'Enviar a la IA</button><button class="btn ghost" data-act="clearText">Borrar</button></div></div>';
  const pinTx = N.pin ? 'Todo lo que digas va a ' + SEC_TITLE[N.pin] : '';
  const stText = ms === 'escuchando' ? 'Escuchando… toca el micrófono para terminar' : ms === 'transcribiendo' ? 'Transcribiendo…' : ms === 'cargando' ? 'Preparando la voz…' : busy ? 'La IA está pensando…' : editing ? 'Toca «Listo» o «Cancelar» en la tarjeta para volver a hablar.' : (!micOk() ? 'Falta el modelo de voz. Puedes escribir.' : (pinTx || (showBox ? '' : 'Toca el micrófono y habla')));
  if (S.mic.err && ms === 'idle' && !busy) dock += '<div class="msg warn" role="alert">' + ic('alert') + '<span>' + esc(S.mic.err) + '</span></div>';
  if (stText) dock += '<div class="status' + (ms === 'escuchando' ? ' live' : stText === pinTx ? ' pinned' : '') + '" role="status">' + (stText === pinTx ? ic('pin') : '') + (ms === 'transcribiendo' || ms === 'cargando' || busy ? spin() : '') + '<span>' + esc(stText) + '</span>' + (ms === 'escuchando' ? '<button class="btn link" data-act="micCancel">Cancelar</button>' : '') +
    (!micOk() && ms === 'idle' && !busy && !editing ? '<button class="btn link" data-act="ajustes">Ir a Ajustes</button>' : '') + '</div>';
  const nSug = ((N.turn && N.turn.suggestions) || []).length;
  dock += '<div class="ctl"><button class="btn ghost" data-act="toggleType" aria-pressed="' + !!N.typing + '">' + ic('kbd') + 'Escribir</button>' +
    '<button class="mic' + (ms === 'escuchando' ? ' on' : '') + (micBusy() ? ' busy' : '') + '" id="micBtn" data-act="mic" aria-label="' + (ms === 'escuchando' ? 'Terminar de hablar' : 'Hablar') + '"' + (((busy || editing) && ms !== 'escuchando') || micBusy() ? ' disabled' : '') + '>' + ic(ms === 'escuchando' ? 'stop' : 'mic') + '</button>' +
    '<button class="btn ghost sug" data-act="sugs">' + ic('bulb') + 'Sugerencias' + (nSug ? '<span class="badge" aria-label="' + nSug + ' sugerencias">' + nSug + '</span>' : '') + '</button></div>';
  return { top, main: m, bar: dock, barClass: 'dock' };
}

function vRevisar() {
  const N = S.nota;
  const top = topBar({ back: true, title: (N && N.c && N.c.patient) || 'Revisar', sub: 'Revisar la nota' });
  if (!N || !N.loaded) return { top, main: '<div class="wait">' + spin('big') + '<span>Abriendo…</span></div>' };
  const d = N.draft || {}, t = N.turn || {};
  let m = '';
  if (N.finished || d.terminada) m += '<div class="msg ok" role="status">' + ic('check') + '<span><b>Nota terminada.</b> Todo lo que guardaste ya está en Neo o va en camino.</span></div>';
  if (N.finishErr) m += '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(N.finishErr) + '</span></div>';
  m += sections().map((sec) => {
    const st = secState(sec);
    const tg = tagOf(st.status);
    const es = (d.text_es || {})[sec];
    const en = sec === 'O' ? oText() : sec === 'Vitales' ? VITALS.filter((v) => (d.vitals || {})[v[0]] != null).map((v) => v[1] + ': ' + (((N.c || {}).vitals || {})[v[0]] == null ? '—' : N.c.vitals[v[0]]) + ' → ' + d.vitals[v[0]] + ' ' + v[2]) : enLines(sec);
    return '<div class="card rv" id="rv-' + sec + '"><div class="nhead"><h3>' + esc(SEC_TITLE[sec]) + '</h3>' + (st.status ? '<span class="tag ' + tg[1] + '">' + esc(tg[0]) + '</span>' : '<span class="tag">Sin guardar</span>') + '</div>' +
      '<div class="cols"><div><p class="lab">Lo que dijiste</p><p>' + (es ? esc(es) : '<span class="muted">Nada todavía.</span>') + '</p></div><div><p class="lab">Lo que se escribe (inglés)</p>' +
      (en.length ? '<ul lang="en">' + en.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '<p class="muted">Nada todavía.</p>') + '</div></div>' +
      (st.doubt ? '<div class="msg warn">' + ic('alert') + '<span>' + esc(st.doubt) + '</span></div>' : '') + (st.error ? '<div class="msg err">' + ic('alert') + '<span>' + esc(st.detail || 'No se pudo guardar.') + '</span></div>' : '') +
      (N.saveErr[sec] ? '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(N.saveErr[sec]) + '</span></div>' : '') +
      (N.warn[sec] ? '<div class="msg warn" role="alert">' + ic('alert') + '<span>' + esc(N.warn[sec]) + '</span></div>' : '') + '</div>';
  }).join('');
  const doubts = (t.doubts || []).concat((t.missing || []).map((x) => x.text_es));
  if (doubts.length) m += '<div class="card amber"><h3>Dudas</h3><ul>' + doubts.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
  const dec = ((N.c || {}).lines || []).filter((l) => l.declined);
  if (dec.length && !(N.finished || d.terminada)) m += '<div class="card flat"><h3>Declinado por el cliente</h3><p class="muted">Se agrega al terminar la nota:</p><ul>' + dec.map((l) => '<li>' + esc(l.name) + '</li>').join('') + '</ul></div>';
  const q = colaOf();
  if (q.length) m += '<div class="card flat"><h3>Lo que va para Neo</h3>' + colaItemsHtml(q) + '</div>';
  const fin = N.finished || d.terminada;
  const bar = fin ? '<button class="btn primary block" data-act="home">Volver a las consultas</button>'
    : saveAllBtn(N) + finishBtn(N) + (N.edit ? '<p class="note">' + MSG_EDITANDO + '</p>' : '');
  return { top, main: m, bar };
}

function vAjustes() {
  const u = S.user || {};
  const mdl = S.model;
  const roles = { admin: 'Administrador', doctor: 'Doctor' };
  let m = '<div class="card"><h3>Voz</h3>' +
    (mdl.ready === null ? '<p class="muted">Revisando el modelo de voz…</p>' : mdl.ready ? '<p><span class="tag ok">' + ic('check') + 'Listo</span></p><p class="muted">' + esc(mdl.name || 'Modelo de voz') + '</p>' : '<p><span class="tag amber">Falta</span></p><p class="muted">' + esc(mdl.status || 'Todavía no hay un modelo de voz en este teléfono.') + '</p><p class="hint">Toca «Importar modelo» y elige el archivo del modelo de voz. Si no lo tienes, pídelo a quien se encarga de Neo Records.</p>') +
    '<button class="btn ' + (mdl.ready ? 'ghost' : 'primary') + ' block" data-act="import">Importar modelo</button>' + (S.aj.err ? '<div class="msg err" role="alert">' + ic('alert') + '<span>' + esc(S.aj.err) + '</span></div>' : '') + '</div>';
  m += '<div class="card"><h3>Mi cuenta</h3><p><b>' + esc(u.name || u.user || '') + '</b><br><span class="muted">Usuario: ' + esc(u.user || '') + ' · ' + esc(roles[u.role] || u.role || '') + (u.doctor ? ' · ' + esc(u.doctor) : '') + '</span></p>' +
    ((S.pc || S.device) ? '<p class="muted">' + (S.pc ? 'Computadora: ' + esc(S.pc.name) : '') + (S.pc && S.device ? '<br>' : '') + (S.device ? 'Este teléfono: ' + esc(S.device) : '') + '</p>' : '') +
    '<button class="btn ghost block" data-act="cambiarClave">Cambiar contraseña</button></div>' +
    '<div class="card flat"><h3>Computadora</h3><p class="muted">Solo si cambiaron la computadora o reinstalaron Neo Records y el teléfono ya no entra.</p><button class="btn ghost block" data-act="askForget"' + (S.aj.busy ? ' disabled' : '') + '>Olvidar esta computadora</button></div>';
  if (u.role === 'admin') m += '<div class="card flat"><h3>Usuarios</h3><p class="muted">Los usuarios nuevos y las contraseñas se manejan en la computadora de la clínica, en la sección «Teléfonos».</p></div>';
  const bar = '<button class="btn danger block" data-act="askLogout"' + (S.aj.busy ? ' disabled' : '') + '>' + (S.aj.busy ? spin() + esc(S.aj.busy) : 'Salir de la cuenta') + '</button>';
  return { top: topBar({ back: true, title: 'Ajustes', sub: 'Neo Records 1.0' }), main: m, bar };
}

// ---------------------------------------------------------------- hojas de abajo
const SUG_ICON = { facturado: 'cart', fila_o: 'grid', recheck: 'clock', vitales: 'heart', alerta: 'alert', clinica: 'bulb' };
function sheetHtml() {
  const sh = S.sheet;
  if (!sh) return '';
  let b = '';
  if (sh.type === 'confirm') {
    b = '<h2>' + esc(sh.title) + '</h2><p>' + esc(sh.text) + '</p><div class="opts"><button class="btn ' + (sh.bad ? 'danger' : 'primary') + ' block" data-act="' + esc(sh.act) + '">' + esc(sh.ok) + '</button><button class="btn ghost block" data-act="' + esc(sh.cancelAct || 'closeSheet') + '">' + esc(sh.cancel || 'Cancelar') + '</button></div>';
  } else if (sh.type === 'plantillas') {
    const l = (S.cons && S.cons.plantillas) || [];
    b = '<h2>Plantilla de cirugía</h2>' + (l.length ? '<p class="muted">Toca la plantilla que quieres poner en la nota.</p><div class="opts">' + l.map((p) => '<button class="btn ghost block" data-act="plantilla" data-id="' + esc(p.id) + '">' + esc(p.nombre) + '</button>').join('') + '</div>'
      : '<div class="msg warn">' + ic('alert') + '<span>Todavía no hay plantillas de cirugía activadas. Pídele a quien se encarga de Neo Records que las active en la computadora (sección Teléfonos).</span></div>') + '<button class="btn ghost block" data-act="closeSheet">Cerrar</button>';
  } else if (sh.type === 'sugs') {
    const l = (S.nota && S.nota.turn && S.nota.turn.suggestions) || [];
    b = '<h2>Sugerencias</h2><p class="muted">Cosas que se podrían escapar. Tú decides. Toca una para hablar de ella.</p>' + (l.length ? '<div class="opts">' + l.map((s, i) => '<button class="sug-item k-' + esc(s.kind) + '" data-act="sugg" data-i="' + i + '"><span class="ico">' + ic(SUG_ICON[s.kind] || 'bulb') + '</span><span class="tx">' + esc(s.text_es) + (s.section ? '<small>Va en: ' + esc(SEC_SHORT[s.section] || s.section) + '</small>' : '') + '</span></button>').join('') + '</div>'
      : '<div class="msg ok">' + ic('check') + '<span>Por ahora no tengo sugerencias.</span></div>') + '<button class="btn ghost block" data-act="closeSheet">Cerrar</button>';
  }
  return '<div class="sheet" role="dialog" aria-modal="true" aria-label="Opciones"><div class="grab"></div>' + b + '</div>';
}

// ---------------------------------------------------------------- dibujar
const VIEWS = { boot: vBoot, entrar: vEntrar, clave: vClave, hoy: vHoy, consulta: vConsulta, nota: vNota, revisar: vRevisar, ajustes: vAjustes };
let sheetSeen = null, sheetAt = 0;
const sheetFresh = () => !!S.sheet && SHEET_GUARD() > 0 && Date.now() - sheetAt < SHEET_GUARD();
function render() {
  const main = $('#main'), bar = $('#bar'), wrap = $('#sheetWrap');
  const ae = document.activeElement;
  const fid = ae && ae.id && /^(INPUT|TEXTAREA)$/.test(ae.tagName) ? ae.id : null;
  const sel = fid ? [ae.selectionStart, ae.selectionEnd] : null;
  const keyAttr = ae && ae.getAttribute && ae.dataset ? ae.dataset.key : null, bindAttr = ae && ae.dataset ? ae.dataset.bind : null;
  const top = main.scrollTop;
  const v = (VIEWS[S.screen] || vBoot)();
  $('#top').innerHTML = v.top || '';
  main.innerHTML = v.main || '';
  bar.innerHTML = v.bar || '';
  bar.hidden = !v.bar;
  bar.className = 'bar' + (v.barClass ? ' ' + v.barClass : '');
  const want = S.scrollTop === true ? 0 : typeof S.scrollTop === 'number' ? S.scrollTop : top;      // si no, se queda donde estaba
  if (main.scrollTop !== want) main.scrollTo({ top: want, behavior: 'instant' });       // sin animación: la pantalla no «salta» al redibujar
  S.scrollTop = false;
  if (S.scrollTo) { const el = document.getElementById(S.scrollTo); if (el) { S.scrollTo = null; main.scrollTo({ top: main.scrollTop + el.getBoundingClientRect().top - stickyBottom(main, true) - 8, behavior: 'instant' }); } }
  if (S.sheet !== sheetSeen) { sheetSeen = S.sheet; sheetAt = Date.now(); }      // una hoja nueva (o cambiada por otra) empieza a contar sus instantes sin toques
  wrap.innerHTML = sheetHtml();
  wrap.hidden = !S.sheet;
  if (S.sheet) { const f = wrap.querySelector('button'); if (f && !wrap.contains(document.activeElement)) f.focus(); }
  else if (fid) { const el = document.getElementById(fid); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* tipo sin selección */ } keepFocusedVisible(); } }
  else if (keyAttr && bindAttr) { const el = document.querySelector('[data-bind="' + bindAttr + '"][data-key="' + keyAttr + '"]'); if (el) { el.focus({ preventScroll: true }); keepFocusedVisible(); } }
  if (S.nota && S.nota.changed && S.nota.changed.length) { const N = S.nota; setTimeout(() => { N.changed = []; }, 0); }   // el destello de «cambió» corre una sola vez
  if (S.screen === 'nota') { const b = $('#micBtn'); if (b && S.mic.state !== 'escuchando') b.style.setProperty('--lvl', '0'); }
  document.body.classList.toggle('mic-live', S.mic.state === 'escuchando' || S.mic.state === 'transcribiendo');      // grabando: parar y cancelar siempre a la vista
  updateKb();                     // si el campo con el cursor ya no está, el micrófono vuelve
}

// ---------------------------------------------------------------- teclado: lo que se escribe nunca queda tapado
const isField = (el) => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|hidden)$/i.test(el.type || '')));
const vpH = () => (window.visualViewport ? window.visualViewport.height : window.innerHeight);
let vpMax = vpH(), vpW = window.innerWidth, kbT = null;
// Con el teclado abierto (la pantalla quedó bastante más baja y hay un campo con el cursor) la pregunta deja de estar fija y el micrófono se esconde un rato.
function updateKb() {
  if (window.innerWidth !== vpW) { vpW = window.innerWidth; vpMax = 0; }      // giró el teléfono: se mide de nuevo
  const h = vpH();
  vpMax = Math.max(vpMax, h);                                                 // la altura más grande vista = sin teclado
  const on = isField(document.activeElement) && h < 0.75 * vpMax;
  if (document.body.classList.contains('kb') !== on) { document.body.classList.toggle('kb', on); return true; }
  return false;
}
// Mueve la lista lo justo para que el campo con el cursor se vea entero (debajo de la pregunta fija y arriba del teclado). Si ya se ve, no toca nada.
function keepFocusedVisible() {
  const el = document.activeElement;
  if (!isField(el) || !el.isConnected) return;
  const main = $('#main');
  if (!main.contains(el)) { el.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return; }
  const mr = main.getBoundingClientRect(), r = el.getBoundingClientRect();
  const top = Math.max(mr.top, stickyBottom(main)) + 8;
  const bottom = Math.min(mr.bottom, vpH()) - 8;
  let d = 0;
  if (r.bottom > bottom) d = r.bottom - bottom;
  if (r.top - d < top) d = r.top - top;                                       // si no cabe entero, se ve el principio
  if (Math.abs(d) >= 1) main.scrollTo({ top: main.scrollTop + d, behavior: 'instant' });
}
// Lo de arriba que queda fijo al bajar (la pregunta o su burbuja): lo que se busca tiene que quedar debajo.
function stickyBottom(main, any) {
  const bn = main.querySelector('.banner, .qbub-wrap');
  if (!bn || (!any && getComputedStyle(bn).position !== 'sticky')) return main.getBoundingClientRect().top;
  const r = (bn.querySelector('.qbub') || bn).getBoundingClientRect();
  return r.bottom;
}
function kbSoon(ms) { clearTimeout(kbT); kbT = setTimeout(() => { kbT = null; updateKb(); keepFocusedVisible(); }, ms); }
document.addEventListener('focusin', (e) => { if (!isField(e.target)) return; updateKb(); keepFocusedVisible(); kbSoon(250); });     // el teclado tarda en salir
document.addEventListener('focusout', () => { setTimeout(() => { if (updateKb()) keepFocusedVisible(); }, 0); });      // al redibujar se pierde y vuelve el foco: se decide después
window.addEventListener('resize', () => kbSoon(250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => kbSoon(250));

// ---------------------------------------------------------------- eventos de toque
function setPath(path, value) {
  const p = path.split('.'); let o = S;
  for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
  o[p[p.length - 1]] = value;
}
const ACTIONS = {
  back, closeSheet,
  pick(d) { const p = S.login.pcs.find((x) => x.host === d.host); connect(d.host, { port: p && p.port }); }, rescan() { S.login.hostInput = ''; discover(); }, manual() { const L = S.login; L.run++; clearT('find'); L.canManual = false; L.busy = ''; L.phase = 'manual'; L.err = ''; render(); },
  connectManual() { const h = S.login.hostInput.trim(); if (!h) { S.login.err = 'Escribe la dirección de la computadora.'; render(); return; } connect(h, { manual: true }); },
  showPw() { S.login.show = !S.login.show; render(); }, login: doLogin,
  showCp() { S.cp.show = !S.cp.show; render(); }, doCp: doChangePw,
  prevDay() { moveDay(-1); }, nextDay() { moveDay(1); }, refresh() { loadHoy(true); }, reload() { loadHoy(false); }, ajustes() { go('ajustes'); },
  open(d) { openCons(d.id); }, reloadCons() { loadCons(); },
  askSoap, doSoap, askPlantilla, plantilla(d) { confirmPlantilla(d.id); }, empezar: openNota,
  doPlantillaOk() { const id = S.sheet && S.sheet.arg; if (id) doPlantilla(id); }, askPlantillaList() { S.sheet = { type: 'plantillas' }; render(); },
  goSave() { const f = S.sheet && S.sheet.first; closeSheet(); S.scrollTo = f ? 'card-' + f : null; if (S.screen === 'revisar') back(); else render(); },
  today: goToday, rescanHoy,
  target(d, t, e) { const x = e && e.target && e.target.closest && e.target.closest('label, .edit-o, .vedit, textarea, input, select, button'); if (x && t.contains(x)) return; setTarget(d.sec); },   // un toque dentro de un campo o de un editor no marca la tarjeta
  quick(d) { if (aiBusy() || S.nota.edit) return; const q = S.nota.turn && S.nota.turn.question; if (q) sendAnswer((q.quick_replies_es || [])[Number(d.i)] || ''); },
  skip: skipQuestion, retry: retryJob, reloadNota: loadNota,
  edit(d) { startEdit(d.sec); }, editOk: saveEdit, editCancel() { if (S.nota.edit && S.nota.edit.busy) return; S.nota.edit = null; render(); },
  oState(d) { const e = S.nota.edit; const cur = e.rows[d.row] || { state: '', note: '' }; e.rows[d.row] = { state: cur.state === d.state ? '' : d.state, note: cur.note }; render(); },
  save(d) { saveSection(d.sec); }, askFinish, doFinish, saveAll, saveAllFirst() { closeSheet(); saveAll(); },
  unpin() { const N = S.nota; if (N && N.pin) { unpin(N); render(); } }, revisar() { if (S.nota) go('revisar'); }, home() { stashNota(); S.nota = null; S.cons = null; goHoy(); },
  mic: micTap, micCancel, toggleType() { const N = S.nota; N.typing = !N.typing; render(); if (N.typing) { const a = $('#ans'); if (a) a.focus(); } },
  send() { const N = S.nota; const t = N.text; if (String(t).trim()) sendAnswer(t, { fromBox: true }); }, clearText() { S.nota.text = ''; S.nota.typing = false; render(); },
  sugs() { S.sheet = { type: 'sugs' }; render(); },
  sugg(d) {
    const N = S.nota, s = ((N.turn && N.turn.suggestions) || [])[Number(d.i)];
    S.sheet = null;
    if (s) { N.localQ = { text_es: s.text_es, section: s.section, about: 'sugerencia:' + s.kind }; N.pin = null; N.target = s.section || null; S.qMin = false; }      // eligió otro tema: se quita la marca y se abre la pregunta
    render();
    const q = $('#qText'); if (q) q.scrollIntoView({ block: 'nearest' });
  },
  minQ() { setQMin(true); }, maxQ() { setQMin(false); },
  dropSugg() { const N = S.nota; N.localQ = null; N.target = N.pin || (N.turn && N.turn.question && N.turn.question.section) || null; render(); },
  cambiarClave() { S.cp = { old: '', nw: '', rep: '', show: false, err: '', busy: false, forced: false }; go('clave'); },
  import: doImport, askLogout, doLogout, askForget, doForget,
};
document.addEventListener('click', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT|LABEL)$/.test(e.target.tagName)) return;
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
  if (S.sheet && !t.closest('#sheetWrap') && t.dataset.act !== 'closeSheet') return;
  if (sheetFresh()) return;
  const f = ACTIONS[t.dataset.act];
  if (f) f(t.dataset, t, e);
});
document.addEventListener('click', (e) => { if (e.target.id === 'sheetWrap' && !sheetFresh()) { S.sheet = null; render(); } });
document.addEventListener('input', (e) => {
  const el = e.target, b = el.dataset && el.dataset.bind;
  if (!b) return;
  if (b === 'oNote') { S.nota.edit.rows[el.dataset.key].note = el.value; return; }
  if (b === 'vit') { S.nota.edit.vit[el.dataset.key] = el.value; return; }
  if (b === 'oRest') { S.nota.edit.rest = el.checked; return; }
  if (b === 'edit.text') { S.nota.edit.text = el.value; return; }
  setPath(b, el.value);
  if (b === 'login.user' || b === 'login.pass') { const x = $('#loginBtn'); if (x) x.disabled = !(S.login.user.trim() && S.login.pass) || !!S.login.busy; }
  else if (/^cp\./.test(b)) { const x = $('#cpBtn'); if (x) x.disabled = !cpOk(); const l = $('#cpChecks'); if (l) l.innerHTML = policy(S.cp.nw, S.user && S.user.user, S.cp.old, S.cp.rep).map(checkLi).join(''); }
  else if (b === 'nota.text') { const x = $('#sendBtn'); if (x) x.disabled = !String(S.nota.text).trim() || S.nota.busy === 'ia' || !!S.nota.edit; }
});
document.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.bind === 'oRest') S.nota.edit.rest = e.target.checked; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.sheet) { S.sheet = null; render(); return; }
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
    if (S.screen === 'entrar') { if (S.login.phase === 'form') doLogin(); else if (S.login.phase === 'manual') ACTIONS.connectManual(); }
    else if (S.screen === 'clave') doChangePw();
  }
});

boot();
})();
