/* Kurs OWPC – aplikacja jednoplikowa. Treść: content.json (budowana skryptem tools/build.py). */
'use strict';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 864e5, LS = 'owpc-kurs-v1', GH = !!window.OWPC_GH;
const LET = 'abcd';
let D = null, CARDS = [], CI = {}, TOP = {}, ROUTE = '', RUN = null, SESS = null, QZ = null;
const now = () => Date.now();
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
const fmtDate = t => new Date(t).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = t => new Date(t).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a, n) => shuffle(a).slice(0, n);
const plural = (n, a, b, c) => n === 1 ? a : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? b : c;
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/<[^>]+>/g, ' ');
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2400); }

/* ---------- stan i zapis ---------- */
function blank() { return { cards: {}, tests: [], lessons: {}, sheets: {}, settings: { newPerDay: 'auto', ret: .9, maxIvl: 'auto', target: 'okr', _srs2: 1, _srs3: 1 }, day: { date: 0, newDone: 0 }, acc: {}, mapst: {}, upd: 0 }; }
function load() { try { const s = JSON.parse(localStorage.getItem(LS)); if (s && s.cards) return Object.assign(blank(), s); } catch (e) {} return blank(); }
let S = load();
function persist() { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} }
const NSH = 6;
const SY = { db: null, uid: null, dirty: new Set(), timer: null, busy: false };
function shard(id) { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % NSH; }
const cver = v => Math.max(v.last || 0, v.cap || 0);
function touch(name) { SY.dirty.add(name); if (!SY.db) return; clearTimeout(SY.timer); SY.timer = setTimeout(flush, 2500); }
function save(cardId) { persist(); if (cardId) touch('c' + shard(cardId)); else touch('meta'); }
function docRef(name) { return SY.db.collection('data/users/' + SY.uid).doc('owpc_' + name); }
async function flush() {
  if (!SY.db || SY.busy || !SY.dirty.size) return;
  SY.busy = true;
  const names = [...SY.dirty]; SY.dirty.clear();
  try {
    for (const n of names) {
      if (n === 'meta') { const u = Date.now(); S.upd = u; persist(); await docRef('meta').set({ tests: S.tests.slice(-120), lessons: S.lessons, sheets: S.sheets, settings: S.settings, day: S.day, acc: S.acc, mapst: S.mapst, upd: u }); }
      else { const i = +n.slice(1); const m = {}; for (const [id, v] of Object.entries(S.cards)) if (shard(id) === i) m[id] = v; await docRef(n).set({ m }); }
    }
    setSync(true);
  } catch (e) { names.forEach(n => SY.dirty.add(n)); setSync(false); }
  SY.busy = false;
  if (SY.dirty.size) { clearTimeout(SY.timer); SY.timer = setTimeout(flush, 4000); }
}
function setSync(on) { const el = $('#sync'); if (!el) return; el.classList.toggle('on', !!on); el.title = on ? 'Postęp zapisuje się na Twoim koncie (synchronizacja)' : 'Postęp zapisany tylko na tym urządzeniu'; }
async function syncInit() {
  setSync(false);
  if (!window.claude || typeof window.claude.use !== 'function') return;
  try {
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return;
    const uid = await user.id(); if (!uid) return;
    SY.db = db; SY.uid = uid; setSync(true);
    const err = () => setSync(false);
    for (let i = 0; i < NSH; i++) {
      docRef('c' + i).onSnapshot(s => {
        if (!s.exists) { touch('c' + i); return; }
        const r = (s.data() || {}).m || {}; let ch = false, local = false;
        for (const [id, v] of Object.entries(r)) { const l = S.cards[id]; if (!l || cver(v) > cver(l)) { S.cards[id] = v; ch = true; } }
        for (const [id, v] of Object.entries(S.cards)) if (shard(id) === i && (!r[id] || cver(v) > cver(r[id]))) local = true;
        if (ch) { persist(); softRender(); } if (local) touch('c' + i);
      }, err);
    }
    docRef('meta').onSnapshot(s => {
      if (!s.exists) { touch('meta'); return; }
      const m = s.data() || {}; let ch = false;
      const ids = new Set(S.tests.map(t => t.id));
      for (const t of m.tests || []) if (!ids.has(t.id)) { S.tests.push(t); ch = true; }
      S.tests.sort((a, b) => a.date - b.date);
      if (ch && CARDS.length) rescoreTests(true);
      for (const [k, v] of Object.entries(m.lessons || {})) if (!S.lessons[k]) { S.lessons[k] = v; ch = true; }
      for (const [k, v] of Object.entries(m.acc || {})) { const cur = new Set(S.acc[k] || []); const n0 = cur.size; (v || []).forEach(x => cur.add(x)); if (cur.size !== n0) { S.acc[k] = [...cur]; ch = true; } }
      for (const [k, v] of Object.entries(m.mapst || {})) if (!S.mapst[k] || (v.t || 0) > (S.mapst[k].t || 0)) { S.mapst[k] = v; ch = true; }
      for (const [k, v] of Object.entries(m.sheets || {})) if (!S.sheets[k] || (v.date || 0) > (S.sheets[k].date || 0)) { S.sheets[k] = v; ch = true; }
      if ((m.upd || 0) > (S.upd || 0)) { if (m.settings) { S.settings = { ...S.settings, ...m.settings }; migSettings(); } if (m.day && m.day.date >= S.day.date) S.day = m.day; S.upd = m.upd; ch = true; }
      if (ch) { persist(); softRender(); }
    }, err);
  } catch (e) { setSync(false); }
}
let softT = null;
// odświeżenie po synchronizacji tylko w widokach „do oglądania” – nigdy w trakcie treningu, testu, sesji czy przeglądu wyniku
const SOFT_OK = ['', 'fiszki', 'testy', 'lekcje', 'analiza', 'arkusze', 'wiecej'];
function softRender() { clearTimeout(softT); softT = setTimeout(() => { const r = location.hash.slice(1).split('-')[0]; if (!RUN && !SESS && !QZ && SOFT_OK.includes(r)) route(); }, 500); }

/* ---------- powtórki: FSRS-4.5 (jak w Anki), z przeniesieniem starych „pudełek” ---------- */
const FW = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const F_DECAY = -0.5, F_FACTOR = 19 / 81, GRADE = { bad: 1, mid: 2, ok: 3, easy: 4 };
const clampD = d => Math.min(10, Math.max(1, d));
const fR = (days, S) => Math.pow(1 + F_FACTOR * Math.max(0, days) / Math.max(.1, S), F_DECAY);
const fIvl = (S, r) => S / F_FACTOR * (Math.pow(r, 1 / F_DECAY) - 1);
const fD0 = g => clampD(FW[4] - (g - 3) * FW[5]);
const retention = () => S.settings.ret || .9;
function examDates() { return { okr: Date.parse(D.dates.okr + 'T10:00:00'), ctr: Date.parse(D.dates.ctr + 'T10:00:00') }; }
function nextExam(t) { const e = examDates(); if (t < e.okr) return e.okr; if (t < e.ctr) return e.ctr; return 0; }
function daysTo(ts, t = now()) { return Math.round((dayStart(ts) - dayStart(t)) / DAY); }
const OLDBOX = [.5, 1, 3, 7, 14, 30];
function migrate(st) { if (!st || st.S) return st; const n = st.n || 1, w = st.w || 0; return { ...st, S: OLDBOX[Math.min(5, st.b || 0)], D: clampD(4.5 + 4 * w / n), v: 2 }; }
const hashN = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// Najdłuższy odstęp: przed etapem ok. 1/3 czasu do niego (np. 26 dni → 9 dni), ale nie mniej niż 5 dni – żeby powtórek nie było setki dziennie
function maxIvl(t, c) {
  const v = S.settings.maxIvl || 'auto'; if (v !== 'auto') return Math.max(1, +v);
  const ex = nextExam(t); if (!ex) return 60;
  const target = ex === examDates().okr ? 1 : 2, left = Math.max(1, daysTo(ex, t));
  if (c && lvlRank[c.lvl] > target) return Math.max(7, Math.min(60, Math.round(left / 2)));
  return Math.max(5, Math.min(21, Math.round(left / 3)));
}
function schedule(st, res, t, c) {
  const g = GRADE[res] || 3; const old = migrate(st); let s = old ? { ...old } : null;
  const fresh = !s || !s.n; let el = 0, prevIvl = 0;
  if (!s) s = { n: 0, w: 0, S: FW[g - 1], D: fD0(g), v: 3 };
  else {
    el = (dayStart(t) - dayStart(s.last || t)) / DAY; prevIvl = Math.max(1, Math.round(((s.due || t) - (s.last || t)) / DAY));
    if (el >= 1) {
      const R = fR(el, s.S), Dd = s.D;
      if (g === 1) s.S = Math.min(s.S, FW[11] * Math.pow(Dd, -FW[12]) * (Math.pow(s.S + 1, FW[13]) - 1) * Math.exp(FW[14] * (1 - R)));
      else s.S = s.S * (1 + Math.exp(FW[8]) * (11 - Dd) * Math.pow(s.S, -FW[9]) * (Math.exp(FW[10] * (1 - R)) - 1) * (g === 2 ? FW[15] : 1) * (g === 4 ? FW[16] : 1));
    } else if (g === 1) s.S = Math.min(s.S, FW[0]);
    s.D = clampD(FW[7] * fD0(3) + (1 - FW[7]) * (s.D - FW[6] * (g - 3)));
  }
  s.n = (s.n || 0) + 1; if (g === 1) s.w = (s.w || 0) + 1; s.last = t; s.g = g; s.v = 3; delete s.b;
  // kroki nauki: „Nie umiem” zawsze, „Z trudem” przy pierwszym spotkaniu – karta wraca jeszcze w tej sesji
  if (g === 1 || (fresh && g === 2)) { s.due = t; s.lrn = 1; return s; }
  let days;
  if (fresh || el < 1) days = g === 4 ? 3 : 1;            // nowa albo powtarzana tego samego dnia: jutro (łatwa – za 3 dni)
  else {
    const f = r => Math.max(1, Math.round(fIvl(s.S, r)));
    days = f(retention());
    const base = Math.max(1, Math.min(el, prevIvl));          // przy powtórce przed terminem liczy się faktyczny czas od ostatniej
    if (g === 2) days = Math.max(1, Math.min(days, Math.round(base * 1.2)));   // „Z trudem” – najwyżej 1,2 × poprzedni odstęp
    if (g === 3) days = Math.max(days, Math.round(base * 1.3));
    if (g === 4) days = Math.max(days, Math.round(base * 2));
  }
  delete s.lrn;
  const cap = maxIvl(t, c);
  if (days >= 4 && c) days += (hashN(c.id + s.n) % 3) - 1;   // lekki rozrzut ±1 dzień, żeby karty nie wracały stadami
  days = Math.max(1, Math.min(days, g === 4 ? cap : Math.max(1, cap - (g === 2 ? 2 : 0))));
  let due = dayStart(t) + days * DAY;
  // przed etapem: karta, której pamięć spadłaby w dniu etapu poniżej 90%, wraca w ostatnim tygodniu (rozłożona po dniach)
  const ex = nextExam(t), target = ex === examDates().okr ? 1 : 2;
  if (ex && (!c || lvlRank[c.lvl] <= target) && due >= dayStart(ex)) {
    const left = (dayStart(ex) - dayStart(t)) / DAY;
    if (left >= 2 && fR(left, s.S) < .9) { const lo = Math.max(dayStart(t) + DAY, dayStart(ex) - 7 * DAY), hi = dayStart(ex) - DAY; const span = Math.max(0, Math.round((hi - lo) / DAY)); due = lo + ((c ? hashN(c.id) : 0) % (span + 1)) * DAY; }
  }
  s.due = due; return s;
}
// jednorazowo: karty zaplanowane dalej niż nowy limit wracają wcześniej (rozłożone po dniach)
function capExisting() {
  const t = now(), d0 = dayStart(t); let k = 0;
  for (const [id, st] of Object.entries(S.cards)) {
    if (!st || !st.due) continue; const c = CI[id]; const cap = maxIvl(t, c);
    if (st.due > d0 + cap * DAY) { st.due = d0 + (1 + hashN(id) % cap) * DAY; st.cap = t; k++; }
  }
  return k;
}
const isDue = (s, t) => s && s.due <= dayStart(t) + DAY - 1;
const mastered = s => { const m = migrate(s); return !!(m && m.S >= 14); };
const recall = (s, t = now()) => { const m = migrate(s); return m ? fR((t - (m.last || t)) / DAY, m.S) : 0; };
function ivlLabel(st, res, c) { if (res === 'bad') return 'za chwilę'; const t = now(), n = schedule(st, res, t, c); if (n.due <= t) return 'za chwilę'; const d = Math.round((n.due - dayStart(t)) / DAY); return d <= 1 ? 'jutro' : d < 31 ? `${d} dni` : d < 365 ? `${Math.round(d / 30)} mies.` : 'rok'; }
function rollDay() { const d = dayStart(now()); if (S.day.date !== d) { S.day = { date: d, newDone: 0 }; } }
function planNew(filter) { const t = now(), ex = nextExam(t); let fresh = 0; for (const c of CARDS) { if (filter && !filter(c)) continue; if (!S.cards[c.id]) fresh++; } const days = ex ? Math.max(1, daysTo(ex, t) - 4) : 60; return { fresh, days, per: Math.ceil(fresh / days) }; }
function forecast(filter, n = 7) { const t0 = dayStart(now()); const out = Array(n).fill(0); for (const c of CARDS) { if (filter && !filter(c)) continue; const s = S.cards[c.id]; if (!s) continue; const d = Math.max(0, Math.floor((s.due - t0) / DAY)); if (d < n) out[d]++; } return out; }

/* ---------- budowa kart ---------- */
const POOLS = {
  szk: { n: 'Testy szkolne 2013–2025', d: '540 pytań wielokrotnego wyboru z 13 edycji (dział I)', lvl: 'szk' },
  okr1: { n: 'Testy okręgowe cz. I', d: '540 pytań wielokrotnego wyboru (działy I–II)', lvl: 'okr' },
  okr2: { n: 'Zadania otwarte – okręgowy cz. II', d: 'wszystkie 13 arkuszy cz. II rozbite na pytania z kluczem', lvl: 'okr' },
  new: { n: 'Nowe pytania (stan 2026)', d: 'aktualni szefowie instytucji, liczby, przepisy – sprawdzone w X–XI 2026', lvl: 'okr' },
  bc: { n: 'Pojęcia, Konstytucja, osoby', d: 'karty pojęć, skrótów, liczb i zdjęć', lvl: 'okr' },
  map: { n: 'Mapa Europy i siedziby', d: 'numery z mapy olimpijskiej, stolice, lata wejścia do NATO i UE, siedziby instytucji', lvl: 'okr' },
  qz: { n: 'Quizy finałowe 2014–2025', d: '900 pytań ustnych z III części etapu centralnego', lvl: 'ctr' },
  ctr: { n: 'Zadania etapu centralnego', d: 'cz. I i II stopnia centralnego rozbite na pytania', lvl: 'ctr' },
  aut: { n: 'Pytania autorskie – prognoza 2026/27', d: 'nowe pytania i zadania ułożone według schematów z lat 2013–2025: rocznice, aktualności, „pewniaki”, KPP', lvl: 'okr' },
  kpp: { n: 'Karta praw podstawowych UE', d: 'program zmienny XIV edycji: 54 artykuły, historia, moc prawna', lvl: 'ctr' },
};
function buildCards() {
  const C = [];
  for (const m of D.mc) C.push({ ...m, k: 'mc', ans: m.k, pool: m.st === 'szk' ? 'szk' : m.st === 'okr1' ? 'okr1' : m.st === 'aut' ? 'aut' : (m.t === 'KPP' ? 'kpp' : 'new'), lvl: m.st === 'szk' ? 'szk' : m.st === 'okr1' ? 'okr' : (m.lvl || 'szk') });
  for (const o of D.op) C.push({ ...o, k: 'op', pool: o.st === 'okr2' ? 'okr2' : o.st === 'aut' ? 'aut' : 'ctr', lvl: o.st === 'okr2' ? 'okr' : o.st === 'aut' ? (o.lvl || 'okr') : 'ctr', src: sheetLabel(o.sid) + ' · zad. ' + o.no + ' – ' + o.tt, mapimg: o.ty === 'mapa' && o.st === 'aut' ? 1 : 0 });
  for (const q of D.qz) C.push({ id: q.id, k: 'qz', pool: 'qz', lvl: 'ctr', t: q.t, q: q.q, a: q.a, cat: q.cat, src: `Quiz finałowy ${q.ed} OWPC (${q.yr}), kat. ${q.cn}: ${q.cat}` });
  for (const b of D.basic) C.push({ id: b.id, k: 'bc', pool: b.lvl === 'ctr' ? 'kpp' : 'bc', lvl: b.lvl, t: b.t, q: b.f, a: b.b, e: b.x, img: b.img, l: b.l, tg: b.tg || [] });
  if (D.kpp) {
    for (const a of D.kpp.arts) {
      C.push({ id: 'K-A' + a.n, k: 'bc', pool: 'kpp', lvl: 'ctr', t: 'KPP', q: `KPP UE – art. ${a.n}: jaki ma tytuł i co gwarantuje?`, a: `„${a.title}” (tytuł ${a.tyt} – ${a.tytn})`, e: a.key });
      C.push({ id: 'K-T' + a.n, k: 'bc', pool: 'kpp', lvl: 'ctr', t: 'KPP', q: `KPP UE: w którym artykule i tytule jest „${a.title}”?`, a: `art. ${a.n}, tytuł ${a.tyt} – ${a.tytn}`, e: a.key });
    }
    D.kpp.facts.forEach((f, i) => C.push({ id: 'K-F' + (i + 1), k: 'bc', pool: 'kpp', lvl: 'ctr', t: 'KPP', q: f.q, a: f.a, e: '' }));
  }
  if (D.mapa) {
    for (const s of D.mapa.states) {
      C.push({ id: 'M-N' + s.n, k: 'bc', pool: 'map', lvl: 'okr', t: 'MAP', q: `${s.n > 46 ? 'Mapa kursu' : 'Mapa olimpijska'}: które państwo ma nr ${s.n}? Podaj nazwę i stolicę.`, a: `${s.name} – ${s.cap}`, e: accLine(s), mapimg: 1 });
      C.push({ id: 'M-S' + s.n, k: 'bc', pool: 'map', lvl: 'okr', t: 'MAP', q: `${s.name}: numer na mapie, stolica, rok wejścia do NATO i do Wspólnot/UE?`, a: `nr ${s.n}; ${s.cap}; NATO: ${s.nato || 'nie należy'}; UE: ${s.ue || (s.cand ? 'kandydat' : 'nie należy')}`, e: s.note || '', mapimg: 1 });
    }
    D.mapa.seats.forEach((s, i) => C.push({ id: 'M-X' + (i + 1), k: 'bc', pool: 'map', lvl: 'okr', t: 'MAP', q: `Siedziba: ${s.org} – miasto, państwo i nr na mapie?`, a: `${s.city}; ${(D.mapa.states.find(x => x.n === s.n) || {}).name || ''} (nr ${s.n})`, e: '' }));
  }
  CARDS = C; CI = {}; for (const c of C) CI[c.id] = c;
}
function accLine(s) { return `NATO: ${s.nato || 'nie'} · Wspólnoty/UE: ${s.ue || (s.cand ? 'kandydat' : 'nie')} · Rada Europy: ${s.re || 'nie'}${s.note ? ' · ' + s.note : ''}`; }
function sheetLabel(sid) { const [y, p, q] = sid.split('_'); if (p === 'aut') return 'Zadanie autorskie – prognoza XIV OWPC (2026/27), wzór: ' + ({ okr: 'okręgowy cz. II', okr3: 'okręgowy cz. II (zestaw 2)', map: 'okręgowy cz. II – część z mapą', src: 'okręgowy cz. II – teksty źródłowe', ctr: 'centralny cz. I', kpp: 'centralny cz. II (KPP UE)' }[q] || ''); const ed = { 2013: 'I', 2014: 'II', 2015: 'III', 2016: 'IV', 2017: 'V', 2018: 'VI', 2019: 'VII', 2020: 'VIII', 2021: 'IX', 2022: 'X', 2023: 'XI', 2024: 'XII', 2025: 'XIII' }[y]; return `${{ okr2: 'Okręgowy cz. II', ctr1: 'Centralny cz. I', ctr2: 'Centralny cz. II' }[p]} ${ed} OWPC (${y}/${String(+y.slice(2) + 1).padStart(2, '0')})`; }
const lvlRank = { szk: 0, okr: 1, ctr: 2 };

/* ---------- nawigacja ---------- */
const NAV = [
  ['', 'Start', '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>'],
  ['analiza', 'Analiza', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
  ['lekcje', 'Lekcje', '<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>'],
  ['fiszki', 'Fiszki', '<rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 2h12a2 2 0 0 1 2 2v12"/>'],
  ['testy', 'Testy', '<path d="M9 11l2 2 4-4M5 3h14v18H5z"/>'],
  ['arkusze', 'Arkusze', '<path d="M6 2h9l5 5v15H6zM14 2v6h6"/>'],
  ['mapa', 'Mapa', '<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3zM9 3v15M15 6v15"/>'],
  ['szukaj', 'Szukaj', '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'],
];
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
function navHTML() {
  const cur = (location.hash.replace(/^#\/?/, '').split(/[-/]/)[0] || ''); 
  const map = { lekcja: 'lekcje', sesja: 'fiszki', test: 'testy', wynik: 'testy', arkusz: 'arkusze', quiz: 'testy' };
  const act = map[cur] ?? cur;
  $('#tabs').innerHTML = NAV.map(([h, n]) => `<a href="#${h}" class="${act === h ? 'on' : ''}">${n}</a>`).join('');
  const bot = [NAV[0], NAV[2], NAV[3], NAV[4], ['wiecej', 'Więcej', '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>']];
  $('#bottom').innerHTML = bot.map(([h, n, p]) => `<a href="#${h}" class="${act === h || (h === 'wiecej' && ['analiza', 'arkusze', 'mapa', 'szukaj', 'wiecej'].includes(act)) ? 'on' : ''}">${svg(p)}<span>${n}</span></a>`).join('');
}
function route() {
  const h = location.hash.replace(/^#\/?/, ''); const parts = h.split(/[-/]/); const p = parts[0] === 'start' ? '' : parts[0]; const a = parts[1], b = parts.slice(2).join('-');
  if (RUN && p !== 'test') { const tgt = location.hash; history.replaceState(null, '', '#test'); ask('Przerwać test? Odpowiedzi zostaną utracone.', 'Przerwij test', () => { stopRun(); location.hash = tgt; }); return; }
  if (p !== 'quiz') { if (QZ && QZ.timer) clearInterval(QZ.timer); QZ = null; }
  if (p !== 'sesja') SESS = null;
  ROUTE = h; navHTML();
  const app = $('#app');
  const V = { '': vHome, analiza: vAnaliza, lekcje: vLekcje, lekcja: vLekcja, fiszki: vFiszki, sesja: vSesja, testy: vTesty, test: vTest, wynik: vWynik, quiz: vQuiz, arkusze: vArkusze, arkusz: vArkusz, mapa: vMapa, szukaj: vSzukaj, wiecej: vWiecej, ustawienia: vUstawienia };
  (V[p] || vHome)(app, a, b);
  if (!p || !['sesja', 'test', 'quiz'].includes(p)) window.scrollTo(0, 0);
}
function ask(msg, yes, onYes) {
  const d = document.createElement('div'); d.className = 'modal';
  d.innerHTML = `<div class="mbox" role="dialog" aria-modal="true"><p>${esc(msg)}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-x="0">Anuluj</button><button class="btn red" data-x="1">${esc(yes)}</button></div></div>`;
  document.body.appendChild(d); const close = () => d.remove();
  d.onclick = e => { const x = e.target.dataset.x; if (e.target === d || x === '0') close(); if (x === '1') { close(); onYes(); } };
  d.querySelector('[data-x="1"]').focus();
}
function stopRun() { if (RUN && RUN.timer) clearInterval(RUN.timer); RUN = null; }
const go = h => { location.hash = h; };

/* ---------- START ---------- */
function stats(filter) {
  const t = now(); let total = 0, seen = 0, mast = 0, due = 0;
  for (const c of CARDS) { if (filter && !filter(c)) continue; total++; const s = S.cards[c.id]; if (s) { seen++; if (mastered(s)) mast++; if (isDue(s, t)) due++; } }
  return { total, seen, mast, due };
}
function vHome(app) {
  rollDay();
  const e = examDates(), t = now();
  const dOkr = daysTo(e.okr, t), dCtr = daysTo(e.ctr, t);
  const okrPhase = dOkr >= 0;
  const st = stats(c => lvlRank[c.lvl] <= (okrPhase ? 1 : 2));
  const lastT = S.tests.slice(-3).reverse();
  const lessonsDone = Object.keys(S.lessons).length;
  app.innerHTML = `
  <section class="hero">
    <div>
      <div class="eyebrow">Olimpiada Wiedzy o Prawach Człowieka w Świecie Współczesnym · COPTIOSH</div>
      <h1>Kurs na <em>pierwsze miejsce</em> w XIV edycji</h1>
      <p class="lead">Wszystkie arkusze z 13 edycji (szkolne, okręgowe i centralne) zamienione na fiszki z kluczem i wyjaśnieniem, lekcje według programu, generator testów w formacie każdego etapu i analiza tego, co naprawdę się punktuje.</p>
      <div class="row"><a class="btn pri big" href="#sesja">Powtórka na dziś</a><a class="btn big" href="#testy">Test próbny</a><a class="btn big" href="#analiza">Co jest na którym etapie</a></div>
    </div>
    <div class="count">
      <div class="k">${okrPhase ? 'Stopień okręgowy' : 'Stopień centralny'}</div>
      <div class="big">${okrPhase ? (dOkr > 0 ? dOkr : 'dziś') : (dCtr > 0 ? dCtr : 'dziś')}<small>${(okrPhase ? dOkr : dCtr) > 0 ? plural(okrPhase ? dOkr : dCtr, 'dzień', 'dni', 'dni') : ''}</small></div>
      <div class="r"><span>${okrPhase ? 'sobota 19 XII 2026: cz. I 10.00, cz. II do 13.30' : 'sobota 5 VI 2027'}</span></div>
      <div class="r"><span>Lista do finału</span><b>5 III 2027</b></div>
      <div class="r"><span>Finał (cz. I, II i quiz)</span><b>5 VI 2027</b></div>
    </div>
  </section>
  <div class="grid g4" style="margin-top:16px">
    <div class="card kpi"><div class="n">${st.due}</div><div class="l">kart do powtórki dziś</div></div>
    <div class="card kpi"><div class="n">${st.seen}<span class="small muted"> / ${st.total}</span></div><div class="l">kart przerobionych ${okrPhase ? '(zakres okręgowy)' : ''}</div><div class="bar" style="margin-top:8px"><i style="width:${pct(st.seen, st.total)}%"></i></div></div>
    <div class="card kpi"><div class="n">${st.mast}</div><div class="l">kart opanowanych (odstęp ≥ 14 dni)</div></div>
    <div class="card kpi"><div class="n">${lessonsDone}<span class="small muted"> / ${D.lessons.length}</span></div><div class="l">lekcji przeczytanych</div></div>
  </div>
  ${backupHTML()}
  ${todayHTML()}
  <h2>Plan do etapu okręgowego</h2>
  ${planHTML(dOkr)}
  <h2>Na skróty</h2>
  <div class="grid g3">
    <a class="tile" href="#lekcje"><b>Lekcje i ściągi</b><span>${D.lessons.length} lekcji według działów I–III programu i programu zmiennego (KPP UE)</span></a>
    <a class="tile" href="#fiszki"><b>Fiszki z arkuszy</b><span>${CARDS.length} kart: pytanie z odpowiedziami na froncie, klucz i wyjaśnienie na odwrocie</span></a>
    <a class="tile" href="#testy"><b>Generator testów</b><span>szkolny, okręgowy cz. I i II, centralny cz. I i II, quiz finałowy na czas</span></a>
    <a class="tile" href="#arkusze"><b>Arkusze oryginalne</b><span>${D.sheets.length} arkuszy cz. II okręgowego i centralnego z kluczami</span></a>
    <a class="tile" href="#mapa"><b>Mapa Europy</b><span>własna mapa w numeracji organizatora; trening: stolice i lata wejścia do NATO, UE, RE, euro, Schengen, ONZ</span></a>
    <a class="tile" href="#analiza"><b>Analiza etapów</b><span>co i jakie zadania są na okręgowym, a co na centralnym</span></a>
    <a class="tile" href="#lekcja-L29"><b>Prognoza 2026/27</b><span>tendencje z 13 edycji i ${CARDS.filter(c => c.pool === 'aut').length} pytań i zadań autorskich (rocznice, aktualności, KPP)</span></a>
    <a class="tile" href="#sesja-p-aut"><b>Fiszki: prognoza</b><span>pytania autorskie w formacie testu i zadań otwartych każdego etapu</span></a>
  </div>
  ${lastT.length ? `<h2>Ostatnie testy</h2><div class="card">${lastT.map(testRow).join('')}</div>` : ''}
  <p class="small muted" style="margin-top:28px">Stan materiałów: ${fmtDate(Date.parse(D.built))}. Fakty bieżące (szefowie instytucji) sprawdzone w XI 2026 – przed etapem przejrzyj fiszki z oznaczeniem „aktualne”.</p>`;
}
/* ---------- plan dnia: najsłabsze tematy ważone częstością na etapie ---------- */
function weakTopics() {
  const t0 = now(), ex = nextExam(t0), target = ex === examDates().okr ? 1 : 2;
  const A = {};
  const get = t => A[t] || (A[t] = { t, w: 0, n: 0, ok: 0, tot: 0, seen: 0 });
  for (const c of CARDS) {
    if (lvlRank[c.lvl] > target || c.t === 'MAP' || !TOP[c.t]) continue;
    const a = get(c.t); a.tot++;
    const y = +String(c.yr || c.sid || '').slice(0, 4);
    if ((c.pool === 'okr1' || c.pool === 'okr2' || (target === 2 && c.pool === 'ctr')) && y >= 2021) a.w++;
    const st = S.cards[c.id];
    if (st) { a.seen++; a.n++; if ((st.g || (st.b > 0 ? 3 : 1)) > 1) a.ok++; }
  }
  const lim = t0 - 45 * DAY;
  for (const tt of S.tests) if (tt.date >= lim) for (const r of tt.res || []) { const c = CI[r.id]; if (!c || !A[c.t]) continue; A[c.t].n++; if (r.pts >= 1) A[c.t].ok++; }
  const W = Math.max(1, ...Object.values(A).map(a => a.w));
  return Object.values(A).filter(a => a.tot >= 8).map(a => {
    const acc = (a.ok + 1) / (a.n + 2), cov = a.seen / a.tot, imp = .25 + a.w / W;
    return { ...a, acc, cov, pri: imp * (.6 * (1 - acc) + .4 * (1 - cov)) };
  }).sort((x, y) => y.pri - x.pri);
}
function backupHTML() {
  if (SY.db) return '';
  const seen = Object.keys(S.cards).length + S.tests.length; if (seen < 20) return '';
  const d = S.lastExport ? Math.floor((now() - S.lastExport) / DAY) : null; if (d !== null && d < 7) return '';
  return `<div class="callout noprint" style="margin-top:16px"><b>Postęp jest zapisany tylko w tej przeglądarce.</b> ${d === null ? 'Nie masz jeszcze kopii.' : `Ostatnia kopia: ${d} dni temu.`} Pobierz kopię raz w tygodniu – przyda się, gdy przeglądarka wyczyści dane (np. Safari po kilku dniach bez wizyty) albo zechcesz uczyć się na innym urządzeniu. <a href="#ustawienia">Ustawienia → Pobierz kopię</a>${GH ? ' · na telefonie dodaj kurs do ekranu początkowego – wtedy dane są bezpieczniejsze i kurs działa offline.' : ''}</div>`;
}
function todayHTML() {
  rollDay();
  const t0 = now(), ex = nextExam(t0); if (!ex) return '';
  const target = ex === examDates().okr ? 1 : 2, inScope = c => lvlRank[c.lvl] <= target;
  const st = stats(inScope), lim = newLimit(), leftNew = Math.max(0, lim - S.day.newDone);
  const wk = weakTopics(), top = wk.slice(0, 2), today = dayStart(t0);
  const did = k => S.tests.some(x => x.date >= today && (k === 'mini' ? /^Mini-test/.test(x.title) : x.kind === k));
  const lastOf = k => { const L = S.tests.filter(x => x.kind === k); return L.length ? Math.floor((today - dayStart(L[L.length - 1].date)) / DAY) : null; };
  const L = D.lessons.filter(l => (l.t || []).includes(top[0] && top[0].t)).sort((a, b) => (S.lessons[a.id] || 0) - (S.lessons[b.id] || 0))[0];
  const items = [];
  items.push({ ok: st.due === 0 && leftNew === 0, h: `Fiszki: ${st.due} ${plural(st.due, 'powtórka', 'powtórki', 'powtórek')} + do ${leftNew} nowych`, d: `ok. ${Math.max(5, Math.round((st.due + leftNew) * 9 / 60))} min · najpierw zakres ${target === 1 ? 'okręgowy' : 'centralny'}`, a: `<a class="btn sm pri" href="#sesja">Zacznij</a>` });
  if (top.length) items.push({ ok: did('mini'), h: `Mini-test z najsłabszych tematów: ${top.map(x => tname(x.t)).join(' + ')}`, d: '15 pytań (testowe i otwarte) · 15 min', a: `<button class="btn sm" id="miniT">Zacznij</button>` });
  if (L) items.push({ ok: S.lessons[L.id] && S.lessons[L.id] >= today, h: `Lekcja: ${esc(L.title)}`, d: `${S.lessons[L.id] ? 'powtórz ściągę' : 'jeszcze nieprzeczytana'} · ok. ${L.min} min`, a: `<a class="btn sm" href="#lekcja-${L.id}">Otwórz</a>` });
  if (target === 1) {
    const l1 = lastOf('okr1'), sims = S.tests.filter(x => x.sim && x.part === 2 && x.date >= today - 6 * DAY).length;
    if (!sims && (l1 === null || l1 >= 3)) items.push({ ok: false, h: l1 === null ? 'Pierwszy test „Okręgowy cz. I” (40 min)' : `Test „Okręgowy cz. I” – ostatni ${l1} ${plural(l1, 'dzień', 'dni', 'dni')} temu`, d: 'co 3 dni, na czas', a: `<button class="btn sm" data-pre="okr1">Zacznij</button>` });
    if (!sims) items.push({ ok: false, h: 'Pełna symulacja okręgowego w tym tygodniu', d: 'cz. I + cz. II, 80 min – najlepiej w sobotę rano, jak 19 XII', a: `<button class="btn sm" data-pre="okrsim">Zacznij</button>` });
  } else {
    const l = lastOf('ctr1'); if (l === null || l >= 5) items.push({ ok: false, h: 'Test „Centralny cz. I”', d: 'mapa + zadania, 50 min', a: `<button class="btn sm" data-pre="ctr1">Zacznij</button>` });
  }
  setTimeout(() => {
    const m = $('#miniT'); if (m) m.onclick = () => startTest({ kind: 'custom', title: 'Mini-test: ' + top.map(x => tname(x.t)).join(' + '), pool: 'mcop', topics: top.map(x => x.t), n: 15, mins: 15 });
    $$('[data-pre]').forEach(b => b.onclick = () => startTest({ ...PRESETS.find(x => x.kind === b.dataset.pre) }));
  }, 0);
  return `<h2>Dziś</h2><div class="grid g2 today"><div class="card">${items.map(i => `<div class="titem ${i.ok ? 'done' : ''}"><span class="tick">${i.ok ? '✓' : ''}</span><span><b>${i.h}</b><br><span class="small muted">${i.d}</span></span><span>${i.ok ? '' : i.a}</span></div>`).join('')}</div>
  <div class="card"><h3 style="margin-top:0">Tematy do podciągnięcia</h3>${wk.slice(0, 6).map(a => `<div class="wkt"><span class="lbl">${esc(tname(a.t))}</span><span class="t"><i style="width:${a.n ? Math.round(a.acc * 100) : 0}%"></i></span><span class="mono small">${a.n ? Math.round(a.acc * 100) + '%' : '–'} · ${Math.round(a.cov * 100)}% przer.</span></div>`).join('')}
  <p class="small muted" style="margin:8px 0 0">Kolejność: skuteczność w fiszkach i testach (ostatnie 45 dni) i to, ile kart tematu jeszcze nie widziałeś – ważone tym, jak często temat był na ${target === 1 ? 'okręgowym' : 'centralnym'} w latach 2021–2025.</p></div></div>`;
}
function planHTML(dOkr) {
  const rows = [
    ['14–22 XI', 'Analiza etapów + lekcje działu II (sądy, UE i NATO, demokracja, prawa dziecka, komitety). Codziennie nowe fiszki w liczbie wyliczonej automatycznie (tak, by zdążyć przed 19 XII) – sekcja „Dziś”.', ['analiza', 'lekcje']],
    ['23 XI – 6 XII', 'Zadania otwarte cz. II (wszystkie 13 arkuszy) + mapa. Co 3 dni test „Okręgowy cz. I” (40 min), raz w tygodniu pełna symulacja (cz. I + cz. II).', ['fiszki', 'testy']],
    ['7–15 XII', 'Powtórki, tylko błędy i pułapki. Dwa pełne arkusze cz. II na czas. Przegląd aktualności i szefów instytucji.', ['testy', 'arkusze']],
    ['16–18 XII', 'Lekkie powtórki, ściągi: komitety traktatowe, Konstytucja (artykuły), lata dokumentów, NATO/UE, siedziby.', ['lekcje']],
    ['19 XII', 'Etap okręgowy. Cz. I: 40 pytań, każde 0/1 – zaznacz wszystkie poprawne i wpisz ich liczbę w kratce.', []],
  ];
  return `<div class="card"><table><tbody>${rows.map(r => `<tr><td class="mono" style="white-space:nowrap;width:120px">${r[0]}</td><td>${r[1]}</td><td style="width:1%;white-space:nowrap">${r[2].map(x => `<a class="btn sm" href="#${x}">${NAV.find(n => n[0] === x)[1]}</a>`).join(' ')}</td></tr>`).join('')}</tbody></table>
  <p class="small muted" style="margin:10px 0 0">Po 19 XII plan przełącza się na etap centralny: dział III, KPP UE (40 pkt w cz. II!) i quiz finałowy.</p></div>`;
}
function testRow(t) { return `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span><b>${esc(t.title)}</b> <span class="muted small">· ${fmtShort(t.date)}</span></span><span class="mono">${fmtPts(t.score)} / ${t.max} pkt (${pct(t.score, t.max)}%)</span></div>`; }
const fmtPts = x => Number.isInteger(x) ? x : x.toFixed(1).replace('.', ',');

/* ---------- ANALIZA ---------- */
function bars(rows, max, cls = 'c1', unit = '') {
  return rows.map(([lbl, v, v2]) => `<div class="hb"><span class="lbl" title="${esc(lbl)}">${esc(lbl)}</span><span class="t"><i class="${cls}" style="width:${pct(v, max)}%"></i>${v2 != null ? `<i class="c2" style="width:${pct(v2, max)}%"></i>` : ''}</span><span class="num mono small">${fmtPts(v)}${v2 != null ? '/' + fmtPts(v2) : ''}${unit}</span></div>`).join('');
}
const tname = c => (TOP[c] || {}).n || c;
function vAnaliza(app) {
  const A = D.analysis;
  const mcRows = st => Object.entries(A['mc_' + st]).sort((a, b) => b[1] - a[1]).map(([k, v]) => [tname(k), v]);
  const opT = Object.entries(A.op_pts_topic).filter(([k]) => k.startsWith('okr2|')).map(([k, v]) => [k.split('|')[1], v]).sort((a, b) => b[1] - a[1]);
  const opTy = Object.entries(A.op_pts_type).filter(([k]) => k.startsWith('okr2|')).map(([k, v]) => [k.split('|')[1], v]).sort((a, b) => b[1] - a[1]);
  const TYN = { dok: 'dokumenty, daty, organy, które je przyjęły', def: 'pojęcia, opisy, zasady – „co to jest”', liczby: 'liczby i lata (daty, kadencje, składy)', gen: 'generacje i rodzaje praw (tabele z X)', wyp: 'krótka wypowiedź (do 2018/19)', kom: 'komitety traktatowe (eksperci, lata, nazwy)', mapa: 'mapa Europy – numery, stolice, NATO/UE', osoby: 'osoby: szefowie instytucji, RPD, RPO', skroty: 'rozwijanie skrótów + kadencje', logo: 'loga NGO i organizacji', zasady: 'zasady sądów', konst: 'artykuły Konstytucji', chron: 'chronologia' };
  const qzT = Object.entries(A.qz_topic).sort((a, b) => b[1] - a[1]).map(([k, v]) => [tname(k), v]);
  const totOp = A.op_tot.okr2 || 1;
  const kl = A.k_len, kn = Object.values(kl).reduce((a, b) => a + b, 0);
  const my = topicMastery();
  app.innerHTML = `
  <div class="eyebrow">Mapa olimpiady</div><h1>Co się punktuje na którym etapie</h1>
  <p class="lead">Policzone na wszystkich arkuszach 2013/14–2025/26: ${A.mc_szk_n + A.mc_okr1_n} pytań testowych, ${D.op.length} pytań z zadań otwartych cz. II i ${D.qz.length} pytań quizowych.</p>
  <div class="grid g3">
    <div class="card stage"><div class="eyebrow">I stopień – szkolny (6 XI 2026)</div><b>40 pytań wielokrotnego wyboru, 40 min</b><p class="small">Dział I programu. Każde pytanie 0 lub 1 pkt (co najmniej jedna odpowiedź poprawna). Awans: min. 20 pkt.</p></div>
    <div class="card stage"><div class="eyebrow">II stopień – okręgowy (19 XII 2026)</div><b>Cz. I: 40 pytań testowych, 40 min · Cz. II: zadania otwarte 40 pkt, 40 min</b><p class="small">Działy I i II. Do cz. II przechodzi 12 najlepszych z min. 16 pkt. Awans do finału: min. 40/80 pkt i miejsce w limicie okręgu (1–6 miejsc + po 1 za laureatów z zeszłego roku). Remis rozstrzyga cz. I, potem testowa część cz. II, potem wynik szkolny.</p></div>
    <div class="card stage c"><div class="eyebrow">III stopień – centralny (5 VI 2027)</div><b>Cz. I: 50 pkt / 50 min · Cz. II: 40 pkt / 40 min · Cz. III: quiz 10 pkt</b><p class="small">Cz. I – działy I–III; cz. II – wyłącznie program zmienny (KPP UE). Do cz. II przechodzi 50% najlepszych (finaliści). 25 laureatów wg sumy I+II. 10 najlepszych gra quiz; miejsca I–X = suma I+II+III, przy remisie decyduje quiz.</p></div>
  </div>
  <div class="callout"><b>Wniosek strategiczny.</b> Na pierwsze miejsce składają się trzy rzeczy, które da się wytrenować: (1) bezbłędna cz. I okręgowego – rozstrzyga remisy i wejście do cz. II; (2) cz. II centralnego z programu zmiennego – 40 pkt z jednego dokumentu (KPP UE), których większość rywali uczy się dopiero wiosną; (3) quiz – odpowiedź w 15 s, bez zastanawiania się, dlatego trzeba trenować go na czas.</div>

  <h2>Etap okręgowy – część I (test)</h2>
  <div class="grid g2">
    <div class="card"><h3>Tematy pytań testowych</h3><div class="legend"><span><i class="c1"></i>testy okręgowe cz. I (${A.mc_okr1_n})</span></div>${bars(mcRows('okr1'), Math.max(...Object.values(A.mc_okr1)))}</div>
    <div class="card"><h3>Dla porównania: etap szkolny</h3><div class="legend"><span><i class="c2"></i>testy szkolne (${A.mc_szk_n})</span></div>${bars(mcRows('szk'), Math.max(...Object.values(A.mc_szk)), 'c2')}</div>
  </div>
  <div class="card"><h3>Jak zbudowane są pytania testowe</h3>
    <div class="grid g4">${[1, 2, 3, 4].map(n => `<div class="kpi"><div class="n">${pct(kl[n] || 0, kn)}%</div><div class="l">pytań z ${n} ${plural(n, 'poprawną odpowiedzią', 'poprawnymi', 'poprawnymi')}</div></div>`).join('')}</div>
    <p class="small" style="margin-top:12px">Prawie połowa pytań ma więcej niż jedną poprawną odpowiedź, a punkt jest tylko za komplet. ${A.traps} pytań w archiwum ma odpowiedź-pułapkę (podobne nazwy, przekręcone imiona, przesunięte daty). Organizator powtarza pytania niemal dosłownie co kilka lat – fiszki z archiwum to najszybszy zysk punktowy.</p></div>
  <div class="callout red"><b>Na okręgowym część I obejmuje działy I i II.</b> Najwięcej pytań: system ONZ i pakty, generacje praw, komitety traktatowe, PRL, prawo międzynarodowe (MTK, tortury, uchodźcy), integracja europejska i NATO, wybory i referenda, mniejszości i prawa socjalne, prawa dziecka.</div>

  <h2>Etap okręgowy – część II (zadania otwarte)</h2>
  <div class="grid g2">
    <div class="card"><h3>Punkty wg tematu (13 arkuszy)</h3>${bars(opT.map(([k, v]) => [tname(k), v]), opT[0] ? opT[0][1] : 1, 'c1', ' pkt')}</div>
    <div class="card"><h3>Punkty wg typu zadania</h3>${bars(opTy.map(([k, v]) => [TYN[k] || k, v]), opTy[0] ? opTy[0][1] : 1, 'c3', ' pkt')}</div>
  </div>
  <div class="card"><h3>Stałe typy zadań w cz. II (2019/20–2025/26)</h3>
    <ul>
      <li><b>Szefowie instytucji</b> – RPO, RPD, TK, NIK, NSA, UNHCHR, UNHCR, MTK, ERPO, przewodniczący KPC, KPGSiK i RPC (w 2025/26 aż 8 pkt). Klucz wymaga imienia i nazwiska bez literówek.</li>
      <li><b>Komitety traktatowe</b> – liczba ekspertów, rok rozpoczęcia działalności, nazwa, konwencja (do 10 pkt).</li>
      <li><b>Generacje i rodzaje praw</b> – tabela z X (5–10 pkt): osobiste, polityczne, socjalne, gospodarcze, kulturalne, solidarnościowe.</li>
      <li><b>Skróty instytucji RP + kadencja szefa</b> (NSA 6, KRS 4, UOKiK 5, TK 6, SN 6, RPD 5, UODO 4, TS 4, RPO 5, KRRiT 6, UKE 5, NIK 6, IPN 5).</li>
      <li><b>Artykuły Konstytucji</b> (prawa dziecka: 38, 48, 65, 70, 72), <b>zasady sądów</b> (jednolitość, kolegialność, odrębność, wyłączność).</li>
      <li><b>Dokumenty</b>: kto przyjął i kiedy (PDPC, pakty, konwencje, KPP), rozdziały Karty NZ, angielskie akty 1215/1679/1689.</li>
      <li><b>Logo NGO</b> – nazwa, siedziba, rok (AI, HFPC, HRW, MKCK, La Strada).</li>
      <li><b>Część B – źródło: mapa Europy</b> (od 2023/24): numer, nazwa, stolica państwa; rok wejścia do NATO i UE; siedziby instytucji; państwa łamiące prawa człowieka.</li>
    </ul>
    <p class="small muted">Zasady oceniania: skreślenie lub poprawka = błąd; wpisanie większej liczby odpowiedzi niż trzeba (w tym jednej błędnej) = 0 pkt za zadanie; „przekręcone” nazwiska = błąd; pełne nazwy zamiast skrótów („Zgromadzenie Ogólne ONZ”, a nie „ZO”).</p></div>

  <h2>Etap centralny</h2>
  <div class="grid g2">
    <div class="card"><h3>Część I (50 pkt, działy I–III)</h3><ul class="small">
      <li>Od 2024/25: <b>część I z mapą Europy</b> – siedziby instytucji ONZ/OBWE/NGO (miasto, państwo, nr), państwa z rokiem wejścia do NATO i UE, kolorowe rewolucje, państwa z opisu.</li>
      <li>Szefowie (UNHCR, TK, ONZ, MTK, ERPO), dokładne daty dzienne (KNZ 26 VI 1945, MPPOiP 16 XII 1966), liczba artykułów i rozdziałów dokumentów.</li>
      <li>Prawa człowieka w Afryce (Karta Banjul – Nairobi 1981), w świecie arabskim, konwencje o torturach, protokoły do KPD i MPPOiP, kara śmierci (Protokoły 6 i 13), komitety (liczba ekspertów).</li>
      <li>Dawniej: biogramy polityków, terminy prawnicze, Nagrody Nobla dla organizacji, polscy sędziowie ETPC i MTK, chronologie RPD i RPO.</li></ul></div>
    <div class="card"><h3>Część II (40 pkt, program zmienny)</h3><ul class="small">
      <li>Zawsze jeden dokument lub instytucja – w 2026/27 <b>Karta praw podstawowych UE</b>: system przed Kartą, nazwa, przyjęcie, moc prawna, Lizbona, preambuła i 7 tytułów.</li>
      <li>Typowe polecenia z lat poprzednich: dokładne daty (przyjęcie, wejście w życie, ratyfikacja przez Polskę), liczba artykułów, numery artykułów do treści, protokoły, organy kontroli, uzupełnianie tekstu z lukami, prawda/fałsz.</li>
      <li>Wniosek: znaj numer i tytuł każdego z 54 artykułów KPP i najważniejsze daty – moduł KPP w fiszkach i test „Centralny cz. II”.</li></ul></div>
  </div>
  <div class="grid g2">
    <div class="card"><h3>Quiz finałowy – kategorie (9 edycji)</h3>${bars(qzT, qzT[0][1])}</div>
    <div class="card"><h3>Zasady quizu</h3><p class="small">10 kategorii po 10 pytań; każdy z 10 laureatów dostaje po jednym pytaniu z każdej kategorii. 15 sekund na rozpoczęcie odpowiedzi, liczy się pierwsza odpowiedź, 1 lub 0 pkt. Od 2024/25 kategorie odpowiadają blokom programu (3 × blok I, II, III stałego + 1 z programu zmiennego).</p><p class="small">Typowe kategorie: aktualności roku, członkowie NATO i UE (lata), kadencje, siedziby, skróty, generacje praw, komitety, kara śmierci, UNESCO, mniejszości w RP, tryb ustawodawczy, Konwencja o prawach dziecka.</p><a class="btn pri" href="#quiz">Trenuj quiz na czas</a></div>
  </div>
  <div class="callout"><b>Tendencje i prognoza 2026/27.</b> ${Math.round(100 * 444 / 1080)}% pytań testowych to niemal dosłowne powtórki z innych edycji, a zadania otwarte mają stały szkielet. Na tej podstawie powstało ${CARDS.filter(c => c.pool === 'aut').length} pytań i zadań autorskich (rocznice 2026, aktualności, „pewniaki”, KPP w układzie zadań z lat 2023–2025).<div class="row" style="margin-top:10px"><a class="btn sm pri" href="#lekcja-L29">Lekcja: tendencje i prognoza</a><a class="btn sm" href="#sesja-p-aut">Fiszki: prognoza</a><button class="btn sm" id="autT">Test: prognoza</button></div></div>
  <h2>Co z tego wynika – priorytety</h2>
  <div class="card"><table><thead><tr><th>Priorytet</th><th>Na okręgowy (19 XII)</th><th>Na centralny (5 VI)</th></tr></thead><tbody>
    <tr><td><b>1</b></td><td>Fiszki z testów szkolnych i okręgowych (1080 pytań) – działy I i II</td><td>KPP UE – wszystkie artykuły, daty, moc prawna (40 pkt)</td></tr>
    <tr><td><b>2</b></td><td>Zadania otwarte cz. II – 13 arkuszy z kluczem; komitety, generacje, kadencje, szefowie</td><td>Dział III: organizacje międzynarodowe, konflikty, prawo międzynarodowe PCz</td></tr>
    <tr><td><b>3</b></td><td>Mapa: numery, stolice, NATO/UE, siedziby</td><td>Quiz finałowy na czas (900 pytań archiwalnych)</td></tr>
    <tr><td><b>4</b></td><td>Aktualni szefowie instytucji i aktualności PL/UE</td><td>Aktualności świata 2026/27, szczegółowe daty dzienne</td></tr>
  </tbody></table></div>
  ${my.length ? `<h2>Twoje wyniki wg tematów</h2><div class="card">${bars(my.map(r => [tname(r.t), r.ok, null]), 100, 'c4', '%')}<p class="small muted">Odsetek kart danego tematu ocenionych jako „Umiem” przy ostatniej powtórce (min. 5 kart).</p></div>` : ''}`;
  const at = $('#autT'); if (at) at.onclick = () => startTest({ ...PRESETS.find(p => p.kind === 'aut') });
}
function topicMastery() {
  const agg = {};
  for (const c of CARDS) { const s = S.cards[c.id]; if (!s) continue; const a = agg[c.t] || (agg[c.t] = { t: c.t, n: 0, ok: 0 }); a.n++; if (s.S ? s.g > 1 : s.b > 0) a.ok++; }
  return Object.values(agg).filter(a => a.n >= 5).map(a => ({ t: a.t, ok: pct(a.ok, a.n) })).sort((a, b) => a.ok - b.ok);
}

/* ---------- LEKCJE ---------- */
const GRP = { I: 'Dział I – stopień szkolny (i dalej)', II: 'Dział II – stopień okręgowy', III: 'Dział III – stopień centralny', Z: 'Program zmienny – Karta praw podstawowych UE', A: 'Aktualności i strategia' };
function vLekcje(app) {
  const groups = {};
  for (const l of D.lessons) (groups[l.grp] || (groups[l.grp] = [])).push(l);
  app.innerHTML = `<div class="eyebrow">Moduł merytoryczny</div><h1>Lekcje i ściągi</h1>
  <p class="lead">Lekcje według stałego programu (działy I–III) i programu zmiennego. Każda kończy się ściągą do druku i przyciskami do fiszek i testu z tematu.</p>
  <div class="row noprint" style="margin:-4px 0 8px"><button class="btn" id="pdfO">PDF: ściągi na okręgowy</button><button class="btn" id="pdfA">PDF: wszystkie ściągi</button><span class="small muted">ze spisem treści i numerami stron · każda lekcja ma też własny PDF (ściąga + lekcja)</span></div>
  ${D.lessons.length ? '' : '<div class="card empty">Lekcje są w przygotowaniu.</div>'}
  ${Object.keys(GRP).filter(g => groups[g]).map(g => `<h2>${GRP[g]}</h2><div class="toc">${groups[g].map(l => `<a href="#lekcja-${l.id}"><span class="no">${l.id}</span><span><b>${esc(l.title)}</b><span class="mt">${esc(l.prog)} · ${l.min} min · ${l.t.map(tname).join(', ')}</span></span><span class="done-dot ${S.lessons[l.id] ? 'on' : ''}">${S.lessons[l.id] ? '✓' : ''}</span></a>`).join('')}</div>`).join('')}`;
  $('#pdfO').onclick = () => downloadPdf('okregowy', 'Ściągi na okręgowy');
  $('#pdfA').onclick = () => downloadPdf(null, 'Wszystkie ściągi');
}
function vLekcja(app, id) {
  const i = D.lessons.findIndex(l => l.id === id); const l = D.lessons[i];
  if (!l) { app.innerHTML = '<div class="empty">Nie ma takiej lekcji.</div>'; return; }
  const n = l.pool ? CARDS.filter(c => c.pool === l.pool).length : CARDS.filter(c => l.t.includes(c.t)).length;
  const prev = D.lessons[i - 1], next = D.lessons[i + 1];
  app.innerHTML = `<div class="lesson">
    <div class="small noprint"><a href="#lekcje">← Lekcje</a></div>
    <div class="eyebrow" style="margin-top:12px">${esc(GRP[l.grp] || '')} · program: ${esc(l.prog)}</div>
    <h1>${esc(l.title)}</h1>
    ${l.lead ? `<p class="lead">${esc(l.lead)}</p>` : ''}
    <div class="row noprint" style="margin:6px 0 18px"><button class="btn sm" id="tSc">Pokaż ściągę</button><button class="btn sm" id="pr">Ściąga PDF</button><a class="btn sm" href="${l.pool ? '#sesja-p-' + l.pool : '#sesja-t-' + l.t.join('-')}">${l.pool ? 'Fiszki: pytania autorskie' : 'Fiszki z tematu'} (${n})</a><button class="btn sm" id="tst">Test z tematu</button></div>
    <div id="lsc" class="sheet" hidden>${l.sc || '<p>Brak ściągi.</p>'}</div>
    <div class="md" id="lmd">${l.h}</div>
    <div class="row noprint" style="margin:24px 0"><button class="btn ${S.lessons[l.id] ? '' : 'pri'}" id="done">${S.lessons[l.id] ? '✓ Przeczytane' : 'Oznacz jako przeczytane'}</button></div>
    <div class="grid g2 noprint">${prev ? `<a class="tile" href="#lekcja-${prev.id}"><span>← poprzednia</span><b>${esc(prev.title)}</b></a>` : '<span></span>'}${next ? `<a class="tile" href="#lekcja-${next.id}" style="text-align:right"><span>następna →</span><b>${esc(next.title)}</b></a>` : ''}</div>
  </div>`;
  $('#tSc').onclick = () => { const s = $('#lsc'); s.hidden = !s.hidden; $('#lmd').hidden = !s.hidden ? true : false; $('#tSc').textContent = s.hidden ? 'Pokaż ściągę' : 'Pokaż lekcję'; };
  $('#pr').onclick = () => downloadPdf(l.id, l.title);
  $('#done').onclick = () => { if (S.lessons[l.id]) delete S.lessons[l.id]; else S.lessons[l.id] = now(); save(); vLekcja(app, id); };
  $('#tst').onclick = () => { const pr = l.pool && PRESETS.find(p => p.kind === l.pool); if (pr) startTest({ ...pr }); else startTest({ kind: 'custom', title: 'Test z tematu: ' + l.title, topics: l.t, n: 20, mins: 20 }); };
}

async function downloadPdf(id, title) {
  const url = id ? `sciagi/${id}.pdf` : 'sciagi/wszystkie.pdf';
  const name = id === 'okregowy' ? 'Sciagi-OWPC-okregowy.pdf' : id ? `Sciaga-OWPC-${id}.pdf` : 'Sciagi-OWPC-wszystkie.pdf';
  toast('Przygotowuję PDF…');
  try {
    const blob = await (await fetch(url)).blob();
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (dl) { await dl.save({ filename: name, data: blob }); toast('Zapisano PDF'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Pobrano PDF');
  } catch (e) { if (e && e.code === 'declined') return; toast('Nie udało się zapisać – otwieram PDF'); window.open(url, '_blank'); }
}

/* ---------- FISZKI ---------- */
function vFiszki(app) {
  rollDay();
  const t = now();
  const f = S.settings.fz || (S.settings.fz = { pools: ['szk', 'okr1', 'okr2', 'new', 'aut', 'bc', 'map'], topic: '', flag: '', _aut: 1 });
  if (!f._aut) { if (f.pools.includes('new') && !f.pools.includes('aut')) f.pools.push('aut'); f._aut = 1; }
  const pstats = Object.keys(POOLS).map(p => ({ p, ...stats(c => c.pool === p) }));
  app.innerHTML = `<div class="eyebrow">Powtórki</div><h1>Fiszki</h1>
  <p class="lead">Front: pytanie (z odpowiedziami a–d, jeśli to test). Możesz zaznaczyć odpowiedź albo wpisać swoją. Odwrót: klucz, wyjaśnienie każdej odpowiedzi, ramka „Uwaga” przy spornych kluczach i źródło. Nowa karta: „Nie umiem” i „Z trudem” – wraca jeszcze w tej sesji, „Umiem” – jutro, „Łatwe” – za 3 dni. Potem odstępy rosną według algorytmu FSRS (jak w Anki), ale przed etapem najwyżej do ${maxIvl(now())} dni (ok. 1/3 czasu, jaki został), więc każda karta z jego zakresu wróci przed nim jeszcze kilka razy. Limit zmienisz w Ustawieniach.</p>${fcHTML()}
  <div class="card"><div class="row between"><b>Zestaw na sesję</b><span class="small muted">nowych dziś: ${S.day.newDone} / ${newLimit()}${S.settings.newPerDay === 'auto' ? ' (auto)' : ''} · <a href="#ustawienia">zmień</a></span></div>
  <div class="seg" id="presets"><button data-p="okr">Wszystko na okręgowy</button><button data-p="ctr">Wszystko na centralny</button><button data-p="o2">Tylko cz. II okręgowego</button><button data-p="kpp">KPP UE</button><button data-p="aut">Prognoza 2026/27</button></div>
  ${pstats.map(s => `<label class="ck deck" style="grid-template-columns:auto minmax(0,1fr) auto"><input type="checkbox" value="${s.p}" ${f.pools.includes(s.p) ? 'checked' : ''} ${s.total ? '' : 'disabled'}><span><b>${POOLS[s.p].n}</b><br><span class="small muted">${POOLS[s.p].d}</span><span class="bar" style="margin-top:6px;max-width:320px"><i style="width:${pct(s.seen, s.total)}%"></i></span></span><span class="small mono" style="text-align:right">${s.total}<br><span class="muted">${s.due ? s.due + ' do powt.' : s.seen + ' przer.'}</span></span></label>`).join('')}
  <div class="grid g2" style="margin-top:12px"><label><span class="small muted">Temat</span><select id="ftopic"><option value="">wszystkie tematy</option>${D.topics.map(x => `<option value="${x.c}" ${f.topic === x.c ? 'selected' : ''}>${esc(x.n)}</option>`).join('')}</select></label>
  <label><span class="small muted">Tylko</span><select id="fflag"><option value="">wszystkie karty</option><option value="bad" ${f.flag === 'bad' ? 'selected' : ''}>moje błędy</option><option value="trap" ${f.flag === 'trap' ? 'selected' : ''}>pułapki i sporne klucze</option><option value="akt" ${f.flag === 'akt' ? 'selected' : ''}>aktualne (zmienne fakty)</option><option value="new" ${f.flag === 'new' ? 'selected' : ''}>tylko nowe</option></select></label></div>
  <div class="row" style="margin-top:14px"><button class="btn pri big" id="go">Zacznij sesję</button><span class="small muted" id="cnt"></span></div></div>`;
  const upd = () => { f.pools = $$('#app input[type=checkbox]:checked').map(x => x.value); f.topic = $('#ftopic').value; f.flag = $('#fflag').value; S.settings.fz = f; persist(); const q = sessQueue(f); $('#cnt').textContent = `${q.due} do powtórki, ${q.fresh} nowych dostępnych`; };
  $$('#app input[type=checkbox]').forEach(x => x.onchange = upd); $('#ftopic').onchange = upd; $('#fflag').onchange = upd;
  $$('#presets button').forEach(b => b.onclick = () => { const P = { okr: ['szk', 'okr1', 'okr2', 'new', 'aut', 'bc', 'map'], ctr: ['ctr', 'qz', 'kpp', 'aut', 'okr1', 'okr2', 'map'], o2: ['okr2', 'map'], kpp: ['kpp'], aut: ['aut'] }[b.dataset.p]; $$('#app input[type=checkbox]').forEach(x => x.checked = P.includes(x.value)); upd(); });
  $('#go').onclick = () => { upd(); save(); go('#sesja'); };
  upd();
}
function filterCard(c, f) {
  if (f.pools && f.pools.length && !f.pools.includes(c.pool)) return false;
  if (f.topics && f.topics.length && !f.topics.includes(c.t)) return false;
  if (f.topic && c.t !== f.topic) return false;
  const s = S.cards[c.id];
  if (f.flag === 'bad' && !(s && s.w)) return false;
  if (f.flag === 'trap' && !(c.tg && (c.tg.includes('pulapka') || c.tg.includes('sporne') || c.tg.includes('blad_klucza')) || c.u)) return false;
  if (f.flag === 'akt' && !((c.tg && c.tg.includes('aktualne')) || /XI 2026|stan na|Stan na/.test(c.u || ''))) return false;
  if (f.flag === 'new' && s) return false;
  return true;
}
function sessQueue(f) {
  const t = now(); const due = [], fresh = [];
  for (const c of CARDS) { if (!filterCard(c, f)) continue; const s = S.cards[c.id]; if (s) { if (isDue(s, t)) due.push(c); } else fresh.push(c); }
  return { due: due.length, fresh: fresh.length, dueL: due, freshL: fresh };
}
function newLimit() { const v = S.settings.newPerDay; if (v !== 'auto' && v) return +v; const ex = nextExam(now()), target = ex === examDates().okr ? 1 : 2; return Math.max(15, Math.min(150, planNew(c => lvlRank[c.lvl] <= target).per)); }
function sessSummary() { const f = SESS && SESS.f; const fc = forecast(f ? (c => filterCard(c, f)) : null, 2); return `Jutro w tym zestawie do powtórki: ${fc[1]} ${plural(fc[1], 'karta', 'karty', 'kart')}. Karty, których nie umiałeś, wracały w tej sesji aż do skutku, a od jutra wrócą w krótkim odstępie.`; }
function vSesja(app, a, b) {
  rollDay();
  if (!SESS) {
    let f = { ...(S.settings.fz || { pools: ['szk', 'okr1', 'okr2'] }) };
    if (a === 't' && b) f = { pools: [], topics: b.split('-'), flag: '' };
    if (a === 'p' && b && POOLS[b]) f = { pools: [b], topics: null, flag: '' };
    const t = now(), q = sessQueue(f);
    const lim = newLimit(), left = Math.max(0, lim - S.day.newDone);
    const ex = nextExam(t), target = ex === examDates().okr ? 1 : 2;
    // zaległe: najpierw karty z zakresu najbliższego etapu, w ich obrębie najniższa przewidywana pamięć
    const dueL = q.dueL.map(c => ({ c, r: (lvlRank[c.lvl] > target ? 1 : 0) + recall(S.cards[c.id], t) })).sort((x, y) => x.r - y.r).map(x => x.c);
    // nowe: najpierw zakres bliższego etapu, potem nowsze edycje i pytania autorskie
    const yr = c => +((c.sid || '').match(/^\d{4}/) || [0])[0];
    const freshL = shuffle(q.freshL).sort((x, y) => ((lvlRank[x.lvl] > target) - (lvlRank[y.lvl] > target)) || (yr(y) >= 2022) - (yr(x) >= 2022));
    const PORTION = 50;
    const nDue = Math.min(dueL.length, PORTION);
    const nNew = (a === 't' || a === 'p' || f.flag === 'new') ? Math.min(30, freshL.length) : Math.min(left, freshL.length, Math.max(0, PORTION - nDue), 25);
    const D0 = dueL.slice(0, nDue), N0 = freshL.slice(0, nNew);
    // przeplatanie: jedna nowa karta co ~3 powtórki, żeby nowe nie lądowały wszystkie na końcu
    const list = []; let di = 0, ni = 0; while (di < D0.length || ni < N0.length) { for (let k = 0; k < 3 && di < D0.length; k++) list.push(D0[di++]); if (ni < N0.length) list.push(N0[ni++]); }
    if (!list.length) { app.innerHTML = `<div class="sess"><h1>Na dziś wszystko zrobione</h1><p class="lead">${q.fresh && !left ? `Dzienny limit nowych kart (${lim}) wyczerpany – możesz go zmienić w ustawieniach albo zrobić test.` : 'Brak kart do powtórki w wybranym zestawie.'}</p><div class="row"><a class="btn pri" href="#fiszki">Zmień zestaw</a><a class="btn" href="#ustawienia">Ustawienia</a><a class="btn" href="#testy">Zrób test</a></div></div>`; return; }
    SESS = { f, a, b, q: list, i: 0, done: 0, ok: 0, back: false, sel: new Set(), typed: '', again: [], isNew: new Set(N0.map(c => c.id)) };
  }
  renderCard(app);
}
function renderCard(app) {
  const s = SESS; const c = s.q[s.i];
  if (!c) { const p = pct(s.ok, s.done); app.innerHTML = `<div class="sess"><div class="eyebrow">Koniec sesji</div><h1>${s.done} ${plural(s.done, 'karta', 'karty', 'kart')}, ${p}% zapamiętanych</h1><p class="lead">${sessSummary()} ${S.day.newDone >= S.settings.newPerDay ? 'Limit nowych kart na dziś wyczerpany.' : ''}</p><div class="row"><button class="btn pri" id="more">Kolejna porcja</button><a class="btn" href="#fiszki">Zestawy</a><a class="btn" href="#start">Start</a></div></div>`; $('#more').onclick = () => { const A = s.a, B = s.b; SESS = null; vSesja(app, A, B); }; return; }
  const st = S.cards[c.id];
  const info = `<span>${esc(POOLS[c.pool].n)} · ${esc(tname(c.t))}</span><span>${s.i + 1} / ${s.q.length}${st ? ` · ${srsInfo(st)}` : ' · nowa'}</span>`;
  app.innerHTML = `<div class="sess">
   <div class="sbar"><a href="#fiszki" class="small">← zestawy</a><span class="sp bar"><i style="width:${pct(s.i, s.q.length)}%"></i></span><span class="mono small">${s.ok}/${s.done}</span></div>
   <div class="flip"><div class="fc ${s.back ? 'back' : ''}" id="fc">
     <div class="face f">${front(c, info)}</div>
     <div class="face b" id="fb">${s.back ? backHTML(c, info) : ''}</div>
   </div></div>
   <div id="act">${s.back ? gradeHTML(c) : `<div class="row" style="justify-content:center;margin-top:14px"><button class="btn pri big" id="flipb">Odwróć kartę</button></div><div class="keys kbdh">spacja – odwróć · 1–4 – ocena</div>`}</div>
  </div>`;
  bindCard(app, c);
}
function stemHTML(c) {
  let h = `<div class="fq">${c.q}</div>`;
  if (c.img) h += `<div class="qimg" style="text-align:center">${c.img}</div>`;
  if (c.mapimg && D.mapa) h += mapDetHTML('Pokaż mapę');
  return h;
}
function front(c, info) {
  const s = SESS;
  let h = `<div class="fmeta">${info}</div>` + stemHTML(c);
  if (c.k === 'mc') h += `<div>${c.o.map((o, i) => `<button class="opt ${s.sel.has(LET[i]) ? 'sel' : ''}" data-l="${LET[i]}"><span class="l">${LET[i]}</span><span>${o}</span></button>`).join('')}</div><p class="small muted" style="margin:6px 0 0">Zaznacz wszystkie poprawne (może być kilka) albo od razu odwróć kartę.</p>`;
  else h += `<input type="text" id="typed" placeholder="Twoja odpowiedź (opcjonalnie)" value="${esc(s.typed)}" autocomplete="off" style="margin-top:6px">`;
  if (c.k === 'op') h += `<div class="src">${esc(c.src)} · ${fmtPts(c.pts)} pkt za całe zadanie</div>`;
  if (c.k === 'qz') h += `<div class="src">${esc(c.src)}</div>`;
  return h;
}
function backHTML(c, info) {
  const s = SESS; let h = `<div class="fmeta">${info}</div>`;
  if (c.k === 'mc') {
    const ok = c.ans.split(''); const chosen = [...s.sel];
    const answered = chosen.length > 0; const g = answered ? mcOk(c, chosen) : 0; const good = !!g;
    h += `<div class="fq" style="font-size:17px">${c.q}</div>${c.img ? `<div class="qimg" style="text-align:center">${c.img}</div>` : ''}`;
    h += c.o.map((o, i) => optRev(c, i, answered ? s.sel.has(LET[i]) : null)).join('');
    h += `<div class="row between" style="margin-top:6px"><span class="ans">Poprawne: ${ok.join(', ')}</span>${answered ? `<span class="verdict ${good ? 'ok' : 'bad'}">${g === 2 ? 'Dobrze (wariant klucza)' : good ? 'Dobrze' : 'Źle'}</span>` : ''}</div>${altNote(c)}`;
  } else {
    h += `<div class="fq" style="font-size:17px">${c.q}</div><div class="ans">${esc(c.a)}</div>`;
    if (s.typed) { const a = isAcc(c.id, s.typed), m = scoreOpen(c.id, s.typed, c.a); h += `<div class="small" id="tyv">Twoja odpowiedź: <b>${esc(s.typed)}</b> <span class="verdict ${m >= .8 ? 'ok' : m >= .45 ? 'mid' : 'bad'}" style="margin-left:6px">${a ? 'uznana' : m >= .8 ? 'zgodna' : m >= .45 ? 'częściowo' : 'inna'}</span>${m < .8 ? ` <button class="btn sm" id="accOne" style="margin-left:6px">✓ Uznaję moją odpowiedź</button>` : ''}</div>`; }
  }
  if (c.e) h += `<div class="ex">${c.k === 'mc' ? c.e : esc(c.e)}</div>`;
  if (c.u) h += `<div class="note"><b>Uwaga:</b> ${c.k === 'mc' ? c.u : esc(c.u)}</div>`;
  if (c.l) h += `<div class="src">${c.l}</div>`;
  if (c.src) h += `<div class="src">${esc(c.src)}</div>`;
  return h;
}
function srsInfo(st) { const m = migrate(st); const r = Math.round(recall(m) * 100); const iv = Math.max(1, Math.round((m.due - (m.last || m.due)) / DAY)); return `pamięć ~${Math.min(99, r)}% · odstęp ${iv} ${plural(iv, 'dzień', 'dni', 'dni')}${m.w ? ` · błędy: ${m.w}` : ''}`; }
function gradeHTML(c) {
  const s = SESS; let sug = '';
  if (c.k === 'mc' && s.sel.size) sug = mcOk(c, [...s.sel]) ? 'g3' : 'g1';
  else if (s.typed) { const m = scoreOpen(c.id, s.typed, c.a); sug = m >= .8 ? 'g3' : m >= .45 ? 'g2' : 'g1'; }
  const st = S.cards[c.id];
  const B = [['g1', 'bad', 'Nie umiem'], ['g2', 'mid', 'Z trudem'], ['g3', 'ok', 'Umiem'], ['g4', 'easy', 'Łatwe']];
  return `<div class="grade g4b">${B.map(([cl, r, l], i) => `<button class="${cl} ${sug === cl ? 'sug' : ''}" data-r="${r}"><b>${l}</b><span>${ivlLabel(st, r, c)}</span><kbd>${i + 1}</kbd></button>`).join('')}</div><div class="keys">„Nie umiem” (a przy nowej karcie także „Z trudem”) – karta wróci jeszcze w tej sesji. „Z trudem” – pamiętałeś, ale z wysiłkiem lub częściowo. Przy pytaniu testowym jedna zła litera = „Nie umiem”.</div>`;
}
function bindCard(app, c) {
  const s = SESS;
  $$('#fc .face.f .opt').forEach(b => b.onclick = () => { const L = b.dataset.l; s.sel.has(L) ? s.sel.delete(L) : s.sel.add(L); b.classList.toggle('sel'); });
  const ti = $('#typed'); if (ti) { ti.oninput = () => s.typed = ti.value; ti.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); flip(); } }; }
  const fb = $('#flipb'); if (fb) fb.onclick = flip;
  $$('#act .grade button').forEach(b => b.onclick = () => grade(b.dataset.r));
  function flip() { s.back = true; $('#fb').innerHTML = backHTML(c, $('#fc .fmeta').innerHTML); $('#fc').classList.add('back'); bindBack(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function bindBack() { $('#act').innerHTML = gradeHTML(c); $$('#act .grade button').forEach(b => b.onclick = () => grade(b.dataset.r)); const ab = $('#accOne'); if (ab) ab.onclick = () => { setAcc(c.id, s.typed, true); $('#fb').innerHTML = backHTML(c, $('#fc .fmeta').innerHTML); bindBack(); toast('Uznano – ta odpowiedź będzie odtąd zaliczana'); }; }
  if (s.back) bindBack();
  function grade(r) {
    const t = now(); S.cards[c.id] = schedule(S.cards[c.id], r, t, c);
    if ((r === 'ok' || r === 'easy') && c.k !== 'mc' && s.typed && scoreOpen(c.id, s.typed, c.a) < .8) setAcc(c.id, s.typed, true);
    if (s.isNew.has(c.id)) { S.day.newDone++; s.isNew.delete(c.id); touch('meta'); }
    s.done++; if (r !== 'bad') s.ok++;
    if (S.cards[c.id].due <= t) { const k = s.again.filter(x => x === c.id).length; if (k < 3) { s.again.push(c.id); s.q.splice(Math.min(s.q.length, s.i + 4 + 3 * k), 0, c); } }
    save(c.id); s.i++; s.back = false; s.sel = new Set(); s.typed = ''; renderCard(app);
  }
  s.flip = flip; s.grade = grade;
}
document.addEventListener('keydown', e => {
  if (!SESS || !location.hash.startsWith('#sesja')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === ' ' && !SESS.back) { e.preventDefault(); SESS.flip && SESS.flip(); }
  else if (SESS.back && ['1', '2', '3', '4'].includes(e.key)) SESS.grade(['bad', 'mid', 'ok', 'easy'][+e.key - 1]);
  else if (!SESS.back && /^[a-d]$/.test(e.key)) { const b = $(`#fc .face.f .opt[data-l="${e.key}"]`); b && b.click(); }
});
/* podobieństwo odpowiedzi wpisanej do klucza (podpowiedź, nie wyrok) */
function variants(a) {
  const out = new Set(); const base = a.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
  out.add(base); out.add(a.replace(/[[\]()]/g, ' '));
  for (const m of a.matchAll(/\[(?:i\/lub:|lub:)?([^\]]+)\]/g)) out.add(m[1]);
  for (const m of a.matchAll(/\(([^)]+)\)/g)) out.add(m[1]);
  a.split(/;| lub |\/| albo /).forEach(x => out.add(x.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')));
  return [...out].map(x => toks(x)).filter(x => x.length);
}
const STOP = new Set(['i', 'w', 'z', 'na', 'do', 'ds', 'o', 'oraz', 'od', 'ze', 'r', 'roku', 'rok', 'lat', 'lata', 'art', 'nr', 'a', 'the', 'of', 'nie']);
function toks(s) { return fold(s).replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(w => w && !STOP.has(w)); }
function matchScore(user, ans) {
  const u = toks(user); if (!u.length) return 0;
  let best = 0;
  for (const v of variants(ans)) {
    const vs = new Set(v); let hit = 0;
    for (const w of u) if (vs.has(w) || [...vs].some(x => x.length > 4 && w.length > 4 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5))))) hit++;
    const prec = hit / u.length, rec = Math.min(1, hit / v.length);
    const f = prec + rec ? 2 * prec * rec / (prec + rec) : 0; if (f > best) best = f;
  }
  return best;
}

const srt = x => String(x || '').split('').sort().join('');
function mcOk(c, sel) { const u = srt(Array.isArray(sel) ? sel.join('') : sel); if (!u) return 0; if (u === srt(c.ans)) return 1; return (c.ka || []).some(v => srt(v) === u) ? 2 : 0; }
const altNote = c => c.ka && c.ka.length ? `<div class="small kalt">Klucz organizatora zalicza też: <b>${c.ka.map(v => v.split('').join(', ')).join(' albo ')}</b></div>` : '';
function isAcc(id, u) { const a = S.acc[id]; return !!(a && u && a.includes(nrm(u))); }
function setAcc(id, u, on) { if (!u || !u.trim()) return; const x = nrm(u); const a = new Set(S.acc[id] || []); if (on) a.add(x); else a.delete(x); if (a.size) S.acc[id] = [...a]; else delete S.acc[id]; persist(); touch('meta'); }
function scoreOpen(id, u, ans) { return u ? (isAcc(id, u) ? 1 : matchScore(u, ans)) : 0; }

// Przeliczenie zapisanych wyników: warianty klucza (MC), uznane odpowiedzi, bez połówek
function migSettings() { const st = S.settings; if (!st._srs2) { if (st.newPerDay === 40 || !st.newPerDay) st.newPerDay = 'auto'; st.ret = st.ret || .9; st._srs2 = 1; persist(); } if (!st._srs3) { st.maxIvl = st.maxIvl || 'auto'; st._srs3 = 1; const k = capExisting(); persist(); if (k) { touch('meta'); for (let i = 0; i < NSH; i++) touch('c' + i); } } }
function rescoreTests(notify) {
  let up = 0, ch = 0;
  for (const t of S.tests || []) {
    let dirty = false;
    for (const r of t.res || []) {
      const c = CI[r.id]; if (!c) continue;
      let p = r.pts;
      if (r.k === 'mc') { const ok = mcOk(c, r.user || ''); if (ok && p < 1) { p = 1; r.alt = ok === 2 ? 1 : 0; } }
      else { if (r.user && isAcc(r.id, r.user)) { p = 1; r.acc = 1; } else if (!r.manual && r.user) p = matchScore(r.user, c.a) >= .8 ? 1 : 0; if (p > 0 && p < 1) p = 0; }
      if (p !== r.pts) { if (p > r.pts) up++; r.pts = p; dirty = true; }
    }
    if (dirty) { t.score = t.res.reduce((a, r) => a + r.pts, 0); ch++; }
  }
  if (ch) { persist(); touch('meta'); if (notify && up) setTimeout(() => toast(`Doliczono ${up} ${plural(up, 'punkt', 'punkty', 'punktów')} w zapisanych testach (warianty klucza)`), 600); }
  return up;
}

/* ---------- TESTY ---------- */
const PRESETS = [
  { kind: 'okrsim', title: 'Pełna symulacja okręgowego', desc: 'cz. I (40 pytań, 40 min) → cz. II (zadania + mapa, 40 min) · wynik łączny / 80', real: 'Jak 19 XII: po cz. I widzisz, czy przekroczyłbyś próg 16 pkt, potem rozwiązujesz cz. II. Suma obu części decyduje o awansie (min. 40 / 80 i limit miejsc w okręgu).', mins: 40, pri: 1 },
  { kind: 'szk', title: 'Etap szkolny', desc: '40 pytań wielokrotnego wyboru z działu I · 40 min · awans od 20 pkt', real: 'Kolejność i proporcje tematów jak w losowym arkuszu z lat 2023–2025; pytania z innych edycji i autorskie.', mins: 40 },
  { kind: 'okr1', title: 'Okręgowy – część I', desc: '40 pytań wielokrotnego wyboru z działów I–II · 40 min · punkt tylko za komplet liter', real: 'Do cz. II przechodzi 12 najlepszych w okręgu (min. 16 pkt) – w praktyce trzeba zwykle znacznie więcej. Układ jak w losowym arkuszu 2021–2025: najpierw Polska i pojęcia, potem ONZ, komitety, dzieci i mniejszości, na końcu Europa, NGO i świat. Pytania z innych edycji (ok. 50%), szkolne (15%) i autorskie/aktualne (35%).', mins: 40, pri: 1 },
  { kind: 'okr2', title: 'Okręgowy – część II', desc: 'cz. A: zadania otwarte (ok. 30 pkt) + cz. B: mapa (ok. 10 pkt) · 40 min', real: 'Te same typy zadań co w arkuszu 2023, 2024 lub 2025: szefowie instytucji (stan na XI 2026), komitety traktatowe, generacje praw, NGO – siedziba i rok, skróty i kadencje, Konstytucja, mapa. Całe zadania z innych lat i autorskie.', mins: 40, pri: 1 },
  { kind: 'aut', title: 'Prognoza 2026/27 – okręgowy', desc: '24 pytania testowe + 16 pkt zadań otwartych, wyłącznie pytania autorskie', real: 'Ułożone według tendencji z 13 edycji: rocznice 2026, aktualni szefowie instytucji, zmiany prawa, „pewniaki”.', mins: 40 },
  { kind: 'ctr1', title: 'Centralny – część I', desc: 'mapa + zadania otwarte z działów I–III · 50 pkt / 50 min', real: 'Układ arkusza 2024 lub 2025 (mapa na początku), całe zadania z innych lat i autorskie.', mins: 50 },
  { kind: 'ctr2', title: 'Centralny – część II: KPP UE', desc: 'program zmienny 2026/27 · 40 pkt / 40 min', real: 'Artykuły, tytuły, historia i moc prawna Karty praw podstawowych UE.', mins: 40 },
  { kind: 'quiz', title: 'Quiz finałowy', desc: '10 kategorii · 15 sekund na odpowiedź, jak w finale', real: 'Dla 10 najlepszych po cz. I i II centralnego; rozstrzyga też remisy.', mins: 0 },
];
const KIND_N = { szk: 'Szkolny', okr1: 'Okręgowy cz. I', okr2: 'Okręgowy cz. II', aut: 'Prognoza 2026/27', ctr1: 'Centralny cz. I', ctr2: 'Centralny cz. II (KPP)', custom: 'Własne' };
function vTesty(app, all) {
  const t = now(), e = examDates(), dO = daysTo(e.okr, t), dC = daysTo(e.ctr, t);
  const hist = S.tests.slice().reverse();
  const best = k => { if (k === 'okrsim') { const L = simPairs(); if (!L.length) return ''; const P = L.map(x => x.sum); return `<p class="small tbest">Pełnych symulacji: ${L.length} · ostatnio ${fmtPts(P[P.length - 1])}/80 · najlepiej ${fmtPts(Math.max(...P))}/80</p>`; } const L = S.tests.filter(x => x.kind === k); if (!L.length) return ''; const b = Math.max(...L.map(x => pct(x.score, x.max))), l = L[L.length - 1]; return `<p class="small tbest">Podejść: ${L.length} · ostatnio ${pct(l.score, l.max)}% · najlepiej ${b}%</p>`; };
  const card = k => { const p = PRESETS.find(x => x.kind === k); return `<div class="tcard"><h3>${p.title}</h3><p class="small"><b>${p.desc}</b></p><p class="small muted">${p.real}</p>${best(k)}<button class="btn ${p.pri ? 'pri' : ''}" data-k="${k}">Zacznij</button></div>`; };
  const stage = (title, when, keys, open) => `<details class="tstage" ${open ? 'open' : ''}><summary><b>${title}</b><span class="small muted">${when}</span></summary><div class="tcards">${keys.map(card).join('')}</div></details>`;
  const kinds = Object.keys(KIND_N).filter(k => S.tests.some(x => x.kind === k));
  app.innerHTML = `<div class="eyebrow">Sprawdzanie wiedzy</div><h1>Testy próbne</h1>
  <p class="lead">Każdy test ma format prawdziwego etapu: ten sam czas, punktacja i układ tematów co wylosowany arkusz z ostatnich lat, ale z innymi pytaniami – z pozostałych edycji i autorskimi. Pytania, które już widziałeś w testach, losują się rzadziej. Oryginalne arkusze z każdego roku są w zakładce <a href="#arkusze">Arkusze</a>.</p>
  ${stage('Etap okręgowy', dO >= 0 ? `sobota 19 XII 2026 · za ${dO} ${plural(dO, 'dzień', 'dni', 'dni')}` : 'odbył się 19 XII 2026', ['okrsim', 'okr1', 'okr2', 'aut'], dO >= 0)}
  ${stage('Etap centralny', `sobota 5 VI 2027${dC >= 0 ? ` · za ${dC} dni` : ''}`, ['ctr1', 'ctr2', 'quiz'], dO < 0)}
  ${stage('Etap szkolny', 'odbył się 6 XI 2026 – do rozgrzewki', ['szk'], false)}
  <details class="tstage"><summary><b>Własny test</b><span class="small muted">wybrany temat, pula i liczba pytań</span></summary><div style="padding:4px 16px 16px"><div class="grid g3">
   <label><span class="small muted">Pula</span><select id="cpool"><option value="mc">pytania testowe (szkolne + okręgowe + autorskie)</option><option value="op">zadania otwarte (okręgowe i autorskie)</option><option value="mix">wszystko na okręgowy</option><option value="qz">pytania quizowe</option><option value="kpp">KPP UE</option></select></label>
   <label><span class="small muted">Temat</span><select id="ctop"><option value="">wszystkie</option>${D.topics.map(x => `<option value="${x.c}">${esc(x.n)}</option>`).join('')}</select></label>
   <label><span class="small muted">Liczba pytań</span><input type="number" id="cn" value="20" min="5" max="80"></label>
  </div><label class="ck"><input type="checkbox" id="cbad"> tylko pytania, w których się myliłem (w fiszkach lub testach)</label><button class="btn" id="cgo">Generuj</button></div></details>
  <h2>Historia wyników</h2>
  ${hist.length ? `${kinds.length ? `<div class="card tw"><table class="thist"><thead><tr><th>Rodzaj</th><th>Podejść</th><th>Ostatni</th><th>Średnio</th><th>Najlepszy</th></tr></thead><tbody>${simPairs().length ? (() => { const P = simPairs().map(x => x.sum); return `<tr><td><b>Pełna symulacja okręgowego</b> <span class="small muted">/ 80</span></td><td class="mono">${P.length}</td><td class="mono">${fmtPts(P[P.length - 1])}</td><td class="mono">${fmtPts(Math.round(P.reduce((a, b) => a + b, 0) / P.length * 2) / 2)}</td><td class="mono">${fmtPts(Math.max(...P))}</td></tr>`; })() : ''}${kinds.map(k => { const L = S.tests.filter(x => x.kind === k), P = L.map(x => pct(x.score, x.max)); return `<tr><td><b>${KIND_N[k]}</b></td><td class="mono">${L.length}</td><td class="mono">${P[P.length - 1]}%</td><td class="mono">${Math.round(P.reduce((a, b) => a + b, 0) / P.length)}%</td><td class="mono">${Math.max(...P)}%</td></tr>`; }).join('')}</tbody></table></div>` : ''}
  <div class="card">${(all ? hist : hist.slice(0, 8)).map(t => `<a href="#wynik-${t.id}" style="text-decoration:none;color:inherit">${testRow(t)}</a>`).join('')}${!all && hist.length > 8 ? `<button class="btn sm" id="hall" style="margin-top:10px">Pokaż wszystkie (${hist.length})</button>` : ''}</div>` : '<p class="muted">Jeszcze nie ma wyników.</p>'}`;
  $$('#app [data-k]').forEach(b => b.onclick = () => { const p = PRESETS.find(x => x.kind === b.dataset.k); if (p.kind === 'quiz') go('#quiz'); else startTest({ ...p }); });
  const ha = $('#hall'); if (ha) ha.onclick = () => vTesty(app, true);
  $('#cgo').onclick = () => startTest({ kind: 'custom', title: 'Test własny', pool: $('#cpool').value, topics: $('#ctop').value ? [$('#ctop').value] : null, n: Math.max(5, Math.min(80, +$('#cn').value || 20)), bad: $('#cbad').checked, mins: 0 });
}
/* ---------- generator: testy na szkielecie prawdziwych arkuszy ---------- */
let TASKX = null;
function usedInTests() { const u = new Set(); for (const t of S.tests) for (const r of t.res || []) u.add(r.id); return u; }
function wpick(arr, w) { const s = w.reduce((a, b) => a + b, 0); let r = Math.random() * s; for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; } return arr[arr.length - 1]; }
// MC: kolejność i proporcje tematów jak w wylosowanym prawdziwym arkuszu, pytania z innych edycji i autorskie
function mcSkeleton(stage, years) {
  const yr = pick(years, 1)[0];
  const tpl = CARDS.filter(c => c.k === 'mc' && c.pool === stage && c.yr === yr).sort((a, b) => a.n - b.n);
  const used = new Set(), seen = usedInTests();
  const srcs = stage === 'szk'
    ? [[c => c.pool === 'szk' && c.yr !== yr, .6], [c => (c.pool === 'aut' || c.pool === 'new') && lvlRank[c.lvl] <= 0, .4]]
    : [[c => c.pool === 'okr1' && c.yr !== yr, .5], [c => c.pool === 'szk', .15], [c => (c.pool === 'aut' || c.pool === 'new') && lvlRank[c.lvl] <= 1, .35]];
  const MC = CARDS.filter(c => c.k === 'mc');
  const items = tpl.map(c0 => {
    const opts = srcs.map(([f, w]) => [MC.filter(c => c.t === c0.t && f(c) && !used.has(c.id)), w]).filter(o => o[0].length);
    let c = null;
    if (opts.length) { const arr = wpick(opts, opts.map(o => o[1]))[0]; const fr = arr.filter(x => !seen.has(x.id)); c = pick(fr.length ? fr : arr, 1)[0]; }
    if (!c) c = c0; used.add(c.id); return { id: c.id, pts: 1 };
  });
  return { items, yr };
}
function taskIndex() {
  if (TASKX) return TASKX; const m = new Map();
  for (const c of CARDS) if (c.k === 'op') { const k = c.sid + '#' + c.no; let t = m.get(k); if (!t) m.set(k, t = { k, sid: c.sid, no: c.no, ty: c.ty, t: c.t, tt: c.tt, st: c.st, lvl: c.lvl, y: +String(c.sid).slice(0, 4), pts: +c.pts || 0, ids: [] }); t.ids.push(c.id); }
  return TASKX = [...m.values()];
}
// zadania otwarte: ten sam układ zadań (typ, temat, punktacja) co w wylosowanym arkuszu, ale całe zadania z innych lat i autorskie
function openSkeleton(stage, years) {
  const yr = pick(years, 1)[0], sid = yr + '_' + stage, T = taskIndex(), seen = usedInTests();
  const tpl = T.filter(t => t.sid === sid);
  const okPool = stage === 'okr2' ? t => t.st === 'okr2' || (t.st === 'aut' && t.lvl !== 'ctr') : t => t.st === 'ctr1' || t.st === 'okr2' || (t.st === 'aut' && !/kpp/.test(t.sid));
  const usedT = new Set(); const items = []; let k = 0, mapPts = 0;
  for (const t0 of tpl) {
    const want = Math.max(1, Math.round(t0.pts || t0.ids.length));
    if (t0.ty === 'mapa') { mapPts += want; continue; }
    if (t0.ty === 'wyp') continue;
    let cand = T.filter(t => t.ty === t0.ty && t.sid !== sid && okPool(t) && !usedT.has(t.k) && t.t !== 'KPP' && t.ids.length >= 2);
    if (t0.ty === 'osoby') cand = cand.filter(t => t.st === 'aut'); // szefowie instytucji – tylko stan aktualny
    if (!cand.length && t0.ty === 'osoby') continue;
    const fresh = t => t.ids.filter(i => !seen.has(i)).length / t.ids.length;
    const tk = cand.length ? wpick(cand, cand.map(t => (t.st === 'aut' ? 2.5 : 1) * (t.t === t0.t ? 2 : 1) * (t.y >= 2020 ? 1.5 : 1) * (t.ids.length >= Math.min(6, want) ? 2 : .5) * (.3 + fresh(t)))) : t0;
    usedT.add(tk.k);
    const n = Math.max(t0.ty === 'chron' ? 1 : 2, Math.min(tk.ids.length, want));
    let ids = tk.ids; if (ids.length > n) { const keep = new Set(pick(ids, n)); ids = ids.filter(i => keep.has(i)); }
    k++; const g = `Zadanie ${k}. ${tk.tt}`; ids.forEach(id => items.push({ id, pts: 1, g }));
  }
  // dopełnienie do punktacji arkusza (zadania częstych typów)
  const goal = tpl.filter(t => t.ty !== 'mapa' && t.ty !== 'wyp').reduce((a, t) => a + Math.max(1, Math.round(t.pts || t.ids.length)), 0);
  for (let guard = 0; items.length < goal - 1 && guard < 6; guard++) {
    const cand = T.filter(t => ['gen', 'kom', 'skroty', 'liczby', 'def', 'dok'].includes(t.ty) && t.sid !== sid && okPool(t) && !usedT.has(t.k) && t.t !== 'KPP' && t.ids.length >= 2);
    if (!cand.length) break; const tk = wpick(cand, cand.map(t => (t.st === 'aut' ? 2 : 1) * (t.y >= 2020 ? 1.5 : 1))); usedT.add(tk.k);
    const ids = tk.ids.slice(0, Math.min(tk.ids.length, goal - items.length)); k++; const g = `Zadanie ${k}. ${tk.tt}`; ids.forEach(id => items.push({ id, pts: 1, g }));
  }
  if (mapPts) { const rows = mapRowsB(Math.max(6, mapPts)); const g = stage === 'ctr1' ? 'Część I – praca z mapą' : 'Część B – praca z mapą'; rows.forEach(r => r.g = g); return { items: stage === 'ctr1' ? [...rows, ...items] : [...items, ...rows], yr }; }
  return { items, yr };
}
function mapRowsB(n) {
  if (!n || !D.mapa) return [];
  const st = D.mapa.states.filter(s => s.n !== 41 && s.n !== 8 && s.n <= 46);
  const seats = D.mapa.seats.map((x, i) => ({ ...x, i })).filter(x => x.n && x.n <= 46);
  const aut = CARDS.filter(c => c.k === 'op' && c.st === 'aut' && c.ty === 'mapa' && c.lvl !== 'ctr');
  const N = n, nA = Math.min(aut.length, Math.round(n * .35)); n -= nA;
  const nS = Math.round(n * .4);
  return [...pick(aut, nA).map(c => ({ id: c.id, pts: 1 })), ...pick(seats, nS).map(x => ({ id: 'M-X' + (x.i + 1), pts: 1 })), ...pick(st.filter(s => s.nato || s.ue), Math.ceil((n - nS) * .7)).map(s => ({ id: 'M-S' + s.n, pts: 1 })), ...pick(st, n - nS - Math.ceil((n - nS) * .7)).map(s => ({ id: 'M-N' + s.n, pts: 1 }))].slice(0, N);
}
function poolBy(fn) { return CARDS.filter(fn); }
function startTest(p) {
  if (p.kind === 'okrsim') p = { ...PRESETS.find(x => x.kind === 'okr1'), title: 'Symulacja okręgowego – cz. I', sim: 's' + Date.now().toString(36), part: 1 };
  let items = [];
  const mcF = (st, extra) => poolBy(c => c.k === 'mc' && st.includes(c.pool) && (!extra || extra(c)));
  const take = (arr, n) => pick(arr, n).map(c => ({ id: c.id, pts: 1 }));
  const SK = { szk: ['mc', 'szk', ['2023/24', '2024/25', '2025/26']], okr1: ['mc', 'okr1', ['2021/22', '2022/23', '2023/24', '2024/25', '2025/26']], okr2: ['op', 'okr2', ['2023', '2024', '2025']], ctr1: ['op', 'ctr1', ['2024', '2025']] }[p.kind];
  if (SK) { const r = SK[0] === 'mc' ? mcSkeleton(SK[1], SK[2]) : openSkeleton(SK[1], SK[2]); items = r.items; p.title = `${p.title} · układ arkusza ${String(r.yr).length === 4 ? r.yr + '/' + String(+r.yr + 1).slice(2) : r.yr}`; }
  else if (p.kind === 'ctr2') items = take(poolBy(c => c.pool === 'kpp' || (c.pool === 'aut' && c.t === 'KPP')), 40);
  else if (p.kind === 'aut') { const m = take(mcF(['aut'], c => c.t !== 'KPP' && (c.lvl !== 'ctr')), 24), o = buildOpenTest(16, ['aut'], 0); items = [...shuffle(m), ...o]; }
  else if (p.kind === 'custom') {
    let pool = p.pool === 'mcop' ? poolBy(c => (c.k === 'mc' || c.k === 'op') && lvlRank[c.lvl] <= (nextExam(now()) === examDates().okr ? 1 : 2) && c.t !== 'KPP') : p.pool === 'mc' ? mcF(['szk', 'okr1', 'new', 'aut']) : p.pool === 'op' ? poolBy(c => c.k === 'op' && (c.pool === 'okr2' || (c.pool === 'aut' && c.lvl !== 'ctr' && c.t !== 'KPP'))) : p.pool === 'qz' ? poolBy(c => c.k === 'qz') : p.pool === 'kpp' ? poolBy(c => c.pool === 'kpp') : poolBy(c => lvlRank[c.lvl] <= 1);
    if (!p.pool) pool = poolBy(c => lvlRank[c.lvl] <= 2);
    if (p.topics) pool = pool.filter(c => p.topics.includes(c.t));
    if (p.bad) { const wr = new Set(); for (const t of S.tests) for (const r of t.res || []) if (r.pts < 1) wr.add(r.id); pool = pool.filter(c => (S.cards[c.id] && S.cards[c.id].w) || wr.has(c.id)); }
    items = take(pool, p.n || 20);
  }
  if (!items.length) { toast('Brak pytań dla tych ustawień'); return; }
  stopRun();
  RUN = { id: 't' + Date.now().toString(36), kind: p.kind, title: p.title, base: p.base || p.title, sim: p.sim, part: p.part, mins: p.mins || 0, start: now(), items, ans: {}, typed: {} };
  go('#test');
}
function buildOpenTest(target, stages, mapPts, allowCtr) {
  const pool = CARDS.filter(c => c.k === 'op' && (stages.includes(c.pool) || (allowCtr && c.pool === 'ctr')) && c.ty !== 'wyp' && c.ty !== 'mapa' && (c.pool !== 'aut' || (c.t !== 'KPP' && (allowCtr || c.lvl !== 'ctr'))));
  const out = []; let sum = 0; const usedTask = {};
  for (const c of shuffle(pool)) { if (sum >= target) break; const k = c.sid + c.no; if ((usedTask[k] || 0) >= 2) continue; usedTask[k] = (usedTask[k] || 0) + 1; out.push({ id: c.id, pts: 1 }); sum++; }
  return [...out.sort(() => Math.random() - .5), ...mapRows(mapPts)];
}
function mapRows(n) {
  if (!n || !D.mapa) return [];
  const st = D.mapa.states.filter(s => s.n !== 41 && s.n !== 8 && s.n <= 46);
  const rows = [];
  for (const s of pick(st, n)) {
    const r = Math.random();
    if (r < .34) rows.push({ id: 'M-N' + s.n, pts: 1 }); else if (r < .7) rows.push({ id: 'M-S' + s.n, pts: 1 });
    else { const seats = D.mapa.seats.map((x, i) => ({ ...x, i })).filter(x => x.n === s.n); rows.push(seats.length ? { id: 'M-X' + (pick(seats, 1)[0].i + 1), pts: 1 } : { id: 'M-S' + s.n, pts: 1 }); }
  }
  return rows;
}
function vTest(app) {
  if (!RUN) { go('#testy'); return; }
  const R = RUN;
  const hasMap = R.items.some(it => (CI[it.id] || {}).mapimg || (CI[it.id] || {}).ty === 'mapa' || String(it.id).startsWith('M-'));
  app.innerHTML = `<div class="sticky noprint"><div class="row between"><span><b>${esc(R.title)}</b> <span class="muted small">· ${R.items.length} ${plural(R.items.length, 'pytanie', 'pytania', 'pytań')}</span></span><span class="row"><span class="timer" id="tm"></span><button class="btn pri sm" id="fin">Zakończ i sprawdź</button></span></div></div>
  ${hasMap && D.mapa ? `<div class="card">${mapDetHTML('Mapa Europy do zadań z częścią B')}</div>` : ''}
  <div id="qs">${R.items.map((it, n) => grpHead(R.items, n) + qHTML(CI[it.id], n, R)).join('')}</div>
  <div class="row" style="margin:20px 0"><button class="btn pri big" id="fin2">Zakończ i sprawdź</button><button class="btn" id="ab">Przerwij</button></div>`;
  $$('#qs .opt').forEach(b => b.onclick = () => { const id = b.dataset.id, L = b.dataset.l; const s = new Set(R.ans[id] || []); s.has(L) ? s.delete(L) : s.add(L); R.ans[id] = [...s]; b.classList.toggle('sel'); });
  $$('#qs input[data-id]').forEach(i => i.oninput = () => { R.typed[i.dataset.id] = i.value; });
  $('#fin').onclick = $('#fin2').onclick = () => finishTest();
  $('#ab').onclick = () => ask('Przerwać test? Odpowiedzi zostaną utracone.', 'Przerwij', () => { stopRun(); go('#testy'); });
  if (R.mins) { const tick = () => { const left = R.start + R.mins * 60000 - now(); const el = $('#tm'); if (!el) return; if (left <= 0) { el.textContent = '0:00'; clearInterval(R.timer); toast('Koniec czasu'); finishTest(); return; } const m = Math.floor(left / 60000), s = Math.floor(left % 60000 / 1000); el.textContent = `${m}:${String(s).padStart(2, '0')}`; el.classList.toggle('low', left < 300000); }; clearInterval(R.timer); R.timer = setInterval(tick, 1000); tick(); }
  else { const el = $('#tm'); el.textContent = 'bez limitu'; el.style.fontSize = '14px'; }
}
function qHTML(c, n, R) {
  if (!c) return '';
  const grp = R.items[n] && R.items[n].g;
  const head = `<div class="h"><span>${n + 1}.${grp ? '' : ' ' + esc(tname(c.t))}</span><span>1 pkt</span></div>`;
  if (c.k === 'mc') return `<div class="tq">${head}<div class="fq" style="font-size:18px">${c.q}</div>${c.img ? `<div class="qimg">${c.img}</div>` : ''}${c.o.map((o, i) => `<button class="opt ${(R.ans[c.id] || []).includes(LET[i]) ? 'sel' : ''}" data-id="${c.id}" data-l="${LET[i]}"><span class="l">${LET[i]}</span><span>${o}</span></button>`).join('')}</div>`;
  return `<div class="tq">${head}<div class="fq" style="font-size:18px">${c.q}</div>${c.img ? `<div class="qimg">${c.img}</div>` : ''}<input type="text" data-id="${c.id}" value="${esc(R.typed[c.id] || '')}" placeholder="Odpowiedź" autocomplete="off">${c.k === 'op' && !grp ? `<div class="src">${esc(c.src)}</div>` : ''}</div>`;
}
function finishTest() {
  const R = RUN; if (!R) return; clearInterval(R.timer);
  const res = R.items.map(it => {
    const c = CI[it.id]; if (!c) return null;
    if (c.k === 'mc') { const a = (R.ans[c.id] || []).slice().sort().join(''); const ok = mcOk(c, a); return { id: c.id, k: 'mc', user: a, pts: ok ? 1 : 0, alt: ok === 2 ? 1 : 0, auto: 1, g: it.g }; }
    const u = (R.typed[c.id] || '').trim(); const m = scoreOpen(c.id, u, c.a);
    return { id: c.id, k: c.k, user: u, sim: m, pts: m >= .8 ? 1 : 0, acc: isAcc(c.id, u) ? 1 : 0, g: it.g };
  }).filter(Boolean);
  const t = { id: R.id, kind: R.kind, title: R.title, sim: R.sim, part: R.part, date: now(), dur: Math.round((now() - R.start) / 1000), max: res.length, res, score: res.reduce((a, r) => a + r.pts, 0), saved: false };
  S.tests.push(t); persist(); RUN = null; go('#wynik-' + t.id);
}
function vWynik(app, id) {
  const t = S.tests.find(x => x.id === id); if (!t) { go('#testy'); return; }
  const recalc = () => { t.score = t.res.reduce((a, r) => a + r.pts, 0); };
  const thr = { szk: [20, 'awans do okręgowego (min. 20 pkt)'], okr1: [16, 'próg wejścia do cz. II: 16 pkt (w praktyce trzeba znacznie więcej – przechodzi 12 najlepszych w okręgu)'], okr2: [20, 'połowa punktów cz. II (awans wymaga min. 40/80 łącznie)'], ctr1: [20, 'tytuł finalisty: min. 40% (20/50)'], ctr2: [20, 'połowa punktów cz. II'] }[t.kind];
  const byT = {}; for (const r of t.res) { const c = CI[r.id]; if (!c) continue; const a = byT[c.t] || (byT[c.t] = { n: 0, p: 0 }); a.n++; a.p += r.pts; }
  const open = t.res.filter(r => r.k !== 'mc');
  app.innerHTML = `<div class="eyebrow">Wynik testu · ${fmtDate(t.date)} · ${Math.floor(t.dur / 60)} min ${t.dur % 60} s</div><h1>${esc(t.title)}</h1>
  <div class="grid g3 restop"><div class="card"><div class="pts" id="sc">${fmtPts(t.score)} <span class="small muted">/ ${t.max} pkt</span></div><div class="bar" style="margin-top:10px"><i id="scb" style="width:${pct(t.score, t.max)}%"></i></div>${thr ? `<p class="small" style="margin:10px 0 0">${t.score * (t.kind === 'okr2' || t.kind === 'ctr2' ? 40 / t.max : t.kind === 'ctr1' ? 50 / t.max : 1) >= thr[0] ? '✓' : '✗'} ${thr[1]}</p>` : ''}</div>
  <div class="card" style="grid-column:span 2"><h3>Tematy</h3>${bars(Object.entries(byT).sort((a, b) => a[1].p / a[1].n - b[1].p / b[1].n).map(([k, v]) => [tname(k), pct(v.p, v.n)]), 100, 'c4', '%')}</div></div>
  ${simHTML(t)}
  ${open.length ? `<div class="callout"><b>Pytania otwarte sprawdziła aplikacja – po podobieństwie do klucza.</b> To tylko propozycja: jeśli uznajesz swoją odpowiedź za poprawną, kliknij <b>„✓ Uznaję”</b> – wynik przeliczy się od razu, a ta odpowiedź będzie odtąd zaliczana automatycznie (w testach i fiszkach). Jak na olimpiadzie: 1 albo 0 pkt, bez połówek. <div class="row" style="margin-top:8px"><button class="btn sm" id="accAll">Uznaj wszystkie wpisane jako poprawne</button><button class="btn sm" id="claude" hidden>Oceń otwarte z Claude</button></div></div>` : ''}
  <div class="row noprint resact"><button class="btn pri" id="toSrs">Błędne pytania do powtórek</button><a class="btn" href="#testy">Nowy test</a><span class="small muted">${t.res.filter(r => r.pts >= 1).length} dobrze · ${t.res.filter(r => r.pts < 1).length} źle</span></div>
  <h2 class="revh">Przegląd odpowiedzi</h2>
  <div id="rev">${t.res.map((r, i) => grpHead(t.res, i, true) + revHTML(r, i)).join('')}</div>`;
  const setPts = (i, g) => { const r = t.res[i]; r.pts = g; r.manual = 1; if (r.user) setAcc(r.id, r.user, g >= 1); r.acc = g >= 1 && r.user ? 1 : 0; recalc(); persist(); touch('meta'); $('#sc').innerHTML = `${fmtPts(t.score)} <span class="small muted">/ ${t.max} pkt</span>`; $('#scb').style.width = pct(t.score, t.max) + '%'; $$(`#rev [data-i="${i}"]`).forEach(x => x.classList.toggle('on', +x.dataset.g === r.pts)); const v = $('#vd' + i); if (v) { v.className = 'verdict ' + (r.pts >= 1 ? 'ok' : r.pts > 0 ? 'mid' : 'bad'); v.textContent = r.pts >= 1 ? '1 pkt' : r.pts > 0 ? '½ pkt' : '0 pkt'; } const n = $('#an' + i); if (n) n.textContent = r.acc ? 'Uznana – ta odpowiedź będzie odtąd zaliczana automatycznie.' : ''; };
  $$('#rev [data-g]').forEach(b => b.onclick = () => setPts(+b.dataset.i, +b.dataset.g));
  const s2 = $('#sim2'); if (s2) s2.onclick = () => startTest({ ...PRESETS.find(x => x.kind === 'okr2'), title: 'Symulacja okręgowego – cz. II', sim: t.sim, part: 2 });
  const aa = $('#accAll'); if (aa) aa.onclick = () => { let n = 0; t.res.forEach((r, i) => { if (r.k !== 'mc' && r.user && r.pts < 1) { setPts(i, 1); n++; } }); toast(n ? `Uznano ${n} ${plural(n, 'odpowiedź', 'odpowiedzi', 'odpowiedzi')}` : 'Nie ma nic do uznania'); };
  $('#toSrs').onclick = () => { let n = 0; for (const r of t.res) if (r.pts < 1) { S.cards[r.id] = schedule(S.cards[r.id], 'bad', now()); touch('c' + shard(r.id)); n++; } persist(); toast(n ? `${n} ${plural(n, 'pytanie trafiło', 'pytania trafiły', 'pytań trafiło')} do powtórek` : 'Bez błędów!'); };
  if (!t.saved) { t.saved = true; save(); }
  claudeGrade(t);
}
function optRev(c, j, chosen, tag = 'button') {
  const L = LET[j], ok = c.ans.includes(L);
  const cls = chosen === null ? (ok ? 'right' : '') : ok ? (chosen ? 'right' : 'miss') : (chosen ? 'wrong' : 'dim');
  const mark = chosen === null ? (ok ? '✔' : L) : ok ? '✔' : chosen ? '✘' : L;
  const tagTxt = chosen === null ? '' : ok && !chosen ? '<em class="otag">pominięta</em>' : !ok && chosen ? '<em class="otag">błędnie zaznaczona</em>' : ok ? '<em class="otag">zaznaczona</em>' : '';
  return `<${tag} class="opt ${cls}" ${tag === 'button' ? 'disabled' : 'style="cursor:default"'}><span class="l">${mark}</span><span class="ot">${c.o[j]}</span>${tagTxt}</${tag}>`;
}
function simPairs() {
  const m = {}; for (const t of S.tests) if (t.sim) (m[t.sim] = m[t.sim] || {})[t.part] = t;
  return Object.values(m).filter(x => x[1] && x[2]).map(x => { const a = x[1].score, b = x[2].score * 40 / Math.max(1, x[2].max); return { a, b, sum: Math.round((a + b) * 2) / 2, t1: x[1], t2: x[2] }; });
}
function simHTML(t) {
  if (!t.sim) return '';
  const p1 = S.tests.find(x => x.sim === t.sim && x.part === 1), p2 = S.tests.find(x => x.sim === t.sim && x.part === 2);
  if (t.part === 1 && !p2) {
    const ok = t.score >= 16;
    return `<div class="callout simbox"><b>Symulacja okręgowego – koniec cz. I: ${fmtPts(t.score)} / 40 pkt.</b> ${ok ? 'Przekraczasz formalny próg 16 pkt. Na etapie do cz. II przechodzi 12 najlepszych w okręgu, więc im więcej, tym pewniej.' : 'Poniżej formalnego progu 16 pkt – na etapie nie przeszedłbyś do cz. II. Możesz ją zrobić treningowo.'} Najpierw przejrzyj błędy poniżej (na etapie między częściami jest przerwa), potem rozwiąż cz. II – 40 minut.<div class="row" style="margin-top:10px"><button class="btn pri" id="sim2">Zacznij cz. II (40 min)</button></div></div>`;
  }
  if (p1 && p2) {
    const a = p1.score, b = Math.round(p2.score * 40 / Math.max(1, p2.max) * 2) / 2, sum = a + b;
    return `<div class="card simbox"><h3>Pełna symulacja okręgowego</h3><div class="grid g3"><div><div class="small muted">cz. I</div><div class="pts">${fmtPts(a)}<span class="small muted"> / 40</span></div></div><div><div class="small muted">cz. II</div><div class="pts">${fmtPts(b)}<span class="small muted"> / 40</span></div></div><div><div class="small muted">razem</div><div class="pts">${fmtPts(sum)}<span class="small muted"> / 80</span></div></div></div>
    <div class="bar" style="margin-top:10px"><i style="width:${pct(sum, 80)}%"></i></div>
    <p class="small" style="margin:10px 0 0">${a >= 16 ? '✓' : '✗'} cz. I: próg wejścia do cz. II – 16 pkt · ${sum >= 40 ? '✓' : '✗'} warunek punktowy awansu na centralny – min. 40 / 80 (o awansie decyduje też limit miejsc w okręgu, więc liczy się każdy punkt ponad próg).</p>
    <p class="small muted" style="margin:6px 0 0">${t.part === 1 ? `<a href="#wynik-${p2.id}">Wynik cz. II →</a>` : `<a href="#wynik-${p1.id}">← Wynik cz. I</a>`}</p></div>`;
  }
  return '';
}
function grpHead(arr, i, res) {
  const g = arr[i].g; if (!g || (i > 0 && arr[i - 1].g === g)) return '';
  const grp = arr.filter(x => x.g === g); const got = res ? grp.reduce((a, r) => a + r.pts, 0) : null;
  const c = CI[arr[i].id] || {}; const from = c.k === 'op' && c.src ? c.src.split(' · ')[0] : String(arr[i].id).startsWith('M-') ? 'mapa olimpijska (numeracja organizatora)' : '';
  return `<div class="tgrp"><span><b>${esc(g)}</b>${from ? `<br><span class="small muted" style="font-family:var(--sans);font-weight:400">źródło: ${esc(from)}</span>` : ''}</span><span class="mono small">${res ? fmtPts(got) + ' / ' : ''}${grp.length} pkt</span></div>`;
}
function revHTML(r, i) {
  const c = CI[r.id]; if (!c) return '';
  let body = `<div class="fq" style="font-size:17px">${c.q}</div>${c.img ? `<div class="qimg">${c.img}</div>` : ''}${c.mapimg ? mapDetHTML('Pokaż mapę') : ''}`;
  if (c.k === 'mc') body += c.o.map((o, j) => optRev(c, j, (r.user || '').includes(LET[j]), 'div')).join('') + `<div class="mcsum">Twoja odpowiedź: <b>${r.user ? r.user.split('').join(', ') : 'brak'}</b> · klucz: <b>${c.ans.split('').join(', ')}</b>${r.alt ? ' · <span class="ok-t">zaliczona jako wariant klucza</span>' : ''}</div>${altNote(c)}`;
  else body += `<div class="small">Twoja odpowiedź: <b>${r.user ? esc(r.user) : '<span class="muted">brak</span>'}</b></div><div class="ans">Klucz: ${esc(c.a)}</div>${r.user ? `<div class="seg accseg">${[[1, '✓ Uznaję – 1 pkt'], [0, '✗ 0 pkt']].map(([g, l]) => `<button data-i="${i}" data-g="${g}" class="${r.pts === g ? 'on' : ''}">${l}</button>`).join('')}</div><div class="small ok-t" id="an${i}">${r.acc ? 'Uznana – ta odpowiedź będzie odtąd zaliczana automatycznie.' : ''}</div>` : ''}<div class="small" id="cl${i}"></div>`;
  if (c.e) body += `<div class="ex">${c.k === 'mc' ? c.e : esc(c.e)}</div>`;
  if (c.u) body += `<div class="note"><b>Uwaga:</b> ${c.k === 'mc' ? c.u : esc(c.u)}</div>`;
  return `<div class="tq"><div class="h"><span>${i + 1}. ${esc(tname(c.t))}</span><span id="vd${i}" class="verdict ${r.pts >= 1 ? 'ok' : r.pts > 0 ? 'mid' : 'bad'}">${r.pts >= 1 ? '1 pkt' : r.pts > 0 ? '½ pkt' : '0 pkt'}</span></div>${body}<div class="src">${esc(c.src || '')}</div></div>`;
}
async function claudeGrade(t) {
  const btn = $('#claude'); if (!btn || !window.claude || typeof window.claude.use !== 'function') return;
  let sample = null; try { sample = await window.claude.use('sample'); } catch (e) {}
  if (!sample) return; btn.hidden = false;
  btn.onclick = async () => {
    const open = t.res.map((r, i) => ({ r, i })).filter(x => x.r.k !== 'mc' && x.r.user);
    if (!open.length) { toast('Brak wpisanych odpowiedzi do oceny'); return; }
    btn.disabled = true; btn.textContent = 'Claude ocenia…';
    const list = open.map(({ r, i }) => { const c = CI[r.id]; return { nr: i + 1, pytanie: c.q.replace(/<[^>]+>/g, ''), klucz: c.a, wyjasnienie: c.e || '', odpowiedz_ucznia: r.user }; });
    const prompt = `Jesteś egzaminatorem Olimpiady Wiedzy o Prawach Człowieka. Oceń odpowiedzi ucznia według klucza organizatora: literówki w nazwiskach i nazwach to błąd, kolejność słów i wielkość liter nie mają znaczenia, nawiasy kwadratowe w kluczu oznaczają warianty dopuszczalne lub elementy nieobowiązkowe. Za odpowiedź zgodną z kluczem daj 1, za każdą inną (także niepełną) 0 – na olimpiadzie nie ma połówek. Zwróć wyłącznie JSON: [{"nr":numer,"pkt":0|1,"uwaga":"krótko po polsku, max 20 słów"}].\n\n${JSON.stringify(list)}`;
    try {
      const out = await sample(prompt, { modelTier: 'quick' });
      const m = (out.text || '').match(/\[[\s\S]*\]/); const arr = m ? JSON.parse(m[0]) : [];
      for (const v of arr) { const i = v.nr - 1; if (!t.res[i]) continue; t.res[i].pts = +v.pkt >= 1 ? 1 : 0; const el = $('#cl' + i); if (el) el.innerHTML = `<b>Claude:</b> ${esc(v.uwaga || '')}`; $$(`#rev [data-i="${i}"]`).forEach(x => x.classList.toggle('on', +x.dataset.g === t.res[i].pts)); }
      t.score = t.res.reduce((a, r) => a + r.pts, 0); persist(); touch('meta');
      $('#sc').innerHTML = `${fmtPts(t.score)} <span class="small muted">/ ${t.max} pkt</span>`; $('#scb').style.width = pct(t.score, t.max) + '%';
      btn.textContent = 'Ocenione przez Claude';
    } catch (e) { btn.disabled = false; btn.textContent = 'Oceń otwarte z Claude'; toast(e && e.code === 'rate_limited' ? 'Za dużo zapytań – spróbuj za chwilę' : 'Ocena niedostępna'); }
  };
}

/* ---------- QUIZ FINAŁOWY ---------- */
function vQuiz(app) {
  if (!QZ) {
    const byCat = {}; for (const c of CARDS.filter(c => c.k === 'qz')) { const k = c.t; (byCat[k] || (byCat[k] = [])).push(c); }
    const cats = pick(Object.keys(byCat), 10); const items = cats.map(k => pick(byCat[k], 1)[0]);
    while (items.length < 10) items.push(pick(CARDS.filter(c => c.k === 'qz'), 1)[0]);
    QZ = { items, i: 0, score: 0, phase: 'ready', res: [] };
  }
  const q = QZ;
  if (q.i >= q.items.length) {
    const t = { id: 'q' + Date.now().toString(36), kind: 'quiz', title: 'Quiz finałowy', date: now(), dur: 0, max: 10, res: q.res, score: q.score, saved: true };
    S.tests.push(t); for (const r of q.res) if (!r.pts) S.cards[r.id] = schedule(S.cards[r.id], 'bad', now()); save();
    app.innerHTML = `<div class="sess"><div class="eyebrow">Quiz finałowy</div><h1>${q.score} / 10 pkt</h1><p class="lead">${q.score >= 8 ? 'Poziom podium.' : q.score >= 6 ? 'Dobrze – w finale liczy się każdy punkt, bo quiz rozstrzyga remisy.' : 'Trenuj szybkie odpowiedzi: 15 sekund to mało na zastanawianie się.'}</p><div class="card">${q.res.map(r => { const c = CI[r.id]; return `<div class="tq"><div class="h"><span>${esc(c.cat)}</span><span class="verdict ${r.pts ? 'ok' : 'bad'}">${r.pts} pkt</span></div><div>${esc(c.q)}</div><div class="ans">${esc(c.a)}</div></div>`; }).join('')}</div><div class="row"><button class="btn pri" id="again">Jeszcze raz</button><a class="btn" href="#testy">Testy</a></div></div>`;
    $('#again').onclick = () => { QZ = null; vQuiz(app); }; return;
  }
  const c = q.items[q.i];
  app.innerHTML = `<div class="sess"><div class="sbar"><span class="mono small">Pytanie ${q.i + 1}/10</span><span class="sp"></span><span class="mono">${q.score} pkt</span></div>
   <div class="card"><div class="eyebrow">Kategoria: ${esc(c.cat)}</div>
   ${q.phase === 'ready' ? `<p class="lead">Moderator czyta pytanie – masz 15 sekund, żeby zacząć odpowiadać. Odpowiedz na głos albo wpisz pierwsze słowa.</p><button class="btn pri big" id="st">Pokaż pytanie</button>` :
    `<div class="qz-q">${esc(c.q)}</div>${q.phase === 'run' ? `<div class="qz-time"><i id="qt" style="width:100%"></i></div><input type="text" id="qa" placeholder="Twoja odpowiedź" autocomplete="off" style="margin-top:12px"><div class="row" style="margin-top:10px"><button class="btn pri" id="sh">Pokaż odpowiedź</button></div>` :
    `<div class="small">Twoja odpowiedź: <b>${esc(q.typed || '—')}</b></div><div class="ans">${esc(c.a)}</div><p class="small muted">${esc(c.src)}</p><div class="grade" style="grid-template-columns:1fr 1fr"><button class="g1" data-p="0">0 pkt</button><button class="g3" data-p="1">1 pkt</button></div>`}`}
   </div></div>`;
  const st = $('#st'); if (st) st.onclick = () => { q.phase = 'run'; q.typed = ''; q.t0 = now(); vQuiz(app); };
  if (q.phase === 'run') {
    const inp = $('#qa'); inp.focus(); inp.oninput = () => q.typed = inp.value; inp.onkeydown = e => { if (e.key === 'Enter') reveal(); };
    $('#sh').onclick = reveal;
    clearInterval(q.timer); q.timer = setInterval(() => { const left = 15000 - (now() - q.t0); const el = $('#qt'); if (el) el.style.width = Math.max(0, left / 150) + '%'; if (left <= 0) reveal(); }, 100);
  }
  $$('[data-p]').forEach(b => b.onclick = () => { const p = +b.dataset.p; q.score += p; q.res.push({ id: c.id, k: 'qz', user: q.typed, pts: p }); q.i++; q.phase = 'ready'; vQuiz(app); });
  function reveal() { clearInterval(q.timer); q.phase = 'show'; vQuiz(app); }
}

/* ---------- ARKUSZE ---------- */
function vArkusze(app) {
  const parts = [['okr2', 'Okręgowy – część II'], ['ctr1', 'Centralny – część I'], ['ctr2', 'Centralny – część II']];
  app.innerHTML = `<div class="eyebrow">Oryginały z coptiosh.eu</div><h1>Arkusze archiwalne</h1>
  <p class="lead">Wszystkie ${D.sheets.length} arkusze z zadaniami otwartymi (okręgowy cz. II, centralny cz. I i II) z lat 2013/14–2025/26 – ${GH ? 'z linkami do testu i klucza na stronie organizatora' : 'strony testu i klucza'}. Rozwiąż na kartce z zegarem, potem sprawdź kluczem i zapisz wynik. Testy wyboru (szkolne i okręgowe cz. I) są w całości w fiszkach i generatorze.</p>
  ${parts.map(([p, n]) => `<h2>${n}</h2><div class="grid g4">${D.sheets.filter(s => s.part === p).slice().reverse().map(s => `<a class="tile" href="#arkusz-${s.id.replace('_', '-')}"><b>${s.ed} edycja · ${s.yr}</b><span>${s.zm ? esc(s.zm) + '<br>' : ''}${s.T.length} str. testu${s.n ? ` · ${s.n} fiszek` : ''}${S.sheets[s.id] ? `<br><b class="chip ok">${S.sheets[s.id].pts}/${s.pts} pkt</b>` : ''}</span></a>`).join('')}</div>`).join('')}`;
}
function vArkusz(app, a, b) {
  const id = b ? a + '_' + b : a; const s = D.sheets.find(x => x.id === id); if (!s) { go('#arkusze'); return; }
  const n = CARDS.filter(c => c.sid === s.id).length;
  app.innerHTML = `<div class="small"><a href="#arkusze">← Arkusze</a></div>
  <div class="eyebrow" style="margin-top:12px">${esc(s.name)}</div><h1>${s.ed} OWPC · ${s.yr}</h1>${s.zm ? `<p class="lead">Program zmienny: ${esc(s.zm)}</p>` : ''}
  <div class="card row between"><span class="row"><button class="btn pri" id="tm">Start: ${s.min} min</button><span class="timer" id="tmv"></span></span><span class="row"><label class="row small">Mój wynik: <input type="number" id="mp" min="0" max="${s.pts}" style="width:90px" value="${S.sheets[s.id] ? S.sheets[s.id].pts : ''}"> / ${s.pts}</label><button class="btn sm" id="sv">Zapisz</button>${n ? `<a class="btn sm" href="#sesja-s-${s.id.replace('_', '-')}">Fiszki z arkusza (${n})</a>` : ''}</span></div>
  ${GH ? `<div class="card"><p style="margin-top:0">Oryginalny arkusz i klucz są na stronie organizatora (COPTIOSH). Otwórz test, rozwiąż go z zegarem, potem sprawdź kluczem i wpisz wynik powyżej.</p><div class="row"><a class="btn pri" href="${s.uT}" target="_blank" rel="noopener">Otwórz test (${s.T.length} str.)</a>${s.uK ? `<a class="btn" href="${s.uK}" target="_blank" rel="noopener">Otwórz klucz</a>` : ''}</div><p class="small muted" style="margin-bottom:0">Pliki .docx otwierają się w Wordzie, Google Docs lub w podglądzie telefonu.</p></div>` : `<div class="seg"><button class="on" data-v="T">Test (${s.T.length} str.)</button><button data-v="K">Klucz (${s.K.length} str.)</button></div>
  <div class="pages" id="pg"></div>`}`;
  const show = v => { $('#pg').innerHTML = s[v].map((p, i) => `<img loading="lazy" src="media/ark/${p}" alt="${v === 'T' ? 'Test' : 'Klucz'} – strona ${i + 1}">`).join(''); $$('.seg [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === v)); };
  if (!GH) { $$('.seg [data-v]').forEach(b => b.onclick = () => show(b.dataset.v)); show('T'); }
  let tmr = null; $('#tm').onclick = () => { const end = now() + s.min * 60000; clearInterval(tmr); tmr = setInterval(() => { const l = end - now(); const el = $('#tmv'); if (!el) { clearInterval(tmr); return; } if (l <= 0) { el.textContent = 'koniec czasu'; clearInterval(tmr); return; } el.textContent = `${Math.floor(l / 60000)}:${String(Math.floor(l % 60000 / 1000)).padStart(2, '0')}`; }, 500); };
  $('#sv').onclick = () => { const v = +$('#mp').value; if (isNaN(v)) return; S.sheets[s.id] = { pts: v, date: now() }; save(); toast('Zapisano wynik'); };
}

/* ---------- MAPA ---------- */
/* ---------- MAPA (własna, SVG) i trening państw ---------- */
let MAPSVG = null, MAPP = null;
function mapSvg() { if (MAPSVG) return Promise.resolve(MAPSVG); if (!MAPP) MAPP = fetch(D.mapa.geo.svg).then(r => { if (!r.ok) throw 0; return r.text(); }).then(t => (MAPSVG = t)); return MAPP; }
const ORGS = [['nato', 'NATO'], ['ue', 'UE (Wspólnoty)'], ['re', 'Rada Europy'], ['eur', 'strefa euro'], ['sch', 'Schengen'], ['onz', 'ONZ']];
const MVIEWS = [['all', 'Cała'], ['west', 'Zachód'], ['north', 'Północ'], ['cent', 'Środek'], ['bal', 'Bałkany'], ['east', 'Wschód']];
const viewOf = n => { const g = D.mapa.geo.groups || {}; for (const k of ['bal', 'cent', 'west', 'north', 'east']) if ((g[k] || []).includes(+n)) return k; return 'all'; };
const stN = n => D.mapa.states.find(s => s.n === +n);
const nrm = s => fold(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) { const m = a.length, n = b.length; if (Math.abs(m - n) > 3) return 9; let p = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const q = [i]; for (let j = 1; j <= n; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = q; } return p[n]; }
function orgDisp(s, k) { const o = s.org && s.org[k]; if (!o) return '–'; const a = o.a[0]; if (k === 'ue' && s.ue === 1952) return '1952 (EWWiS) / 1958 (EWG)'; if (a === 'nie') return k === 'ue' && s.cand ? 'nie (kandydat)' : 'nie'; return a; }
function seatsOf(n) { const g = {}; for (const x of D.mapa.seats.filter(x => x.n === +n)) (g[x.city] = g[x.city] || []).push(x.org.split(' – ')[0]); return Object.entries(g).map(([c, o]) => `${c} – ${o.join(', ')}`); }
async function mountMap(el, o = {}) {
  el.innerHTML = '<div class="mapwrap"><p class="small muted" style="padding:20px">Ładowanie mapy…</p></div>';
  let t; try { t = await mapSvg(); } catch (e) { el.innerHTML = `<img src="${D.mapa.img}" alt="Mapa Europy z numerami państw" style="width:100%;border-radius:8px">`; return null; }
  el.innerHTML = `${o.views === false ? '' : `<div class="seg mviews">${MVIEWS.map(([k, n]) => `<button data-v="${k}" class="${k === 'all' ? 'on' : ''}">${n}</button>`).join('')}</div>`}<div class="mapwrap">${t}</div>`;
  const svg = $('svg', el); const m = { svg, el };
  // Safari źle skaluje <text> przez transform-box – etykiety centrujemy w kółku i skalujemy rozmiarem czcionki
  $$('.lb', svg).forEach(g => { const c = g.querySelector('circle:not(.pt)'), tx = g.querySelector('text'); if (c && tx) { tx.setAttribute('y', c.getAttribute('cy')); tx.setAttribute('dominant-baseline', 'central'); } });
  const fit = () => { const w = svg.getBoundingClientRect().width; if (!w) return; const upp = svg.viewBox.baseVal.width / w; const k = Math.max(.42, Math.min(1.5, 10.5 * upp / 10.5)); svg.style.setProperty('--ls', k.toFixed(3)); svg.style.setProperty('--ls2', Math.min(k, 1.2).toFixed(3)); };
  m.setView = v => { const b = D.mapa.geo.views[v] || D.mapa.geo.views.all; svg.setAttribute('viewBox', b.join(' ')); $$('.mviews button', el).forEach(x => x.classList.toggle('on', x.dataset.v === v)); fit(); };
  fit(); if (window.ResizeObserver) new ResizeObserver(fit).observe(svg);
  m.mark = (n, cls) => { $$('.' + cls, svg).forEach(p => p.classList.remove(cls)); if (n != null) $$(`[data-n="${n}"]`, svg).forEach(p => p.classList.add(cls)); };
  m.layer = k => { $$('.st', svg).forEach(p => { const s = stN(p.dataset.n); const a = k && s && s.org && s.org[k] ? s.org[k].a[0] : 'nie'; p.classList.toggle('in', !!k && a !== 'nie'); p.classList.toggle('cand', k === 'ue' && !!s && s.cand && a === 'nie'); }); };
  m.labels = on => svg.classList.toggle('nolab', !on);
  m.cities = on => svg.classList.toggle('showct', !!on);
  $$('.mviews button', el).forEach(b => b.onclick = () => m.setView(b.dataset.v));
  if (o.onPick) { svg.classList.add('clk'); svg.addEventListener('click', e => { const p = e.target.closest('[data-n]'); if (p) o.onPick(+p.dataset.n, e); }); }
  return m;
}
document.addEventListener('toggle', e => { const d = e.target; if (!d.classList || !d.classList.contains('mapdet') || !d.open || d.dataset.on) return; d.dataset.on = 1; mountMap($('.mapslot', d)); }, true);
const mapDetHTML = (label, cls = '') => `<details class="mapdet ${cls}"><summary class="small">${label}</summary><div class="mapslot"></div><p class="small muted" style="margin:6px 0 0">Własna mapa w numeracji organizatora (2025/26). <a href="${D.mapa.img}" target="_blank" rel="noopener">Oryginał z testu</a></p></details>`;

function vMapa(app) {
  const M = D.mapa; if (!M) { app.innerHTML = '<div class="empty">Brak mapy.</div>'; return; }
  const tab = S.settings.mtab || 'trening';
  app.innerHTML = `<div class="eyebrow">Część B – zadanie ze źródłem</div><h1>Mapa Europy</h1>
  <p class="lead">Mapa narysowana od nowa w numeracji organizatora (test 2025/26) – wszystkie ${M.states.length} państw: numery 1–46 jak u organizatora (nr 8 to Kazachstan), a państwa-miniatury bez numeru na mapie organizatora dostały numery 47–51. W trybie <b>Trening</b> wpisujesz nazwę, stolicę i lata wejścia do NATO, UE, Rady Europy, strefy euro, Schengen czy ONZ – aplikacja sprawdza każde pole, a odpowiedź, którą uznasz za dobrą, zalicza się już zawsze.</p>
  <div class="seg" id="mtab"><button data-t="trening" class="${tab === 'trening' ? 'on' : ''}">Trening</button><button data-t="mapa" class="${tab === 'mapa' ? 'on' : ''}">Przeglądaj mapę</button><button data-t="tab" class="${tab === 'tab' ? 'on' : ''}">Tabela państw</button></div>
  <div id="mbody"></div>`;
  $$('#mtab button').forEach(b => b.onclick = () => { S.settings.mtab = b.dataset.t; persist(); vMapa(app); });
  const body = $('#mbody');
  if (tab === 'tab') { body.innerHTML = mapTable(); return; }
  body.innerHTML = `<div class="mgrid"><div class="card mcard"><div id="mapw"></div>${tab === 'mapa' ? `<div class="row small" style="margin-top:8px;gap:14px"><label class="ck"><input type="checkbox" id="mlab" checked> numery</label><label class="ck"><input type="checkbox" id="mct"> siedziby instytucji</label><a class="small" href="${M.img}" target="_blank" rel="noopener">mapa organizatora (oryginał)</a></div>` : ''}</div><div class="card mside" id="mside"></div></div>`;
  if (tab === 'mapa') mapBrowse(); else mapTrain();
}
function mapTable() {
  const M = D.mapa;
  return `<div class="card tw"><table><thead><tr><th>Nr</th><th>Państwo</th><th>Stolica</th>${ORGS.map(([, n]) => `<th>${n}</th>`).join('')}</tr></thead><tbody>${M.states.map(s => `<tr><td class="mono">${s.n}</td><td><b>${esc(s.name)}</b>${s.note ? `<div class="small muted">${esc(s.note)}</div>` : ''}</td><td>${esc(s.cap)}</td>${ORGS.map(([k]) => `<td class="mono small">${esc(orgDisp(s, k))}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="small muted">${esc(M.uwaga)} Stan na XI 2026: Cypr poza Schengen, Bułgaria w strefie euro od 1 I 2026 r.</p></div>
  <h2>Siedziby instytucji</h2><div class="card tw"><table><thead><tr><th>Instytucja</th><th>Miasto</th><th>Nr</th></tr></thead><tbody>${M.seats.map(s => `<tr><td>${esc(s.org)}</td><td>${esc(s.city)}</td><td class="mono">${s.n}</td></tr>`).join('')}</tbody></table></div>`;
}
async function mapBrowse() {
  const side = $('#mside');
  side.innerHTML = `<h3>Warstwy</h3><div class="seg" id="mlay"><button data-k="" class="on">bez warstwy</button>${ORGS.map(([k, n]) => `<button data-k="${k}">${n}</button>`).join('')}</div><p class="small muted" id="mleg">Kliknij państwo, żeby zobaczyć szczegóły.</p><div id="minfo"></div>`;
  const show = n => { const s = stN(n); if (!s) return; m.mark(n, 'sel');
    $('#minfo').innerHTML = `<div class="minfo"><div class="row between"><b style="font-size:20px">${s.n} · ${esc(s.name)}</b></div><div>stolica: <b>${esc(s.cap)}</b></div><table class="mt"><tbody>${ORGS.map(([k, nm]) => `<tr><td>${nm}</td><td><b class="mono">${esc(orgDisp(s, k))}</b>${s.org[k].note ? `<div class="small muted">${esc(s.org[k].note)}</div>` : ''}</td></tr>`).join('')}</tbody></table>${s.note ? `<p class="small">${esc(s.note)}</p>` : ''}${seatsOf(n).length ? `<p class="small"><b>Siedziby:</b> ${seatsOf(n).map(esc).join('; ')}</p>` : ''}</div>`; };
  const m = await mountMap($('#mapw'), { onPick: show }); if (!m) return;
  $$('#mlay button').forEach(b => b.onclick = () => { $$('#mlay button').forEach(x => x.classList.toggle('on', x === b)); m.layer(b.dataset.k); const k = b.dataset.k; $('#mleg').innerHTML = k ? `<span class="lgd in"></span> członkowie (${D.mapa.states.filter(s => s.org[k].a[0] !== 'nie').length} z ${D.mapa.states.length} państw na mapie)${k === 'ue' ? ' · <span class="lgd cand"></span> kandydaci' : ''} · stan na XI 2026` : 'Kliknij państwo, żeby zobaczyć szczegóły.'; });
  $('#mlab').onchange = e => m.labels(e.target.checked); $('#mct').onchange = e => m.cities(e.target.checked);
}
const MFIELDS = [['nr', 'Numer'], ['name', 'Państwo'], ['cap', 'Stolica'], ...ORGS];
function mapCheck(s, f, u) {
  const key = `map:${s.n}:${f}`; const v = (u || '').trim();
  if (!v) return { ok: false, exp: mapExp(s, f) };
  if (S.acc[key] && S.acc[key].includes(nrm(v))) return { ok: true, acc: 1, exp: mapExp(s, f) };
  if (f === 'nr') return { ok: parseInt(v, 10) === s.n, exp: String(s.n) };
  if (f === 'name' || f === 'cap') { const L = (f === 'name' ? s.names : s.caps).map(nrm), x = nrm(v); if (L.includes(x)) return { ok: true, exp: mapExp(s, f) }; const d = Math.min(...L.map(y => lev(x, y))); return { ok: false, near: d <= 2 && x.length > 3, exp: mapExp(s, f) }; }
  const acc = s.org[f].a; const x = nrm(v); const yrs = v.match(/\b(1[89]\d\d|20\d\d)\b/g);
  let tok = yrs ? yrs[0] : /kandyd/.test(x) ? 'kandydat' : /^(nie|n|brak|x|0|nie nalezy|nie jest|nie nalezy do)/.test(x) || /^[-–—]+$/.test(v) ? 'nie' : x;
  return { ok: acc.includes(tok), exp: mapExp(s, f) };
}
function mapExp(s, f) { if (f === 'nr') return String(s.n); if (f === 'name') return s.name; if (f === 'cap') return s.cap; return orgDisp(s, f) + (s.org[f].note ? ' – ' + s.org[f].note : ''); }
async function mapTrain() {
  const side = $('#mside');
  const cfg = S.settings.mtr || (S.settings.mtr = { mode: 'num', fields: ['cap', 'nato', 'ue'] });
  const MS = S.mapst || (S.mapst = {});
  let cur = null, clicked = null, done = false;
  const m = await mountMap($('#mapw'), { onPick: n => { if (cfg.mode !== 'click' || done) return; clicked = n; m.mark(n, 'sel'); const el = $('#mclk'); if (el) el.innerHTML = `zaznaczono: nr ${n}`; } });
  if (!m) return;
  const nextState = () => { const L = D.mapa.states; const w = L.map(s => { const r = MS[s.n]; return r ? Math.max(.25, 1 + 2 * (r.bad || 0) - (r.ok || 0) + (now() - (r.t || 0) > DAY ? .5 : 0)) : 3; }); let x = Math.random() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < L.length; i++) { x -= w[i]; if (x <= 0) return L[i]; } return L[L.length - 1]; };
  const fieldsFor = () => [...(cfg.mode === 'num' ? ['name'] : cfg.mode === 'name' ? ['nr'] : []), ...cfg.fields];
  const mastered = () => D.mapa.states.filter(s => MS[s.n] && MS[s.n].last === 1).length;
  function render() {
    done = false; clicked = null; m.mark(null, 'sel'); m.mark(null, 'q'); m.mark(null, 'okm'); m.mark(null, 'badm');
    cur = nextState(); if (cfg.mode === 'num') { m.mark(cur.n, 'q'); }
    const small = m.svg.getBoundingClientRect().width < 620; m.setView(small && cfg.mode === 'num' ? viewOf(cur.n) : 'all');
    const prompt = cfg.mode === 'num' ? `Państwo nr <b>${cur.n}</b> <span class="small muted">(podświetlone na mapie)</span>` : cfg.mode === 'name' ? `<b>${esc(cur.name)}</b> <span class="small muted">– znajdź na mapie i podaj numer</span>` : `Wskaż na mapie: <b>${esc(cur.name)}</b> <span id="mclk" class="small muted">– kliknij państwo</span>`;
    side.innerHTML = `<div class="row between"><div class="seg" id="mmode">${[['num', 'numer → dane'], ['name', 'nazwa → numer'], ['click', 'wskaż na mapie']].map(([k, n]) => `<button data-m="${k}" class="${cfg.mode === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <div class="small muted" style="margin-bottom:4px">Co wpisujesz:</div><div class="seg" id="mfl">${[['cap', 'Stolica'], ...ORGS].map(([k, n]) => `<button data-f="${k}" class="${cfg.fields.includes(k) ? 'on' : ''}">${n}</button>`).join('')}</div>
    <p class="mq">${prompt}</p><form id="mform" autocomplete="off">${fieldsFor().map(f => `<label class="mf"><span>${(MFIELDS.find(x => x[0] === f) || [f, f])[1]}</span><input data-f="${f}" type="text" inputmode="${f === 'name' || f === 'cap' ? 'text' : 'text'}" placeholder="${f === 'nr' ? 'nr na mapie' : f === 'name' || f === 'cap' ? '' : 'rok albo „nie”'}"><em id="r-${f}"></em></label>`).join('')}</form>
    <div class="row" style="margin-top:10px"><button class="btn pri" id="mchk">Sprawdź</button><button class="btn" id="mnext">Pomiń</button></div><div id="mafter"></div>
    <p class="small muted" id="mstat">Opanowane (ostatnio bez błędu): ${mastered()} z ${D.mapa.states.length} · Enter – przejście do kolejnego pola / sprawdzenie. Po sprawdzeniu państwo zostaje na ekranie, dopóki nie klikniesz „Następne państwo”. Lata: wpisz rok przystąpienia albo „nie”; przy UE dla kandydatów zaliczam też „kandydat”.</p>`;
    $$('#mmode button').forEach(b => b.onclick = () => { cfg.mode = b.dataset.m; persist(); render(); });
    $$('#mfl button').forEach(b => b.onclick = () => { const f = b.dataset.f; cfg.fields = cfg.fields.includes(f) ? cfg.fields.filter(x => x !== f) : [...cfg.fields, f]; if (!cfg.fields.length && cfg.mode === 'click') cfg.fields = ['cap']; persist(); render(); });
    $('#mchk').onclick = check; $('#mnext').onclick = render;
    $('#mform').onsubmit = e => { e.preventDefault(); check(); };
    $$('#mform input').forEach((i, k, all) => i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const nx = all.slice(k + 1).find(x => !x.readOnly); if (nx) nx.focus(); else check(); } });
    const first = $('#mform input'); if (first && matchMedia('(min-width:700px)').matches) first.focus();
  }
  function check() {
    if (done) { recheck(); return; }
    done = true; let all = true; const rs = {};
    if (cfg.mode === 'click') { const ok = clicked === cur.n; all = ok; m.mark(null, 'sel'); if (clicked && !ok) m.mark(clicked, 'badm'); m.mark(cur.n, ok ? 'okm' : 'q'); $('#mclk').innerHTML = ok ? '<span class="verdict ok">✓ dobrze</span>' : `<span class="verdict bad">✗</span> to nr ${cur.n}${clicked ? ` (wskazano nr ${clicked} – ${esc(stN(clicked).name)})` : ''}`; }
    else m.mark(cur.n, 'q');
    for (const i of $$('#mform input')) { const f = i.dataset.f; const r = mapCheck(cur, f, i.value); rs[f] = r; if (!r.ok) all = false; showField(f, r, i.value); i.readOnly = r.ok; }
    const rec = MS[cur.n] || (MS[cur.n] = { ok: 0, bad: 0 }); if (all) rec.ok++; else rec.bad++; rec.last = all ? 1 : 0; rec.t = now(); persist(); touch('meta');
    $('#mnext').hidden = true; $('#mchk').textContent = 'Sprawdź poprawione'; $('#mchk').classList.remove('pri'); $('#mchk').hidden = all;
    after(all);
    $('#mstat').innerHTML = `${all ? '<b class="verdict ok">Komplet!</b>' : '<b class="verdict bad">Są błędy</b> – możesz uznać swoją odpowiedź przyciskiem „uznaję”.'} · Opanowane: ${mastered()} z ${D.mapa.states.length}`;
  }
  function after(all) {
    const s = cur; const box = $('#mafter'); if (!box) return;
    box.innerHTML = `<div class="minfo mcardinfo"><div class="small muted">${all ? 'Wszystko dobrze. Opracuj państwo i przejdź dalej, kiedy chcesz.' : 'Popraw błędne pola (możesz je wpisać jeszcze raz) albo uznaj swoją odpowiedź. Państwo zostaje na ekranie.'}</div><div style="margin-top:8px"><b style="font-size:18px">${s.n} · ${esc(s.name)}</b> – stolica: <b>${esc(s.cap)}</b></div><table class="mt"><tbody>${ORGS.map(([k, nm]) => `<tr><td>${nm}</td><td><b class="mono">${esc(orgDisp(s, k))}</b>${s.org[k].note ? `<div class="small muted">${esc(s.org[k].note)}</div>` : ''}</td></tr>`).join('')}</tbody></table>${s.note ? `<p class="small">${esc(s.note)}</p>` : ''}${seatsOf(s.n).length ? `<p class="small"><b>Siedziby:</b> ${seatsOf(s.n).map(esc).join('; ')}</p>` : ''}</div>
    <div class="row" style="margin-top:12px"><button class="btn pri" id="mgo" disabled>Następne państwo →</button></div>`;
    const go = $('#mgo'); setTimeout(() => { go.disabled = false; }, 700); go.onclick = render;
  }
  function recheck() {
    let all = true;
    for (const i of $$('#mform input')) { const f = i.dataset.f; const r = mapCheck(cur, f, i.value); if (!r.ok) all = false; showField(f, r, i.value); i.readOnly = r.ok; }
    if (cfg.mode === 'click' && clicked !== cur.n) all = false;
    if (all) { $('#mchk').hidden = true; toast('Teraz wszystko dobrze'); }
    const nx = $$('#mform input').find(x => !x.readOnly); if (nx) nx.focus();
  }
  function showField(f, r, v) {
    const el = $('#r-' + f); if (!el) return;
    el.className = r.ok ? 'ok' : r.near ? 'mid' : 'bad';
    el.innerHTML = r.ok ? `✓${r.acc ? ' (uznana wcześniej)' : ''}${f !== 'nr' && f !== 'name' && f !== 'cap' ? ` <span class="muted">${esc(r.exp)}</span>` : ''}` : `${r.near ? 'literówka?' : '✗'} poprawnie: <b>${esc(r.exp)}</b>${v.trim() ? ` <button type="button" class="btn sm" data-acc="${f}">uznaję</button>` : ''}`;
    const b = $('[data-acc]', el); if (b) b.onclick = () => { const key = `map:${cur.n}:${f}`; (S.acc[key] = S.acc[key] || []).push(nrm(v)); persist(); touch('meta'); showField(f, { ok: true, acc: 1, exp: r.exp }, v); const inp = $(`#mform input[data-f="${f}"]`); if (inp) inp.readOnly = true; const left = $$('#mform em.bad, #mform em.mid').length; if (!left && (cfg.mode !== 'click' || clicked === cur.n)) $('#mchk').hidden = true; const rec = MS[cur.n]; if (!left && rec && (cfg.mode !== 'click' || clicked === cur.n)) { rec.bad = Math.max(0, rec.bad - 1); rec.ok++; rec.last = 1; persist(); touch('meta'); } toast('Uznano – ta odpowiedź będzie odtąd zaliczana'); };
  }
  render();
}

/* ---------- SZUKAJ, WIĘCEJ, USTAWIENIA ---------- */
let IDX = null;
function vSzukaj(app) {
  app.innerHTML = `<div class="eyebrow">Wszystkie materiały</div><h1>Szukaj</h1><input type="search" id="q" placeholder="np. CERD, Gregorczyk, art. 72, Banjul, kara śmierci" autofocus><div id="sr" style="margin-top:14px"></div>`;
  if (!IDX) IDX = CARDS.map(c => [fold([c.q, c.a, (c.o || []).join(' '), c.e, c.u, c.src].join(' ')), c]);
  const run = () => {
    const q = fold($('#q').value.trim()); if (q.length < 2) { $('#sr').innerHTML = ''; return; }
    const ws = q.split(/\s+/);
    const les = D.lessons.filter(l => ws.every(w => fold(l.title + ' ' + l.h).includes(w))).slice(0, 8);
    const hits = IDX.filter(([t]) => ws.every(w => t.includes(w))).slice(0, 80).map(x => x[1]);
    $('#sr').innerHTML = (les.length ? `<h3>Lekcje</h3><div class="lst">${les.map(l => `<a href="#lekcja-${l.id}"><b>${esc(l.title)}</b></a>`).join('')}</div>` : '') + `<h3>Fiszki (${hits.length}${hits.length === 80 ? '+' : ''})</h3>` + hits.map(c => `<details class="card"><summary>${c.q.replace(/<img[^>]*>/g, '[obraz]')}</summary><div style="margin-top:8px">${c.img ? `<div class="qimg">${c.img}</div>` : ''}${c.k === 'mc' ? c.o.map((o, i) => `<div class="${c.ans.includes(LET[i]) ? 'chip ok' : 'chip'}" style="white-space:normal">${LET[i]}) ${o}</div>`).join('') : `<div class="ans">${esc(c.a)}</div>`}${c.e ? `<div class="ex">${c.k === 'mc' ? c.e : esc(c.e)}</div>` : ''}${c.u ? `<div class="note">${c.k === 'mc' ? c.u : esc(c.u)}</div>` : ''}<div class="src">${esc(c.src || POOLS[c.pool].n)}</div></div></details>`).join('');
  };
  let tt; $('#q').oninput = () => { clearTimeout(tt); tt = setTimeout(run, 200); };
}
function vWiecej(app) {
  app.innerHTML = `<h1>Więcej</h1><div class="grid g2">${[['analiza', 'Analiza etapów', 'co i jakie zadania są na okręgowym, a co na centralnym'], ['arkusze', 'Arkusze archiwalne', 'oryginalne strony testów i kluczy'], ['mapa', 'Mapa Europy', 'numery, stolice, NATO/UE, siedziby'], ['quiz', 'Quiz finałowy', '10 pytań, 15 sekund na każde'], ['szukaj', 'Szukaj', 'we wszystkich fiszkach i lekcjach'], ['ustawienia', 'Ustawienia', 'limit nowych kart, kopia postępu']].map(([h, n, d]) => `<a class="tile" href="#${h}"><b>${n}</b><span>${d}</span></a>`).join('')}</div>`;
}
function fcHTML() {
  const f = S.settings.fz; const fc = forecast(f ? (c => filterCard(c, f)) : null, 14); const mx = Math.max(1, ...fc);
  if (!fc.some(Boolean)) return '';
  const lab = i => i === 0 ? 'dziś' : i === 1 ? 'jut.' : new Date(dayStart(now()) + i * DAY).toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' });
  return `<div class="card fcst"><div class="row between"><b>Powtórki w najbliższych 2 tygodniach</b><span class="small muted">wybrany zestaw · bez nowych kart</span></div><div class="fcb">${fc.map((n, i) => `<div title="${lab(i)}: ${n}"><span class="v">${n || ''}</span><i style="height:${Math.round(n / mx * 100)}%"></i><span class="d">${lab(i)}</span></div>`).join('')}</div></div>`;
}
function vUstawienia(app) {
  const ex = nextExam(now()), target = ex === examDates().okr ? 1 : 2, pn = planNew(c => lvlRank[c.lvl] <= target);
  const v = S.settings.newPerDay, ret = S.settings.ret || .9;
  app.innerHTML = `<h1>Ustawienia</h1><div class="card"><h3>Fiszki</h3>
  <div class="grid g2"><label><span class="small muted">Nowe karty dziennie</span><select id="npm"><option value="auto" ${v === 'auto' ? 'selected' : ''}>automatycznie – tyle, żeby zdążyć przed etapem (teraz ${newLimit()})</option><option value="n" ${v !== 'auto' ? 'selected' : ''}>stała liczba</option></select></label>
  <label><span class="small muted">Stała liczba</span><input type="number" id="npd" min="5" max="300" value="${v === 'auto' ? pn.per : v}" ${v === 'auto' ? 'disabled' : ''}></label>
  <label><span class="small muted">Najdłuższy odstęp między powtórkami</span><select id="mxi">${[['auto', `automatycznie – ok. 1/3 czasu do etapu, min. 5 dni (teraz ${maxIvl(now())} dni)`], ['3', '3 dni'], ['5', '5 dni'], ['7', '7 dni'], ['14', '14 dni'], ['30', '30 dni'], ['365', 'bez limitu']].map(([x, l]) => `<option value="${x}" ${String(S.settings.maxIvl || 'auto') === x ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <label><span class="small muted">Docelowa skuteczność przypominania</span><select id="ret">${[[.85, '85% – mniej powtórek'], [.9, '90% – zalecane'], [.95, '95% – najwięcej powtórek, przed samym etapem']].map(([x, l]) => `<option value="${x}" ${ret === x ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
  <p class="small muted">Do etapu ${target === 1 ? 'okręgowego' : 'centralnego'}: ${Math.max(0, daysTo(ex))} dni. Nieprzerobionych kart z tego zakresu: ${pn.fresh} – żeby skończyć 4 dni przed etapem, potrzeba ok. ${pn.per} nowych dziennie. Odstępy liczy FSRS: wyższa skuteczność = krótsze odstępy i więcej powtórek.</p>
  <button class="btn pri" id="sv">Zapisz</button></div>
  <div class="card"><h3>Kopia postępu</h3><p class="small">Postęp ${SY.db ? 'synchronizuje się z Twoim kontem Claude' : 'jest zapisany tylko w tej przeglądarce'}. Możesz zapisać go do pliku i wczytać na innym urządzeniu.</p><div class="row"><button class="btn" id="ex">Pobierz kopię</button><label class="btn">Wczytaj kopię<input type="file" id="im" accept=".json" hidden></label><button class="btn red" id="rs">Wyczyść postęp</button></div></div>`;
  $('#npm').onchange = () => { $('#npd').disabled = $('#npm').value === 'auto'; };
  $('#sv').onclick = () => { S.settings.newPerDay = $('#npm').value === 'auto' ? 'auto' : Math.max(5, Math.min(300, +$('#npd').value || 40)); S.settings.ret = +$('#ret').value || .9; const mx = $('#mxi').value, chg = mx !== String(S.settings.maxIvl || 'auto'); S.settings.maxIvl = mx === 'auto' ? 'auto' : +mx; if (chg) { const k = capExisting(); if (k) { for (let i = 0; i < NSH; i++) touch('c' + i); toast(`Skrócono odstępy ${k} kart`); } } save(); touch('meta'); toast('Zapisano'); vUstawienia(app); };
  $('#ex').onclick = async () => { S.lastExport = now(); persist(); const blob = new Blob([JSON.stringify(S)], { type: 'application/json' }); const name = `owpc-postep-${new Date().toISOString().slice(0, 10)}.json`; try { const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; if (dl) { await dl.save({ filename: name, data: blob }); return; } } catch (e) {} const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };
  $('#im').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const s = JSON.parse(await f.text()); if (!s.cards) throw 0; S = Object.assign(blank(), s); persist(); for (let i = 0; i < NSH; i++) touch('c' + i); touch('meta'); toast('Wczytano kopię'); } catch (err) { toast('To nie jest plik kopii kursu'); } };
  $('#rs').onclick = () => ask('Na pewno usunąć cały postęp (fiszki, testy, lekcje)?', 'Usuń postęp', () => { S = blank(); persist(); for (let i = 0; i < NSH; i++) touch('c' + i); touch('meta'); toast('Wyczyszczono'); });
}

/* ---------- motyw, start ---------- */
function themeBtn() {
  const R = document.documentElement, B = $('#thm'); const mq = matchMedia('(prefers-color-scheme: dark)');
  const eff = () => R.getAttribute('data-owpc') || (R.getAttribute('data-theme') === 'dark' || R.getAttribute('data-theme') === 'light' ? R.getAttribute('data-theme') : mq.matches ? 'dark' : 'light');
  const lab = () => { const d = eff() === 'dark'; B.innerHTML = svg(d ? '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>' : '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'); B.setAttribute('aria-label', d ? 'Jasny motyw' : 'Ciemny motyw'); };
  B.onclick = () => { const n = eff() === 'dark' ? 'light' : 'dark'; R.setAttribute('data-owpc', n); try { localStorage.setItem('owpc-theme', n); } catch (e) {} lab(); };
  lab(); try { mq.addEventListener('change', lab); } catch (e) {}
}
async function boot() {
  themeBtn();
  try { D = await (await fetch('content.json?v=20261123a')).json(); } catch (e) { $('#app').innerHTML = '<div class="empty">Nie udało się wczytać materiałów. Odśwież stronę.</div>'; return; }
  for (const t of D.topics) TOP[t.c] = t;
  buildCards();
  migSettings(); rescoreTests(true);
  // filtr sesji „z arkusza”
  window.addEventListener('hashchange', route);
  const _vS = vSesja; vSesja = function (app, a, b) { if (a === 's' && b && !SESS) { const sid = b.includes('_') ? b : b.replace('-', '_'); const list = CARDS.filter(c => c.sid === sid || c.sid === a + '_' + b); SESS = { q: list.slice(), i: 0, done: 0, ok: 0, back: false, sel: new Set(), typed: '', again: [], isNew: new Set(list.filter(c => !S.cards[c.id]).map(c => c.id)) }; } return _vS(app, a, b); };
  route(); syncInit();
  if (GH) {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    const f = document.createElement('footer'); f.className = 'sitefoot noprint';
    f.innerHTML = 'Nieoficjalny kurs przygotowawczy do Olimpiady Wiedzy o Prawach Człowieka w Świecie Współczesnym. Organizator olimpiady i autor arkuszy archiwalnych: <a href="https://coptiosh.eu/owopc" target="_blank" rel="noopener">COPTIOSH</a>. Postęp zapisuje się tylko w Twojej przeglądarce – nikt inny go nie widzi.';
    document.body.appendChild(f);
  }
}
boot();
