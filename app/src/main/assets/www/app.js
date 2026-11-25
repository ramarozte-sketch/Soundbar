'use strict';
/* Soundbar Q990B — controlo da Samsung HW-Q990B através da API SmartThings.
   Capacidades standard: switch, audioVolume, audioMute, mediaInputSource, mediaPlayback, audioTrackData.
   Funções avançadas: capacidade "execute" com recursos OCF /sec/networkaudio/... */

const API = 'https://api.smartthings.com/v1';
const OAUTH_AUTHORIZE = 'https://api.smartthings.com/oauth/authorize';
const OAUTH_TOKEN = 'https://api.smartthings.com/oauth/token';
const DEFAULT_REDIRECT = 'https://httpbin.org/get';
const SCOPES = ['r:devices:*', 'w:devices:*', 'x:devices:*'];
const NS = 'x.com.samsung.networkaudio.';

const HREF = {
  soundmode: '/sec/networkaudio/soundmode',
  advanced: '/sec/networkaudio/advancedaudio',
  woofer: '/sec/networkaudio/woofer',
  eq: '/sec/networkaudio/eq',
  channel: '/sec/networkaudio/channelVolume',
  rear: '/sec/networkaudio/surroundspeaker',
  ava: '/sec/networkaudio/activeVoiceAmplifier',
  spacefit: '/sec/networkaudio/spacefitSound',
};

/* ===================== ponte nativa ===================== */
const Nat = window.Native || {
  // Alternativa para testar num browser normal
  getPref: k => localStorage.getItem('sb_' + k) || '',
  setPref: (k, v) => localStorage.setItem('sb_' + k, v),
  http: (id, m, u, h, b) => {
    fetch(u, { method: m, headers: JSON.parse(h || '{}'), body: m === 'GET' ? undefined : (b || undefined) })
      .then(async r => window.__nativeCb(id, r.status, await r.text()))
      .catch(e => window.__nativeCb(id, 0, 'ERRO DE REDE: ' + e.message));
  },
  oauth: u => { window.open(u, '_blank'); },
  openExternal: u => window.open(u, '_blank'),
  copy: t => { try { navigator.clipboard.writeText(t); } catch (e) { } },
  exit: () => { },
};

const P = {
  get: (k, d = '') => { const v = Nat.getPref(k); return v === '' || v == null ? d : v; },
  set: (k, v) => Nat.setPref(k, v == null ? '' : String(v)),
};

let seq = 0;
const pending = {};
window.__nativeCb = (id, status, text) => {
  const p = pending[id];
  if (!p) return;
  delete pending[id];
  p({ status, text });
};
function http(method, url, headers, body) {
  return new Promise(res => {
    const id = 'r' + (++seq);
    pending[id] = res;
    Nat.http(id, method, url, JSON.stringify(headers || {}), body || '');
  });
}

/* ===================== utilitários ===================== */
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const form = o => new URLSearchParams(o).toString();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = t => String(t || '').slice(0, 300);

const LOG = [];
function log(msg) {
  const d = new Date();
  const ts = d.toTimeString().slice(0, 8);
  LOG.push(ts + '  ' + msg);
  if (LOG.length > 120) LOG.shift();
  const box = $('logBox');
  if (box && !$('vSettings').classList.contains('hidden')) box.textContent = LOG.slice().reverse().join('\n');
}

let toastT = 0;
function toast(msg, err) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.className = ''; }, err ? 4200 : 2200);
}

/* ===================== autenticação ===================== */
let refreshing = null;
const auth = {
  mode: () => P.get('authMode'),
  async token() {
    const m = P.get('authMode');
    if (m === 'pat') return P.get('pat');
    if (m === 'oauth') {
      const exp = +P.get('expiresAt', '0');
      if (Date.now() > exp - 5 * 60 * 1000) await auth.refresh();
      return P.get('accessToken');
    }
    const e = new Error('Sem sessão iniciada');
    e.noAuth = true;
    throw e;
  },
  async refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const cid = P.get('clientId'), sec = P.get('clientSecret');
      log('A renovar o acesso (OAuth)…');
      const r = await http('POST', OAUTH_TOKEN, {
        'Authorization': 'Basic ' + btoa(cid + ':' + sec),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      }, form({ grant_type: 'refresh_token', client_id: cid, refresh_token: P.get('refreshToken') }));
      if (r.status !== 200) {
        log('Renovação falhou ' + r.status + ': ' + short(r.text));
        const e = new Error('Não foi possível renovar o acesso. Entra outra vez com a conta Samsung.');
        e.noAuth = r.status === 400 || r.status === 401;
        throw e;
      }
      saveTokens(JSON.parse(r.text));
      log('Acesso renovado.');
    })();
    try { await refreshing; } finally { refreshing = null; }
  },
};

function saveTokens(j) {
  P.set('accessToken', j.access_token);
  if (j.refresh_token) P.set('refreshToken', j.refresh_token);
  P.set('expiresAt', Date.now() + (j.expires_in || 86399) * 1000);
  P.set('refreshedAt', Date.now());
  P.set('authMode', 'oauth');
}

function errText(r) {
  if (r.status === 0) return 'Sem ligação à internet (' + short(r.text) + ')';
  if (r.status === 401) return 'Sessão expirada ou token inválido';
  if (r.status === 403) return 'Sem permissão — o token não tem as permissões necessárias';
  if (r.status === 404) return 'Não encontrado (404)';
  if (r.status === 409) return 'A soundbar está ocupada ou desligada (409)';
  if (r.status === 422) return 'Pedido recusado pela soundbar (422)';
  if (r.status === 429) return 'Demasiados pedidos — espera um pouco';
  try {
    const j = JSON.parse(r.text);
    const m = (j.error && (j.error.message || j.error.code)) || j.message;
    if (m) return m + ' (' + r.status + ')';
  } catch (e) { }
  return 'Erro ' + r.status;
}

/* Limites da SmartThings por dispositivo: ~12 leituras de estado e ~12 comandos por minuto.
   Fica-se um pouco abaixo e os pedidos esperam a sua vez em vez de falharem. */
const BUCKET = {
  get: { limit: 9, times: [], until: 0 },
  cmd: { limit: 10, times: [], until: 0 },
};
function bucketOf(method, path) {
  if (!/^\/devices\/[^/]+\//.test(path)) return null;
  return method === 'GET' ? BUCKET.get : BUCKET.cmd;
}
function budget(b) {
  const now = Date.now();
  b.times = b.times.filter(t => now - t < 60000);
  return now < b.until ? 0 : b.limit - b.times.length;
}
async function take(b) {
  for (; ;) {
    const now = Date.now();
    if (now < b.until) { await sleep(b.until - now + 50); continue; }
    if (budget(b) > 0) { b.times.push(now); return; }
    await sleep(60000 - (now - b.times[0]) + 100);
  }
}

async function api(method, path, body) {
  const tok = await auth.token();
  const h = { 'Authorization': 'Bearer ' + tok, 'Accept': 'application/json' };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const payload = body !== undefined ? JSON.stringify(body) : '';
  const b = bucketOf(method, path);
  if (b) await take(b);
  let r = await http(method, API + path, h, payload);
  if (r.status === 401 && P.get('authMode') === 'oauth') {
    await auth.refresh();
    h.Authorization = 'Bearer ' + P.get('accessToken');
    r = await http(method, API + path, h, payload);
  }
  for (let i = 0; i < 2 && r.status === 429; i++) {
    const m = /retry in (\d+)/.exec(r.text || '');
    const wait = clamp(m ? +m[1] : 15000, 1000, 65000);
    log('Limite da SmartThings atingido — a aguardar ' + Math.round(wait / 1000) + ' s');
    if (b) b.until = Date.now() + wait;
    setHeader('off', 'A aguardar (limite de pedidos da SmartThings)…');
    await sleep(wait + 100);
    if (b) b.times.push(Date.now());
    r = await http(method, API + path, h, payload);
  }
  if (r.status < 200 || r.status >= 300) {
    const e = new Error(errText(r));
    e.status = r.status;
    if (r.status === 401) e.noAuth = true;
    if (method !== 'GET' || r.status !== 404) log(method + ' ' + path + ' → ' + r.status + ' ' + short(r.text));
    throw e;
  }
  if (method !== 'GET') log(method + ' ' + path + ' ✓ ' + short(payload).slice(0, 160));
  return r.text ? JSON.parse(r.text) : {};
}

/* ===================== soundbar ===================== */
const dev = () => P.get('deviceId');

function cmd(capability, command, args) {
  const c = { component: 'main', capability, command };
  if (args && args.length) c.arguments = args;
  return api('POST', '/devices/' + dev() + '/commands', { commands: [c] });
}

// As leituras/escritas "execute" têm de ser feitas uma de cada vez
let execChain = Promise.resolve();
function queued(fn) {
  const p = execChain.then(fn);
  execChain = p.catch(() => { });
  return p;
}
function execRead(href, key) {
  return queued(async () => {
    await cmd('execute', 'execute', [href]);
    // Lê a resposta do "execute" no recurso de capacidade (como a integração de referência), com mais tempo de espera
    for (let i = 0; i < 2; i++) {
      await sleep(i === 0 ? 1500 : 3000);
      const j = await api('GET', '/devices/' + dev() + '/components/main/capabilities/execute/status');
      const pl = j && j.data && j.data.value && j.data.value.payload;
      if (pl && Object.prototype.hasOwnProperty.call(pl, key)) return pl;
    }
    throw new Error('A SmartThings não devolve o estado desta função (valor vazio)');
  });
}
function execWrite(href, prop, value) {
  return queued(() => cmd('execute', 'execute', [href, { [prop]: value }]));
}

/* ===================== estado ===================== */
const S = {
  online: null, power: false, volume: 0, mute: false,
  source: '', sources: [], srcCap: '',
  playback: '', title: '', artist: '', appName: '',
  model: '', fw: '', caps: new Set(), raw: null,
  soundmode: null, soundmodes: [],
  night: null, voice: null, bass: null, ava: null, spacefit: null,
  woofer: null, wooferConn: '',
  eqName: null, eqList: [], eqBands: null,
  channels: {}, rear: null,
  unsup: {},
};
const hold = {}; // campo -> instante até ao qual o valor local tem prioridade
const held = k => (hold[k] || 0) > Date.now();
const setHold = (k, ms = 5000) => { hold[k] = Date.now() + ms; };

function parseStatus(j) {
  S.raw = j;
  const main = (j.components && j.components.main) || {};
  S.caps = new Set(Object.keys(main));
  const v = (cap, attr) => main[cap] && main[cap][attr] ? main[cap][attr].value : undefined;

  if (!held('power')) S.power = v('switch', 'switch') === 'on';
  const vol = v('audioVolume', 'volume');
  if (!held('volume') && typeof vol === 'number') S.volume = vol;
  if (!held('mute')) S.mute = v('audioMute', 'mute') === 'muted';

  let src = v('mediaInputSource', 'inputSource'), list = v('mediaInputSource', 'supportedInputSources');
  S.srcCap = 'mediaInputSource';
  if (src === undefined && main['samsungvd.audioInputSource']) {
    src = v('samsungvd.audioInputSource', 'inputSource');
    list = v('samsungvd.audioInputSource', 'supportedInputSources');
    S.srcCap = 'samsungvd.audioInputSource';
  }
  if (!held('source') && src !== undefined) S.source = src || '';
  if (Array.isArray(list)) S.sources = list.map(x => typeof x === 'object' ? (x.id || x.name) : x).filter(Boolean);

  if (!held('playback')) S.playback = v('mediaPlayback', 'playbackStatus') || '';
  const td = v('audioTrackData', 'audioTrackData') || {};
  S.title = td.title || '';
  S.artist = [td.artist, td.album].filter(Boolean).join(' · ');
  S.appName = '';
  for (const cap of Object.keys(main)) {
    if (main[cap].detailName && main[cap].detailName.value) S.appName = main[cap].detailName.value;
  }
  S.model = v('ocf', 'mnmo') || S.model;
  S.fw = v('ocf', 'mnfv') || S.fw;
}

async function refreshStatus(quiet) {
  if (!dev()) return;
  try {
    if (quiet && budget(BUCKET.get) < 4) return; // guarda leituras para as ações do utilizador
    const st = await api('GET', '/devices/' + dev() + '/status');
    parseStatus(st);
    S.online = true;
    renderAll();
  } catch (e) {
    if (e.noAuth) return authLost(e);
    S.online = null;
    setHeader('err', e.message);
    if (!quiet) toast(e.message, true);
  }
}

async function loadExec(which, force) {
  const jobs = {
    soundmode: async () => {
      const pl = await execRead(HREF.soundmode, NS + 'soundmode');
      if (!held('soundmode')) S.soundmode = pl[NS + 'soundmode'];
      if (Array.isArray(pl[NS + 'supportedSoundmode'])) S.soundmodes = pl[NS + 'supportedSoundmode'];
    },
    advanced: async () => {
      const pl = await execRead(HREF.advanced, NS + 'nightmode');
      if (!held('night')) S.night = toBool(pl[NS + 'nightmode']);
      if (!held('voice')) S.voice = toBool(pl[NS + 'voiceamplifier']);
      if (!held('bass')) S.bass = toBool(pl[NS + 'bassboost']);
    },
    ava: async () => {
      const pl = await execRead(HREF.ava, NS + 'activeVoiceAmplifier');
      if (!held('ava')) S.ava = toBool(pl[NS + 'activeVoiceAmplifier']);
    },
    spacefit: async () => {
      const pl = await execRead(HREF.spacefit, NS + 'spacefitSound');
      if (!held('spacefit')) S.spacefit = toBool(pl[NS + 'spacefitSound']);
    },
    woofer: async () => {
      const pl = await execRead(HREF.woofer, NS + 'woofer');
      if (!held('woofer')) S.woofer = +pl[NS + 'woofer'];
      S.wooferConn = pl[NS + 'connection'] || '';
    },
    eq: async () => {
      const pl = await execRead(HREF.eq, NS + 'EQname');
      if (!held('eq')) S.eqName = pl[NS + 'EQname'];
      if (Array.isArray(pl[NS + 'supportedList'])) S.eqList = pl[NS + 'supportedList'];
      if (Array.isArray(pl[NS + 'EQband']) && !held('eqBands')) S.eqBands = pl[NS + 'EQband'].map(Number);
    },
    channel: async () => {
      const pl = await execRead(HREF.channel, NS + 'channelVolume');
      const arr = pl[NS + 'channelVolume'];
      if (Array.isArray(arr)) for (const c of arr) if (c && c.name && !held('ch_' + c.name)) S.channels[c.name] = +c.value;
    },
    rear: async () => {
      const pl = await execRead(HREF.rear, NS + 'currentRearPosition');
      if (!held('rear')) S.rear = pl[NS + 'currentRearPosition'];
    },
  };
  for (const k of which) {
    if (!force && S.unsup[k]) continue; // já falhou: não repetir ao mudar de separador
    try {
      await jobs[k]();
      delete S.unsup[k];
    } catch (e) {
      if (e.noAuth) return authLost(e);
      S.unsup[k] = e.message;
      log('Leitura ' + k + ' falhou: ' + e.message);
    }
    renderAll();
  }
}
const toBool = x => x === 1 || x === '1' || x === true || x === 'on' || x === 'On';

// Cada separador só lê as suas funções avançadas quando é aberto (poupa pedidos)
const TAB_EXEC = { remote: ['soundmode'], sound: ['advanced', 'woofer', 'eq', 'ava', 'spacefit'], speakers: ['channel', 'rear'], settings: [] };
const tabLoaded = {};
const tabLoading = {};
async function loadTab(t, force) {
  const list = TAB_EXEC[t] || [];
  if (!list.length || tabLoading[t] || (tabLoaded[t] && !force)) return;
  tabLoading[t] = 1;
  $('btnRefresh').classList.add('spin');
  try { await loadExec(list, force); tabLoaded[t] = 1; }
  finally { tabLoading[t] = 0; $('btnRefresh').classList.remove('spin'); }
}

let busy = 0;
async function refreshAll() {
  if (busy) return;
  busy = 1;
  $('btnRefresh').classList.add('spin');
  try {
    await refreshStatus();
    await loadTab(tab, true);
  } finally {
    busy = 0;
    $('btnRefresh').classList.remove('spin');
  }
}

/* ===================== ações ===================== */
async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    if (e.noAuth) { authLost(e); return false; }
    toast(e.message, true);
    return false;
  }
}

async function togglePower() {
  const want = !S.power;
  S.power = want; setHold('power', 8000); renderAll();
  const ok = await act(() => cmd('switch', want ? 'on' : 'off'));
  if (!ok) { S.power = !want; hold.power = 0; renderAll(); }
  else setTimeout(() => refreshStatus(true), 4000);
}

let volTimer = 0;
function setVolumeLocal(v) {
  const max = +P.get('maxVol', '100');
  S.volume = clamp(Math.round(v), 0, max);
  setHold('volume', 6000);
  renderVolume();
  clearTimeout(volTimer);
  volTimer = setTimeout(sendVolume, 600);
}
async function sendVolume() {
  const v = S.volume;
  await act(() => cmd('audioVolume', 'setVolume', [v]));
  setHold('volume', 4000);
}
window.onHwVolume = dir => {
  if (!dev() || $('nav').classList.contains('hidden')) return;
  setVolumeLocal(S.volume + dir);
  toast('Volume ' + S.volume);
};

async function toggleMute() {
  const want = !S.mute;
  S.mute = want; setHold('mute'); renderAll();
  const ok = await act(() => cmd('audioMute', want ? 'mute' : 'unmute'));
  if (!ok) { S.mute = !want; hold.mute = 0; renderAll(); }
}

async function pickSource(src) {
  const old = S.source;
  S.source = src; setHold('source', 8000); renderAll();
  const ok = await act(() => cmd(S.srcCap || 'mediaInputSource', 'setInputSource', [src]), 'Entrada: ' + srcName(src));
  if (!ok) { S.source = old; hold.source = 0; renderAll(); }
  else setTimeout(() => refreshStatus(true), 4000);
}

async function pickSoundmode(m) {
  const old = S.soundmode;
  S.soundmode = m; setHold('soundmode', 8000); renderAll();
  const ok = await act(() => execWrite(HREF.soundmode, NS + 'soundmode', m), 'Modo: ' + modeName(m));
  if (!ok) { S.soundmode = old; hold.soundmode = 0; renderAll(); }
}

async function media(c) {
  const map = { play: ['mediaPlayback', 'play'], pause: ['mediaPlayback', 'pause'], next: ['mediaPlayback', 'fastForward'], prev: ['mediaPlayback', 'rewind'] };
  if (S.caps.has('mediaTrackControl') && (c === 'next' || c === 'prev')) map[c] = ['mediaTrackControl', c === 'next' ? 'nextTrack' : 'previousTrack'];
  const [cap, com] = map[c];
  if (c === 'play' || c === 'pause') { S.playback = c === 'play' ? 'playing' : 'paused'; setHold('playback'); renderAll(); }
  await act(() => cmd(cap, com));
  setTimeout(() => refreshStatus(true), 2500);
}

const ADV = [
  { key: 'night', href: HREF.advanced, prop: NS + 'nightmode', t: 'Modo noturno', d: 'Reduz a diferença entre sons altos e baixos — ideal para ver filmes à noite com volume baixo.' },
  { key: 'voice', href: HREF.advanced, prop: NS + 'voiceamplifier', t: 'Realce de voz', d: 'Destaca as vozes e os diálogos.' },
  { key: 'ava', href: HREF.ava, prop: NS + 'activeVoiceAmplifier', t: 'Active Voice Amplifier (AVA)', d: 'Ouve o ruído da sala e reforça os diálogos automaticamente.' },
  { key: 'bass', href: HREF.advanced, prop: NS + 'bassboost', t: 'Reforço de graves', d: 'Graves mais encorpados.' },
  { key: 'spacefit', href: HREF.spacefit, prop: NS + 'spacefitSound', t: 'SpaceFit Sound', d: 'Calibra o som automaticamente para a tua sala.' },
];
async function setAdv(a, on) {
  const old = S[a.key];
  S[a.key] = on; setHold(a.key, 8000); renderSound();
  const ok = await act(() => execWrite(a.href, a.prop, on ? 1 : 0), a.t + (on ? ' ligado' : ' desligado'));
  if (!ok) { S[a.key] = old; hold[a.key] = 0; renderSound(); }
}

async function setWoofer(v) {
  S.woofer = v; setHold('woofer', 8000);
  await act(() => execWrite(HREF.woofer, NS + 'woofer', v), 'Subwoofer ' + signed(v));
}

async function pickEq(name) {
  const old = S.eqName;
  S.eqName = name; setHold('eq', 8000); renderSound();
  const ok = await act(() => execWrite(HREF.eq, NS + 'EQname', name), 'Equalizador: ' + eqName(name));
  if (!ok) { S.eqName = old; hold.eq = 0; renderSound(); }
  else setTimeout(() => loadExec(['eq']), 2500);
}
async function setEqBand(i, v) {
  if (!S.eqBands) return;
  S.eqBands[i] = v; setHold('eqBands', 8000);
  await act(() => execWrite(HREF.eq, NS + 'EQband', S.eqBands.slice()));
}

const CHANNELS = [
  { id: 'Spk_Center', t: 'Central', d: 'Diálogos' },
  { id: 'Spk_Side', t: 'Laterais', d: 'Colunas de lado da barra' },
  { id: 'Spk_Wide', t: 'Wide', d: 'Largura do palco sonoro' },
  { id: 'Spk_Front_Top', t: 'Topo frente', d: 'Altura (Dolby Atmos) à frente' },
  { id: 'Spk_Rear', t: 'Traseiras', d: 'Colunas de trás' },
  { id: 'Spk_Rear_Top', t: 'Topo traseiras', d: 'Altura (Dolby Atmos) atrás' },
];
async function setChannel(id, v) {
  S.channels[id] = v; setHold('ch_' + id, 8000);
  await act(() => execWrite(HREF.channel, NS + 'channelVolume', [{ name: id, value: v }]), nameOfCh(id) + ' ' + signed(v));
}
const nameOfCh = id => (CHANNELS.find(c => c.id === id) || { t: id }).t;

async function pickRear(pos) {
  const old = S.rear;
  S.rear = pos; setHold('rear', 8000); renderSpeakers();
  const ok = await act(() => execWrite(HREF.rear, NS + 'currentRearPosition', pos), pos === 'Rear' ? 'Traseiras atrás' : 'Traseiras à frente');
  if (!ok) { S.rear = old; hold.rear = 0; renderSpeakers(); }
}

/* ===================== nomes ===================== */
const signed = v => (v > 0 ? '+' : '') + v;
const cap1 = s => String(s).replace(/(^|\s)\S/g, c => c.toUpperCase());
function srcName(s) {
  const k = String(s).toLowerCase().replace(/[\s_-]/g, '');
  const m = {
    digital: 'Ótico (D.IN)', optical: 'Ótico', din: 'Ótico (D.IN)', 'd.in': 'Ótico (D.IN)',
    hdmi: 'TV (HDMI eARC)', arc: 'TV (HDMI ARC)', earc: 'TV (HDMI eARC)', hdmiarc: 'TV (HDMI ARC)', hdmiearc: 'TV (HDMI eARC)', tv: 'TV',
    hdmi1: 'HDMI 1', hdmi2: 'HDMI 2', hdmiin1: 'HDMI 1', hdmiin2: 'HDMI 2',
    wifi: 'Wi‑Fi', bluetooth: 'Bluetooth', bt: 'Bluetooth', aux: 'AUX', usb: 'USB',
  };
  return m[k] || cap1(s);
}
function modeName(s) {
  const k = String(s).toLowerCase();
  const m = {
    standard: 'Padrão', surround: 'Surround', game: 'Game Pro', 'game pro': 'Game Pro',
    'adaptive sound': 'Adaptativo', adaptive: 'Adaptativo', 'dts virtual x': 'DTS Virtual:X',
    music: 'Música', movie: 'Filme', 'clear voice': 'Voz clara', 'smart': 'Inteligente',
  };
  return m[k] || cap1(s);
}
function eqName(s) {
  const k = String(s).toLowerCase();
  const m = { none: 'Desligado', off: 'Desligado', flat: 'Plano', pop: 'Pop', jazz: 'Jazz', rock: 'Rock', classic: 'Clássica', classical: 'Clássica', custom: 'Personalizado', 'treble boost': 'Agudos +', 'bass boost': 'Graves +' };
  return m[k] || cap1(s);
}
const EQ_FREQ = ['150 Hz', '300 Hz', '600 Hz', '1,2 kHz', '2,5 kHz', '5 kHz', '10 kHz'];

/* ===================== desenho ===================== */
function setHeader(kind, text) {
  $('hDot').className = 'dot ' + (kind || '');
  $('hState').textContent = text;
}

function chips(el, items, sel, onPick, disabled) {
  el.innerHTML = '';
  if (!items.length) { el.innerHTML = '<span class="muted">Sem opções disponíveis</span>'; return; }
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'chip' + (String(it.v).toLowerCase() === String(sel).toLowerCase() ? ' sel' : '');
    b.textContent = it.t;
    b.disabled = !!disabled;
    b.onclick = () => onPick(it.v);
    el.appendChild(b);
  }
}

function fill(r) {
  const p = (r.value - r.min) / (r.max - r.min) * 100;
  r.style.setProperty('--p', p + '%');
}

// cria (ou atualiza) um controlo deslizante com rótulo
function slider(box, id, o) {
  let wrap = box.querySelector('[data-sl="' + id + '"]');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'slider';
    wrap.dataset.sl = id;
    wrap.innerHTML = '<div class="top"><span><b></b><small class="muted" style="display:block;font-size:13px"></small></span><span class="val"></span></div>' +
      '<input type="range"><div class="scale"><span></span><span>0</span><span></span></div>';
    box.appendChild(wrap);
    const r = wrap.querySelector('input');
    r.min = o.min; r.max = o.max; r.step = 1;
    r.oninput = () => { wrap.querySelector('.val').textContent = o.fmt(+r.value); fill(r); wrap.dataset.drag = '1'; };
    r.onchange = () => { wrap.dataset.drag = ''; o.onChange(+r.value); };
    const sc = wrap.querySelectorAll('.scale span');
    sc[0].textContent = o.fmt(o.min); sc[2].textContent = o.fmt(o.max);
    if (o.min > 0 || o.max < 0) sc[1].textContent = '';
  }
  wrap.querySelector('.top b').textContent = o.label;
  wrap.querySelector('.top small').textContent = o.desc || '';
  const r = wrap.querySelector('input');
  const known = o.value !== null && o.value !== undefined && !isNaN(o.value);
  r.disabled = !known && !o.allowUnknown;
  if (wrap.dataset.drag !== '1') {
    r.value = known ? o.value : 0;
    wrap.querySelector('.val').textContent = known ? o.fmt(o.value) : '?';
  }
  fill(r);
  return wrap;
}

function renderAll() {
  renderHeader();
  renderRemote();
  renderSound();
  renderSpeakers();
}

function renderHeader() {
  $('hName').textContent = P.get('deviceLabel', 'Soundbar Q990B');
  if (S.online === false) setHeader('err', 'Sem ligação à soundbar (offline)');
  else if (S.online === null) setHeader('', 'A ligar…');
  else if (S.power) setHeader('on', 'Ligada · ' + srcName(S.source || '—') + (S.mute ? ' · silenciada' : ' · vol. ' + S.volume));
  else setHeader('off', 'Desligada (em espera)');
}

function renderVolume() {
  const max = +P.get('maxVol', '100');
  const sl = $('volSlider');
  sl.max = max;
  if (!sl.dataset.drag) sl.value = Math.min(S.volume, max);
  fill(sl);
  $('volNum').textContent = S.online === null && !S.raw ? '—' : S.volume;
  $('volNum').style.opacity = S.mute ? .4 : 1;
}

function renderRemote() {
  const off = !S.power;
  $('btnPower').classList.toggle('on', S.power);
  $('pwState').textContent = S.raw ? (S.power ? 'Ligada' : 'Desligada') : '—';
  $('pwSub').textContent = S.power ? 'Toca para desligar' : 'Toca para ligar';
  $('offBanner').classList.toggle('hidden', !S.raw || S.power || S.online === false);
  renderVolume();
  $('btnMute').classList.toggle('primary', S.mute);
  $('muteLbl').textContent = S.mute ? 'Som silenciado — toca para repor' : 'Silenciar';

  const srcs = S.sources.length ? S.sources : (S.source ? [S.source] : []);
  chips($('srcChips'), srcs.map(s => ({ v: s, t: srcName(s) })), S.source, pickSource, off);

  if (S.unsup.soundmode && !S.soundmodes.length) $('modeChips').innerHTML = '<span class="unk">Não foi possível ler o modo de som. ' + esc(S.unsup.soundmode) + '</span>';
  else if (S.soundmodes.length || S.soundmode) {
    const ms = S.soundmodes.length ? S.soundmodes : [S.soundmode];
    chips($('modeChips'), ms.map(m => ({ v: m, t: modeName(m) })), S.soundmode, pickSoundmode, off);
  }

  $('npTitle').textContent = S.title || (S.appName ? S.appName : (S.power ? 'Nada a tocar' : '—'));
  $('npArtist').textContent = S.title ? [S.artist, S.appName].filter(Boolean).join(' · ') : '';
  const playing = S.playback === 'playing';
  $('icPlay').innerHTML = playing ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
}

function renderSound() {
  const box = $('advRows');
  if (!box.children.length) {
    for (const a of ADV) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<div class="lbl"><b>' + esc(a.t) + '</b><small>' + esc(a.d) + '</small><small class="unk"></small></div>' +
        '<label class="switch"><input type="checkbox"><span></span></label>';
      row.querySelector('input').onchange = e => setAdv(a, e.target.checked);
      row.dataset.k = a.key;
      box.appendChild(row);
    }
  }
  for (const a of ADV) {
    const row = box.querySelector('[data-k="' + a.key + '"]');
    const inp = row.querySelector('input');
    const val = S[a.key];
    inp.checked = !!val;
    const srcKey = a.href === HREF.advanced ? 'advanced' : a.key;
    const noRead = !!S.unsup[srcKey];
    row.querySelector('.unk').textContent = val === null || val === undefined
      ? (noRead ? 'Sem leitura da SmartThings — toca para definir.' : 'A ler…')
      : (noRead ? 'Sem leitura da SmartThings — mostra o último valor enviado.' : '');
  }

  const wb = $('wooferBox');
  slider(wb, 'woofer', {
    label: 'Nível do subwoofer', desc: S.wooferConn ? 'Ligação: ' + S.wooferConn : '',
    min: -12, max: 6, value: S.woofer, fmt: signed, onChange: setWoofer, allowUnknown: true,
  });

  if (S.unsup.eq && !S.eqList.length) $('eqChips').innerHTML = '<span class="unk">Não foi possível ler o equalizador.</span>';
  else if (S.eqList.length || S.eqName) {
    const list = S.eqList.length ? S.eqList : [S.eqName];
    chips($('eqChips'), list.map(n => ({ v: n, t: eqName(n) })), S.eqName, pickEq);
  }
  const bb = $('eqBands');
  if (Array.isArray(S.eqBands) && S.eqBands.length) {
    if (!bb.dataset.init) {
      bb.dataset.init = '1';
      bb.innerHTML = '<p style="margin:0 0 6px">Bandas <span class="unk">(experimental — usa o preset "Personalizado")</span></p>';
    }
    S.eqBands.forEach((v, i) => slider(bb, 'eq' + i, {
      label: EQ_FREQ[i] || ('Banda ' + (i + 1)), min: -6, max: 6, value: v, fmt: signed,
      onChange: nv => setEqBand(i, nv),
    }));
  }
}

function renderSpeakers() {
  const cb = $('chanBox');
  for (const c of CHANNELS) {
    slider(cb, c.id, {
      label: c.t, desc: c.d, min: -6, max: /Rear/.test(c.id) ? 12 : 6, value: S.channels[c.id], fmt: signed,
      onChange: v => setChannel(c.id, v), allowUnknown: true,
    });
  }
  chips($('rearChips'), [{ v: 'Rear', t: 'Atrás de mim (traseira)' }, { v: 'Front', t: 'À frente (junto à barra)' }], S.rear, pickRear);
}

function renderSettings() {
  const m = P.get('authMode');
  let a = '';
  if (m === 'oauth') {
    const exp = +P.get('expiresAt', '0');
    a = '<b>Ligação permanente</b> (OAuth). O acesso renova-se sozinho; abre a app pelo menos uma vez a cada 30 dias.<br>Acesso atual válido até ' + new Date(exp).toLocaleString('pt-PT') + '.';
  } else if (m === 'pat') {
    a = '<b>Token temporário</b>. Os tokens SmartThings expiram 24 h depois de criados. Toca em "Tornar permanente" para não teres de repetir.';
  }
  $('authInfo').innerHTML = a;
  $('btnRenew').classList.toggle('hidden', m !== 'oauth');
  $('devInfo').innerHTML = '<b>' + esc(P.get('deviceLabel', '—')) + '</b><br>Modelo: ' + esc(S.model || '—') + '<br>Firmware: ' + esc(S.fw || '—') +
    '<br>ID: <span style="font-size:12px">' + esc(dev()) + '</span>' +
    '<br>Funções disponíveis: ' + esc([...S.caps].filter(c => !c.startsWith('ocf')).join(', ') || '—');
  $('swHwKeys').checked = P.get('hwkeys', '1') !== '0';
  $('maxVol').value = P.get('maxVol', '100'); $('maxVolVal').textContent = $('maxVol').value; fill($('maxVol'));
  $('pollSec').value = P.get('pollSec', '20'); $('pollVal').textContent = $('pollSec').value + ' s'; fill($('pollSec'));
  $('logBox').textContent = LOG.slice().reverse().join('\n') || '(vazio)';
}

/* ===================== navegação ===================== */
let tab = 'remote';
const VIEWS = { remote: 'vRemote', sound: 'vSound', speakers: 'vSpeakers', settings: 'vSettings' };
function showOnly(id) {
  for (const s of document.querySelectorAll('main > section')) s.classList.toggle('hidden', s.id !== id);
  window.scrollTo(0, 0);
}
function goTab(t) {
  tab = t;
  showOnly(VIEWS[t]);
  $('nav').classList.remove('hidden');
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('sel', b.dataset.go === t);
  if (t === 'settings') renderSettings();
  if (t === 'sound' || t === 'speakers') renderAll();
  if (dev() && P.get('authMode')) loadTab(t);
}
function showSetup(msg) {
  stopPoll();
  $('nav').classList.add('hidden');
  showOnly('vSetup');
  setHeader('', 'Configuração');
  $('hName').textContent = 'Soundbar Q990B';
  $('setupMsg').innerHTML = msg ? '<span class="unk">' + esc(msg) + '</span>' : '';
  $('inCid').value = P.get('clientId');
  $('inRedir').value = P.get('redirect', DEFAULT_REDIRECT);
}
window.onBack = () => {
  if (!$('vDevices').classList.contains('hidden') && P.get('deviceId')) { goTab('settings'); return true; }
  if (!$('nav').classList.contains('hidden') && tab !== 'remote') { goTab('remote'); return true; }
  return false;
};

let lostShown = false;
function authLost(e) {
  if (lostShown) return;
  lostShown = true;
  const m = P.get('authMode');
  log('Sessão perdida: ' + e.message);
  if (m === 'pat') showSetup('O token expirou (dura 24 h). Gera um novo token — e de preferência usa a ligação permanente.');
  else showSetup('A sessão terminou. Cola um token novo para voltares a entrar.');
  P.set('authMode', '');
}

/* ===================== configuração / login ===================== */
function setupMsg(t, err) { $('setupMsg').innerHTML = err ? '<span style="color:var(--err)">' + esc(t) + '</span>' : esc(t); }

async function validatePat(pat) {
  const r = await http('GET', API + '/devices', { Authorization: 'Bearer ' + pat, Accept: 'application/json' });
  if (r.status !== 200) throw new Error(errText(r));
  return JSON.parse(r.text);
}

async function createOAuthApp(pat) {
  const id = Math.random().toString(36).slice(2, 10);
  const body = {
    appName: 'soundbar-q990b-' + id,
    displayName: 'Soundbar Q990B',
    description: 'App privada para controlar a soundbar Samsung HW-Q990B',
    singleInstance: true,
    appType: 'API_ONLY',
    classifications: ['CONNECTED_SERVICE'],
    apiOnly: {},
    principalType: 'LOCATION',
    oauth: { clientName: 'Soundbar Q990B', scope: SCOPES, redirectUris: [DEFAULT_REDIRECT] },
  };
  const r = await http('POST', API + '/apps', { Authorization: 'Bearer ' + pat, 'Content-Type': 'application/json', Accept: 'application/json' }, JSON.stringify(body));
  log('Criar app OAuth → ' + r.status + ' ' + short(r.text).slice(0, 200));
  if (r.status < 200 || r.status >= 300) {
    if (r.status === 403 || r.status === 401) throw new Error('A SmartThings recusou criar a app (403). Desde novembro de 2026, as apps com ligação permanente exigem um plano de programador pago da SmartThings. Usa o token de 24 h, ou vê a secção "Avançado" em baixo.');
    throw new Error('Não consegui criar a app OAuth: ' + errText(r));
  }
  const j = JSON.parse(r.text);
  if (!j.oauthClientId || !j.oauthClientSecret) throw new Error('A SmartThings não devolveu o Client ID/Secret.');
  P.set('clientId', j.oauthClientId);
  P.set('clientSecret', j.oauthClientSecret);
  P.set('redirect', DEFAULT_REDIRECT);
  if (j.app && j.app.appId) P.set('appId', j.app.appId);
}

function startLogin() {
  const redirect = P.get('redirect', DEFAULT_REDIRECT);
  const url = OAUTH_AUTHORIZE + '?' + form({
    client_id: P.get('clientId'), response_type: 'code', redirect_uri: redirect, scope: SCOPES.join(' '),
  });
  log('A abrir o início de sessão Samsung…');
  $('cManualCode').classList.remove('hidden');
  setupMsg('Entra com a tua conta Samsung e autoriza o acesso.');
  Nat.oauth(url, redirect);
}

window.__oauthCb = u => {
  if (!u) { setupMsg('Início de sessão cancelado. Podes tentar outra vez ou colar o código.', true); return; }
  useCode(u);
};

function extractCode(s) {
  s = String(s || '').trim();
  let m = s.match(/[?&]error=([^&\s]+)/);
  if (m) throw new Error('Autorização recusada: ' + decodeURIComponent(m[1]));
  m = s.match(/[?&]code=([^&\s"#]+)/) || s.match(/"code"\s*:\s*"([^"]+)"/);
  if (m) return decodeURIComponent(m[1]);
  if (/^[A-Za-z0-9._~-]{4,}$/.test(s)) return s;
  throw new Error('Não encontrei o código no texto colado.');
}

async function useCode(input) {
  try {
    const code = extractCode(input);
    setupMsg('A concluir a ligação…');
    const cid = P.get('clientId'), sec = P.get('clientSecret');
    const r = await http('POST', OAUTH_TOKEN, {
      'Authorization': 'Basic ' + btoa(cid + ':' + sec),
      'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json',
    }, form({ grant_type: 'authorization_code', code, client_id: cid, redirect_uri: P.get('redirect', DEFAULT_REDIRECT) }));
    log('Troca do código → ' + r.status);
    if (r.status !== 200) throw new Error('Não consegui obter o acesso: ' + errText(r) + ' ' + short(r.text).slice(0, 120));
    saveTokens(JSON.parse(r.text));
    P.set('pat', '');
    lostShown = false;
    $('cManualCode').classList.add('hidden');
    toast('Ligação permanente ativa ✓');
    await showDevices();
  } catch (e) {
    setupMsg(e.message, true);
  }
}

async function doPermanent(patIn) {
  const pat = (patIn || $('inPat').value).trim();
  if (!pat && !P.get('clientId')) return setupMsg('Cola primeiro o token SmartThings.', true);
  const b = $('btnAvancado') || { disabled: false };
  try {
    if (!P.get('clientId') || !P.get('clientSecret')) {
      setupMsg('A verificar o token…');
      await validatePat(pat);
      setupMsg('A criar a tua app privada SmartThings…');
      await createOAuthApp(pat);
    }
    startLogin();
  } catch (e) {
    setupMsg(e.message, true);
  } finally { b.disabled = false; }
}

async function doPatOnly() {
  const pat = $('inPat').value.trim();
  if (!pat) return setupMsg('Cola primeiro o token SmartThings.', true);
  try {
    setupMsg('A verificar o token…');
    await validatePat(pat);
    P.set('pat', pat);
    P.set('authMode', 'pat');
    P.set('patAt', Date.now());
    lostShown = false;
    await showDevices();
  } catch (e) { setupMsg(e.message, true); }
}

/* ===================== dispositivos ===================== */
const capsOf = d => (d.components || []).flatMap(c => (c.capabilities || []).map(x => x.id));
function looksLikeSoundbar(d) {
  const c = capsOf(d);
  return c.includes('audioVolume') && (c.includes('execute') || c.includes('mediaInputSource') || c.includes('samsungvd.audioInputSource'));
}

async function showDevices() {
  stopPoll();
  $('nav').classList.add('hidden');
  showOnly('vDevices');
  setHeader('', 'Escolher soundbar');
  const box = $('devList');
  box.innerHTML = '<p>A procurar dispositivos…</p>';
  try {
    const j = await api('GET', '/devices');
    const all = j.items || [];
    let list = all.filter(looksLikeSoundbar);
    if (!list.length) list = all.filter(d => capsOf(d).includes('audioVolume'));
    if (!list.length) list = all;
    const pref = list.filter(d => /q990|soundbar|hw-/i.test((d.label || '') + ' ' + (d.name || '') + ' ' + (d.deviceTypeName || '')));
    if (list.length === 1 || (pref.length === 1 && !P.get('deviceId'))) return chooseDevice(pref[0] || list[0]);
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<p>Não encontrei nenhum dispositivo nesta conta SmartThings. Confirma que a soundbar está adicionada na app SmartThings.</p>'; return; }
    for (const d of list) {
      const b = document.createElement('button');
      b.className = 'chip' + (d.deviceId === dev() ? ' sel' : '');
      b.innerHTML = '<b>' + esc(d.label || d.name) + '</b><br><small>' + esc(d.name || d.deviceTypeName || '') + '</small>';
      b.onclick = () => chooseDevice(d);
      box.appendChild(b);
    }
  } catch (e) {
    if (e.noAuth) return authLost(e);
    box.innerHTML = '<p style="color:var(--err)">' + esc(e.message) + '</p>';
  }
}

function chooseDevice(d) {
  P.set('deviceId', d.deviceId);
  P.set('deviceLabel', d.label || d.name || 'Soundbar');
  for (const k of ['soundmode', 'night', 'voice', 'bass', 'ava', 'spacefit', 'woofer', 'eqName', 'rear']) S[k] = null;
  for (const k of Object.keys(tabLoaded)) delete tabLoaded[k];
  S.channels = {}; S.unsup = {}; S.raw = null; S.online = null; S.soundmodes = []; S.eqList = []; S.eqBands = null;
  log('Soundbar escolhida: ' + (d.label || d.name) + ' (' + d.deviceId + ')');
  startMain();
}

/* ===================== ciclo ===================== */
let pollT = 0;
function startPoll() {
  stopPoll();
  const sec = clamp(+P.get('pollSec', '20'), 10, 60);
  pollT = setInterval(() => { if (!busy && !document.hidden) refreshStatus(true); }, sec * 1000);
}
function stopPoll() { clearInterval(pollT); pollT = 0; }

function startMain() {
  goTab('remote');
  renderAll();
  refreshAll();
  startPoll();
}

window.onAppPause = () => stopPoll();
window.onAppResume = () => {
  if (!$('nav').classList.contains('hidden') && dev()) { refreshStatus(true); startPoll(); }
};

async function boot() {
  $('verInfo').textContent = 'Soundbar Q990B · Rui Amaro';
  const m = P.get('authMode');
  if (!m) return showSetup();
  if (m === 'oauth') {
    try { await auth.refresh(); } // renova logo ao abrir: mantém o refresh token sempre fresco
    catch (e) {
      if (e.noAuth) { P.set('authMode', ''); return showSetup(e.message); }
      log('Renovação ao arrancar falhou: ' + e.message);
    }
  }
  if (!dev()) return showDevices();
  startMain();
}

/* ===================== eventos ===================== */
function bind() {
  for (const a of document.querySelectorAll('[data-ext]')) a.onclick = e => { e.preventDefault(); Nat.openExternal(a.dataset.ext); };
  for (const b of document.querySelectorAll('nav button')) b.onclick = () => goTab(b.dataset.go);

  $('btnRefresh').onclick = () => { if (!$('nav').classList.contains('hidden')) refreshAll(); };
  $('btnPower').onclick = togglePower;
  $('btnVolUp').onclick = () => setVolumeLocal(S.volume + 1);
  $('btnVolDown').onclick = () => setVolumeLocal(S.volume - 1);
  const vs = $('volSlider');
  vs.oninput = () => { vs.dataset.drag = '1'; $('volNum').textContent = vs.value; fill(vs); };
  vs.onchange = () => { vs.dataset.drag = ''; setVolumeLocal(+vs.value); };
  $('btnMute').onclick = toggleMute;
  $('btnPlay').onclick = () => media(S.playback === 'playing' ? 'pause' : 'play');
  $('btnNext').onclick = () => media('next');
  $('btnPrev').onclick = () => media('prev');

  $('btnChanReset').onclick = async () => {
    // Um único comando com os seis canais (evita estourar o limite de pedidos)
    const arr = CHANNELS.map(c => ({ name: c.id, value: 0 }));
    CHANNELS.forEach(c => { S.channels[c.id] = 0; setHold('ch_' + c.id, 8000); });
    renderSpeakers();
    await act(() => execWrite(HREF.channel, NS + 'channelVolume', arr), 'Canais repostos a 0');
  };

  $('btnPatOnly').onclick = doPatOnly;
  $('btnOwnClient').onclick = () => {
    const cid = $('inCid').value.trim(), sec = $('inCsec').value.trim();
    if (!cid || !sec) return setupMsg('Preenche o Client ID e o Client Secret.', true);
    P.set('clientId', cid); P.set('clientSecret', sec);
    P.set('redirect', $('inRedir').value.trim() || DEFAULT_REDIRECT);
    startLogin();
  };
  $('btnUseCode').onclick = () => useCode($('inCode').value);
  $('btnRetryLogin').onclick = startLogin;

  $('btnRenew').onclick = async () => { try { await auth.refresh(); toast('Acesso renovado ✓'); renderSettings(); } catch (e) { toast(e.message, true); } };
  $('btnLogout').onclick = () => {
    for (const k of ['authMode', 'pat', 'accessToken', 'refreshToken', 'expiresAt', 'deviceId', 'deviceLabel']) P.set(k, '');
    showSetup('Sessão terminada.');
  };
  $('btnChangeDev').onclick = showDevices;
  $('btnDevBack').onclick = () => { if (dev()) goTab('settings'); else showSetup(); };

  $('swHwKeys').onchange = e => P.set('hwkeys', e.target.checked ? '1' : '0');
  $('maxVol').oninput = e => { $('maxVolVal').textContent = e.target.value; fill(e.target); };
  $('maxVol').onchange = e => { P.set('maxVol', e.target.value); renderVolume(); };
  $('pollSec').oninput = e => { $('pollVal').textContent = e.target.value + ' s'; fill(e.target); };
  $('pollSec').onchange = e => { P.set('pollSec', e.target.value); startPoll(); };
  $('btnCopyLog').onclick = () => Nat.copy(LOG.join('\n'));
  $('btnRaw').onclick = () => { $('logBox').textContent = JSON.stringify(S.raw, null, 1) || '(sem estado)'; };
}

/* ===================== predefinições ===================== */
function presetsGet() { try { return JSON.parse(P.get('presets', '[]')) || []; } catch (e) { return []; } }
function presetsPut(a) { P.set('presets', JSON.stringify(a)); }

function presetSave() {
  const list = presetsGet();
  const p = { name: 'Predefinição ' + (list.length + 1) };
  if (S.soundmode) p.soundmode = S.soundmode;
  for (const a of ADV) if (S[a.key] !== null && S[a.key] !== undefined) p[a.key] = !!S[a.key];
  if (S.woofer !== null && S.woofer !== undefined) p.woofer = S.woofer;
  if (S.eqName) p.eq = S.eqName;
  if (Object.keys(p).length === 1) return toast('Ainda não há valores para guardar', true);
  list.push(p);
  presetsPut(list);
  renderPresets();
  toast('Guardada: ' + p.name);
}

function presetDeleteLast() {
  const list = presetsGet();
  if (!list.length) return toast('Não há predefinições', true);
  const r = list.pop();
  presetsPut(list);
  renderPresets();
  toast('Apagada: ' + r.name);
}

async function presetApply(p) {
  if (!S.power) return toast('Liga a soundbar primeiro', true);
  toast('A aplicar ' + p.name + '…');
  if (p.soundmode) { S.soundmode = p.soundmode; setHold('soundmode', 8000); await act(() => execWrite(HREF.soundmode, NS + 'soundmode', p.soundmode)); }
  for (const a of ADV) {
    if (p[a.key] === undefined) continue;
    S[a.key] = p[a.key]; setHold(a.key, 8000);
    await act(() => execWrite(a.href, a.prop, p[a.key] ? 1 : 0));
  }
  if (p.woofer !== undefined) { S.woofer = p.woofer; setHold('woofer', 8000); await act(() => execWrite(HREF.woofer, NS + 'woofer', p.woofer)); }
  if (p.eq) { S.eqName = p.eq; setHold('eq', 8000); await act(() => execWrite(HREF.eq, NS + 'EQname', p.eq)); }
  renderSound();
  toast(p.name + ' aplicada');
}

function renderPresets() {
  const list = presetsGet();
  chips($('presetList'), list.map((p, i) => ({ v: i, t: p.name })), -1, i => presetApply(list[i]));
}

$('btnPresetSave').onclick = presetSave;
$('btnPresetDel').onclick = presetDeleteLast;
renderPresets();

bind();
boot();
