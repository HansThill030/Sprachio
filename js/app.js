const NIVEAUS = ['A2','B1','C1'];
const NIVEAU_LABELS = { A2:'IVA 2', B1:'DSD I', C1:'DSD II' };
const PAGE_ORDER = ['config','aufgabe','schreiben','korrektur'];
const PAGE_LABELS = { config:'Escolher', aufgabe:'Atividade', schreiben:'Escrever', korrektur:'Resultado' };

const TEXTSORTEN = {
  A2: [
    { key:'email_informell', label:'Informelle E-Mail', kurz:'an Freunde/Familie' }
  ],
  B1: [
    { key:'leserbrief', label:'Leserbrief', kurz:'Reaktion auf Forum-Diskussion (Zeitschrift)',
      forumClosing:'Schreibe einen Leserbrief an die Redaktion der Zeitschrift, in der die Diskussion veröffentlicht wurde.' },
    { key:'beitrag', label:'Beitrag (Schülerzeitung)', kurz:'Forum-Diskussion + Meinung',
      forumClosing:'Schreibe einen Beitrag für die Schülerzeitung deiner Schule.' }
  ],
  C1: [
    { key:'erörterung_grafik', label:'Diskursive Erörterung mit Grafikauswertung', kurz:'DSD II (B2/C1, gleiche Aufgabe)',
      promptDesc:'eine diskursive Erörterung mit Grafikauswertung im echten DSD-II-Format: ein kurzer Sachtext (150-200 Wörter, mit Quellenangabe, im "quelltext"-Feld) zu einem gesellschaftlichen Thema PLUS eine Beschreibung einer fiktiven Statistik/Grafik in Worten (konkrete Zahlen/Prozentwerte), ebenfalls im "quelltext"-Feld nach dem Sachtext angehängt. Im "aufgabe"-Feld: Aufforderung, den Text zusammenzufassen, die Grafik auszuwerten und eine ausführliche Erörterung mit eigener Meinung zu schreiben. Bearbeitungszeit nennen, keine Wortzahl-Vorgabe.' }
  ]
};

/* Cada nível agora é o seu próprio grupo — sem mistura entre IVA 2 / DSD I / DSD II */
const NIVEAU_GROUP = { A2:'A2', B1:'B1', C1:'C1' };

const state = { page:'config', maxPage:0, niveau:'B1', tipoKey:TEXTSORTEN['B1'][0].key, schwierigkeit:4, aufgabaObj:null, bank:[], classroomSubmission:false };
const $ = id => document.getElementById(id);
function currentMeta(){ return TEXTSORTEN[state.niveau].find(t => t.key === state.tipoKey); }
function niveauLabel(n){ return NIVEAU_LABELS[n] || n; }

/* Traduz erros técnicos em mensagens compreensíveis pro usuário */
function mensagemErroAmigavel(e){
  const msg = (e?.message || String(e) || '').toLowerCase();
  if (msg.includes('tageslimit')) return '⏳ Tageslimit erreicht. Bitte versuche es morgen erneut.';
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network')) return '📡 Verbindungsproblem. Prüfe deine Internetverbindung und versuche es erneut.';
  if (msg.includes('timeout') || msg.includes('timed out')) return '⏱️ Die Anfrage hat zu lange gedauert (evtl. Foto zu groß oder Server überlastet). Bitte versuche es erneut oder mit einem kleineren Foto.';
  if (msg.includes('json') || msg.includes('unexpected token')) return '⚠️ Die KI-Antwort konnte nicht verarbeitet werden. Bitte versuche es nochmal.';
  if (msg.includes('502') || msg.includes('503') || msg.includes('gemini request failed')) return '🔧 Der KI-Dienst ist gerade überlastet. Bitte in ein paar Minuten erneut versuchen.';
  return '❌ Fehler bei der Korrektur. Bitte nochmal versuchen.';
}

/* Referência de vocabulário oficial (Goethe-Institut Wortliste / GER) por nível —
   usado tanto na geração de tarefas quanto na correção, pra calibrar dificuldade
   de forma consistente com um padrão reconhecido, sem reproduzir a lista em si. */
function wortlisteHinweis(niveau){
  const map = {
    A2: 'der Goethe-Institut A2-Wortliste (GER-Niveau A2)',
    B1: 'der Goethe-Institut B1-Wortliste (GER-Niveau B1)',
    C1: 'den Goethe-Institut B2- und C1-Wortlisten (GER-Niveau B2/C1)'
  };
  return map[niveau] || 'dem entsprechenden GER-Niveau';
}


/* ---------- Supabase ---------- */
const SUPABASE_URL = window.SCHREIBTRAINER_CONFIG?.SUPABASE_URL || "";
const SUPABASE_KEY = window.SCHREIBTRAINER_CONFIG?.SUPABASE_ANON_KEY || "";

function assertSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "Supabase não está configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Vercel."
    );
  }
}


/* ---------- Supabase Auth ---------- */
let _supabase = null;
let _session = null;

async function initAuth(){
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data } = await _supabase.auth.getSession();
  _session = data.session;
  if (!_session) {
    location.href = '/login';
    return false;
  }
  // Atualiza sessão se expirar
  _supabase.auth.onAuthStateChange((_event, session) => { _session = session; });
  // Mostra email no header
  const userEl = document.getElementById('userEmail');
  if (userEl) userEl.textContent = _session.user.email;
  return true;
}

async function signOut(){
  await _supabase.auth.signOut();
  location.href = '/login';
}

function getAuthHeader(){
  return _session?.access_token
    ? { 'Authorization': 'Bearer ' + _session.access_token }
    : { 'Authorization': 'Bearer ' + SUPABASE_KEY };
}

function sbFetch(path, options = {}) {
  const headers = Object.assign({
    'apikey': SUPABASE_KEY,
    'Content-Type': 'application/json'
  }, getAuthHeader(), options.headers || {});
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, Object.assign({}, options, { headers }));
}
function rowToBankItem(r) {
  return { id: r.id, niveau: r.niveau, textsorte: r.textsorte, filename: r.filename, text: r.texto, addedAt: r.created_at };
}
async function loadBank(){
  try {
    const res = await sbFetch('modellsaetze?select=*&order=created_at.desc');
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('unexpected response');
    state.bank = data.map(rowToBankItem);
  } catch(e) {
    console.error('Supabase-Fehler beim Laden des Banco:', e);
    state.bank = [];
  }
}

/* Extrahiert die Modellsatz-Nummer aus dem filename, z.B. "DSD I Modellsatz 7 – Musik" -> 7 */
function extrairNumeroModellsatz(filename){
  const m = /Modellsatz\s*(\d+)/i.exec(filename || '');
  return m ? parseInt(m[1], 10) : null;
}

/* Wählt Referenz-Modellsätze passend zum Schwierigkeitsgrad (1-8):
   Der Regler zeigt proportional auf die Nummer des Modellsatzes im Banco —
   z.B. bei 8 vorhandenen B1-Modellsätzen zeigt Schwierigkeit 5 auf Modellsatz 5,
   und die Nachbarn (4 und 6) werden als zusätzliche Referenz mitgenommen. */
function pickReferences(){
  const grupo = NIVEAU_GROUP[state.niveau];
  const exact = state.bank.filter(b => NIVEAU_GROUP[b.niveau] === grupo && b.textsorte === state.tipoKey);
  const pool = exact.length ? exact : state.bank.filter(b => NIVEAU_GROUP[b.niveau] === grupo);
  if (!pool.length) return [];

  const comNumero = pool
    .map(b => ({ item:b, n: extrairNumeroModellsatz(b.filename) }))
    .filter(x => x.n !== null)
    .sort((a,b) => a.n - b.n);

  if (!comNumero.length) {
    const shuffled = [...pool].sort(() => Math.random()-0.5);
    return shuffled.slice(0,2);
  }

  const total = comNumero.length;
  const alvo = Math.max(1, Math.min(total, Math.round((state.schwierigkeit/8) * total)));
  const posicoes = [alvo-1, alvo, alvo+1].filter(n => n >= 1 && n <= total);
  const indices = [...new Set(posicoes)].map(pos => pos - 1);
  return indices.map(i => comNumero[i].item);
}

/* ---------- Gemini API (via Supabase Edge Function gemini-proxy) ---------- */
async function callGemini(userPrompt, maxTokens, images){
  assertSupabaseConfig();
  const body = { prompt: userPrompt, max_tokens: maxTokens || 1000 };
  if (images && images.length) body.images = images.map(img => ({ mimeType: img.mimeType, data: img.data }));
  const response = await fetch(`${SUPABASE_URL}/functions/v1/gemini-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + (_session?.access_token || SUPABASE_KEY)
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 429 || data.limitReached) {
    throw new Error('Tageslimit erreicht. Bitte versuche es morgen erneut.');
  }
  if (!response.ok) {
    const detail = data?.error || data?.details || `HTTP ${response.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  if (data.error) {
    throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
  }
  return data.text || "";
}
function extractJson(text){
  const cleaned = text.replace(/```json/g,'').replace(/```/g,'').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error('Keine JSON-Antwort gefunden (leere oder ungültige KI-Antwort).');

  // Tenta achar o "}" que fecha exatamente o objeto raiz, contando chaves/colchetes
  // e ignorando os que estão dentro de strings — mais confiável que só pegar o último "}"
  // (que falha se a resposta foi cortada no meio).
  function fecharBalanceado(s){
    let depth = 0, dentroString = false, escapando = false;
    for (let i = 0; i < s.length; i++){
      const c = s[i];
      if (escapando) { escapando = false; continue; }
      if (c === '\\') { escapando = true; continue; }
      if (c === '"') { dentroString = !dentroString; continue; }
      if (dentroString) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return s.slice(0, i+1); }
    }
    return null; // nunca fechou — resposta truncada
  }

  const trecho = cleaned.slice(start);
  const balanceado = fecharBalanceado(trecho);
  if (balanceado) {
    try { return JSON.parse(balanceado); } catch(e) { /* cai no reparo abaixo */ }
  }

  // Resposta truncada ou malformada: tenta reparar fechando chaves/colchetes/strings pendentes
  let reparado = balanceado || trecho;
  let abertos = [];
  let dentroString = false, escapando = false;
  for (const c of reparado){
    if (escapando) { escapando = false; continue; }
    if (c === '\\') { escapando = true; continue; }
    if (c === '"') { dentroString = !dentroString; continue; }
    if (dentroString) continue;
    if (c === '{' || c === '[') abertos.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') abertos.pop();
  }
  if (dentroString) reparado += '"';
  // remove vírgula pendurada antes de fechar (ex: `"a":1,` no final)
  reparado = reparado.replace(/,\s*$/, '');
  reparado += abertos.reverse().join('');

  try {
    return JSON.parse(reparado);
  } catch(e) {
    throw new Error('unexpected token — Die KI-Antwort war unvollständig oder ungültig (JSON konnte nicht repariert werden).');
  }
}
function escapeHtml(str){ const div = document.createElement('div'); div.textContent = str || ''; return div.innerHTML; }

/* ---------- Router ---------- */
function currentHashPage(){
  const h = location.hash.replace('#/','').split('?')[0];
  return PAGE_ORDER.includes(h) ? h : 'config';
}
function renderStepper(){
  const el = $('stepper');
  if (!el) return;
  el.innerHTML = '';
  PAGE_ORDER.forEach((p,i) => {
    const idx = PAGE_ORDER.indexOf(state.page);
    const dot = document.createElement('div');
    let cls = 'step-dot';
    if (p === state.page) cls += ' active';
    else if (i <= state.maxPage) cls += ' done';
    dot.className = cls;
    dot.innerHTML = `<span class="num">${String(i+1).padStart(2,'0')}</span><span class="lbl">${PAGE_LABELS[p]}</span>`;
    if (i <= state.maxPage && p !== state.page) dot.addEventListener('click', () => { location.hash = '#/' + p; });
    el.appendChild(dot);
  });
}
function goToPage(p){
  location.hash = '#/' + p;
}
function onHashChange(){
  const p = currentHashPage();
  const idx = PAGE_ORDER.indexOf(p);
  // guard: can't jump ahead of what's unlocked (e.g. typing URL directly)
  if (idx > state.maxPage) {
    location.hash = '#/' + PAGE_ORDER[state.maxPage];
    return;
  }
  state.page = p;
  document.querySelectorAll('.page').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('page-' + p);
  if (el) el.classList.add('active');
  renderStepper();
  window.scrollTo({top:0, behavior:'smooth'});
}
window.addEventListener('hashchange', onHashChange);

/* ---------- Page: config ---------- */
function renderNiveauRow(){
  const row = $('niveauRow');
  row.innerHTML = '';
  NIVEAUS.forEach(n => {
    const btn = document.createElement('button');
    btn.className = 'niveau-btn' + (n === state.niveau ? ' active' : '');
    btn.textContent = niveauLabel(n);
    btn.addEventListener('click', () => { state.niveau = n; state.tipoKey = TEXTSORTEN[n][0].key; renderNiveauRow(); renderTeileRow(); });
    row.appendChild(btn);
  });
}
function renderTeileRow(){
  const row = $('teileRow');
  row.innerHTML = '';
  TEXTSORTEN[state.niveau].forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'teil-btn' + (t.key === state.tipoKey ? ' active' : '');
    btn.innerHTML = `<span class="n">${niveauLabel(state.niveau)} · ${t.kurz}</span>${t.label}`;
    btn.addEventListener('click', () => { state.tipoKey = t.key; renderTeileRow(); });
    row.appendChild(btn);
  });
}
if ($('diffSlider')) {
  $('diffSlider').addEventListener('input', (e) => { state.schwierigkeit = parseInt(e.target.value,10); $('diffVal').textContent = state.schwierigkeit; });
}
if ($('btnToAufgabe')) {
  $('btnToAufgabe').addEventListener('click', () => {
    state.aufgabaObj = null;
    $('aufgabeText').textContent = 'Klicke auf „Neues Thema generieren".';
    $('quelltext').style.display = 'none';
    $('baloes').style.display = 'none';
    $('baloes').innerHTML = '';
    $('refNote').textContent = '';
    $('btnToSchreiben').disabled = true;
    state.maxPage = Math.max(state.maxPage, 1);
    goToPage('aufgabe');
    gerarComIA();
  });
}

/* ---------- Page: aufgabe (geração via IA) ---------- */
async function gerarComIA(){
  const meta = currentMeta();
  $('loadingIA').style.display = 'inline';
  $('btnGerarIA').disabled = true;
  $('baloes').style.display = 'none';
  $('baloes').innerHTML = '';
  try {
    if (state.niveau === 'A2' && state.tipoKey === 'email_informell') {
      await gerarA2Email(meta);
    } else if (state.niveau === 'B1' && (state.tipoKey === 'leserbrief' || state.tipoKey === 'beitrag')) {
      await gerarB1Forum(meta);
    } else {
      await gerarGenerico(meta);
    }
    $('btnToSchreiben').disabled = false;
  } catch(e) {
    console.error(e);
    $('aufgabeText').textContent = 'Fehler beim Erstellen der Aufgabe. Bitte nochmal versuchen.';
    $('btnToSchreiben').disabled = true;
  }
  $('loadingIA').style.display = 'none';
  $('btnGerarIA').disabled = false;
}

/* Evita que gerações consecutivas na mesma sessão saiam com o mesmo tema —
   o modelo tende a convergir pro "tema mais provável" se o prompt for quase
   idêntico a cada chamada. Aqui a gente rastreia o que já saiu nesta sessão
   e injeta isso + um "sal" aleatório no prompt, pra forçar variedade real. */
let temasGeradosSessao = [];
function notaAntiRepeticao(temasBanidosFixos){
  const todos = [...temasBanidosFixos, ...temasGeradosSessao];
  const listaTexto = todos.length
    ? `\n\nTHEMEN, DIE NICHT VERWENDET WERDEN DÜRFEN (schon benutzt): ${todos.join(', ')}.`
    : '';
  const nonce = Math.floor(Math.random() * 1000000);
  return `${listaTexto}\nVariationswert (nur intern zur Auflockerung, im Ergebnis ignorieren): ${nonce}`;
}
function registrarTemaGerado(tema){
  if (tema) temasGeradosSessao.push(tema);
}

async function gerarGenerico(meta){
  const refs = pickReferences();
  let refBlock = '';
  if (refs.length) {
    refBlock = '\n\nHier sind echte Beispielaufgaben desselben Niveaus als Stil-Referenz (Format, Ton, Länge, Aufbau nachahmen, aber KEIN Thema wiederholen):\n' +
      refs.map((r,i) => `--- Beispiel ${i+1} (${r.filename}) ---\n${r.text}`).join('\n');
    $('refNote').textContent = 'Orientiert an: ' + refs.map(r=>r.filename).join(', ');
  } else {
    $('refNote').textContent = 'Kein passender Modellsatz im Banco gespeichert — Aufgabe wird nach allgemeinem DSD-Format generiert.';
  }
  const dsdHinweis = (state.niveau === 'C1')
    ? '\n\nWichtig: Bei DSD II ist die Aufgabe für B2 und C1 identisch — nur die erreichte Punktzahl in der Prüfung entscheidet, welches Niveau am Ende verliehen wird. Erstelle also eine reguläre DSD-II-Aufgabe; der Schwierigkeitsgrad-Regler darf das Thema/den Wortschatz trotzdem leicht anspruchsvoller oder zugänglicher gestalten.'
    : '';
  const prompt = `Du bist Experte für die Erstellung von Prüfungsaufgaben des Deutschen Sprachdiploms (DSD). Erstelle ${meta.promptDesc}
Schwierigkeitsgrad: ${state.schwierigkeit}/8 (1 = einfachste Umsetzung innerhalb des Niveaus ${niveauLabel(state.niveau)}, 8 = anspruchsvollste Umsetzung, nah am nächsthöheren Niveau).
Wortschatz: Kalibriere Thema und Formulierungen am Wortschatzniveau ${wortlisteHinweis(state.niveau)} — nicht künstlich vereinfacht, aber auch nicht spürbar darüber.${dsdHinweis}${refBlock}
Erfinde ein NEUES, noch nicht verwendetes Thema — wähle bewusst aus einem anderen Lebensbereich als zuletzt (z.B. abwechselnd Schule, Umwelt, Technologie, Gesundheit, Reisen, soziales Leben, Zukunftspläne, Arbeit/Beruf, Konsum, Medien).${notaAntiRepeticao([])} Antworte NUR mit einem JSON-Objekt, keine Einleitung, keine Markdown-Backticks. Format:
{"thema": "kurzes Stichwort für interne Zwecke", "aufgabe": "vollständiger Aufgabentext auf Deutsch inkl. Situation/Kontext, nummerierter/aufgezählter Punkte und Bearbeitungszeit", "quelltext": "Ausgangstext oder Grafikbeschreibung falls zutreffend, sonst leerer String"}`;
  const raw = await callGemini(prompt, 4000);
  const json = extractJson(raw);
  registrarTemaGerado(json.thema);
  state.aufgabaObj = json;
  $('aufgabeTag').textContent = `${niveauLabel(state.niveau)} · ${meta.label}`;
  $('aufgabeSchwierigkeit').textContent = `Schwierigkeit ${state.schwierigkeit}/8`;
  $('aufgabeText').textContent = json.aufgabe;
  if (json.quelltext) { $('quelltext').textContent = json.quelltext; $('quelltext').style.display = 'block'; }
  else { $('quelltext').style.display = 'none'; }
}

/* A2: Aussagegerüst fest, nur Einleitung/Aufforderung/4 Punkte kommen von der KI */
async function gerarA2Email(meta){
  const refs = pickReferences();
  let refBlock = '';
  if (refs.length) {
    refBlock = `\n\nStil-Referenz (Ton/Länge/Satzbau nachahmen, KEIN Thema wiederholen):\n${refs.map(r=>r.text).join('\n---\n')}`;
    $('refNote').textContent = 'Orientiert an: ' + refs.map(r=>r.filename).join(', ');
  } else {
    $('refNote').textContent = 'Kein passender Modellsatz im Banco gespeichert — Aufgabe wird nach allgemeinem Muster generiert.';
  }
  const prompt = `Du bist Experte für die Erstellung von DSD-I-Prüfungsaufgaben (Deutsches Sprachdiplom) auf A2-Niveau, Schwierigkeitsgrad ${state.schwierigkeit}/8 (1 = ganz einfaches, konkretes Alltagsthema, 8 = etwas anspruchsvolleres Thema mit mehr Wortschatz, aber immer noch A2-passend).
Wortschatz: Bleib strikt im Rahmen ${wortlisteHinweis('A2')} — einfache, hochfrequente Alltagswörter, kurze Sätze, keine komplexen Nebensatzkonstruktionen.
Wähle ein NEUES, altersgerechtes Alltagsthema für Jugendliche aus einem breiten Themenfeld (Schule, Hobbys, Familie, Essen, Freunde, Feste, Technik, Tiere, Wohnen, Reisen, Sport, Zukunftspläne, u.ä.) — variiere bewusst das Themenfeld gegenüber vorherigen Aufgaben.${notaAntiRepeticao(['Ferien','Sport','Wochenende'])}${refBlock}
Antworte NUR mit einem JSON-Objekt, keine Einleitung, keine Markdown-Backticks. Format:
{"thema": "ein Wort oder kurzer Begriff", "einleitung": "zwei Sätze im Stil: '[Name] wohnt in Deutschland. Ihr schreibt euch regelmäßig E-Mails. In seiner/ihrer letzten E-Mail hat [Name] erzählt, [was er/sie erzählt hat, passend zum Thema].' (oder alternativ die Brieffreund-Variante wie im Beispiel 'Ferien')", "aufforderung": "ein Satz: 'Schreibe [Name] eine E-Mail zurück.' oder 'Beantworte [Name]s Brief.' (passend zur Einleitung)", "punkte": ["Frage/Aufforderung 1", "Frage/Aufforderung 2", "Frage/Aufforderung 3", "Frage/Aufforderung 4"]}
Die 4 Punkte sollen wie im echten Modellsatz sein: konkrete Fragen zum Thema, die eigene Erfahrung des Schreibers betreffen.`;
  const raw = await callGemini(prompt, 3000);
  const json = extractJson(raw);
  registrarTemaGerado(json.thema);
  const aufgabe = `${json.thema}\n\n${json.einleitung}\n\n${json.aufforderung}\n\nSchreibe ausführlich zu diesen vier Punkten:\n\n${json.punkte.map(p=>'• '+p).join('\n')}\n\nDu hast insgesamt 45 Minuten Zeit.`;
  state.aufgabaObj = { aufgabe, quelltext:'', thema: json.thema };
  $('aufgabeTag').textContent = `${niveauLabel(state.niveau)} · ${meta.label}`;
  $('aufgabeSchwierigkeit').textContent = `Schwierigkeit ${state.schwierigkeit}/8`;
  $('aufgabeText').textContent = aufgabe;
  $('quelltext').style.display = 'none';
  $('baloes').style.display = 'none';
}

/* B1: Forumsgerüst fest, nur Thema + 4 Aussagen + 2 Fragen kommen von der KI */
async function gerarB1Forum(meta){
  const refs = pickReferences();
  let refBlock = '';
  if (refs.length) {
    refBlock = `\n\nStil-Referenz aus echten Modellsätzen nahe deinem Schwierigkeitsgrad (Ton/Länge/Satzbau nachahmen, KEIN Thema wiederholen):\n` +
      refs.map((r,i) => `--- ${r.filename} ---\n${r.text}`).join('\n');
    $('refNote').textContent = 'Orientiert an: ' + refs.map(r=>r.filename).join(', ');
  } else {
    $('refNote').textContent = 'Kein passender Modellsatz im Banco gespeichert — Aussagen werden nach allgemeinem Muster generiert.';
  }

  const schwierigkeitsHinweis = state.schwierigkeit <= 2
    ? 'Sehr konkretes, alltagsnahes Thema. Kurze, einfache Hauptsätze. Grundwortschatz.'
    : state.schwierigkeit <= 5
    ? 'Durchschnittliches B1-Thema. Mix aus Haupt- und Nebensätzen (weil, wenn, dass). Normaler B1-Wortschatz.'
    : 'Etwas abstrakteres Thema, mehr Nebensätze und Konnektoren (obwohl, trotzdem, außerdem, allerdings). WICHTIG: trotzdem im B1-Wortschatz bleiben, keine C1-Wörter — nur Satzbau und Themenwahl werden anspruchsvoller, nicht die Wortliste.';

  const prompt = `Du bist Experte für die Erstellung von DSD-I-Prüfungsaufgaben (Deutsches Sprachdiplom), Textsorte "Beitrag für die Schülerzeitung" / "Leserbrief" auf B1-Niveau.

AUFGABE: Erstelle die variablen Teile für eine neue Aufgabe im exakt gleichen Format wie die echten Modellsätze.

SCHWIERIGKEITSGRAD ${state.schwierigkeit}/8: ${schwierigkeitsHinweis}
Wortschatz-Referenz: ${wortlisteHinweis('B1')} — auch beim anspruchsvollsten Schwierigkeitsgrad nicht darüber hinausgehen.

REGELN (unbedingt einhalten):
1. Antworte NUR mit einem einzigen JSON-Objekt. Kein Text davor oder danach. Keine Markdown-Backticks (\`\`\`).
2. Das JSON muss GENAU diese Struktur haben, keine zusätzlichen oder fehlenden Felder:
   {"thema": string, "personen": [4 Objekte mit "name" und "aussage"], "frage_persoenlich": string, "frage_meinung": string}
3. "thema": ein bis zwei Wörter, groß geschrieben wie ein Titel. Wähle bewusst ein anderes Themenfeld als in vorherigen Aufgaben (z.B. abwechselnd Schule, Freizeit, Familie, Umwelt, Technologie, Ernährung, Freundschaft, Zukunftspläne, Konsum, soziale Medien, Verkehr, Wohnen).
4. "personen": genau 4 Personen, mit unterschiedlichen deutschen Vornamen (Mix aus männlich/weiblich). Jede Aussage: 2-4 Sätze, Ich-Perspektive, wie ein echter Forumspost — konkret, mit eigenem Beispiel oder Grund, nicht generisch.
5. Die 4 Meinungen müssen sich WIRKLICH unterscheiden — mindestens 2 klar gegensätzliche Positionen, nicht 4x die gleiche Meinung mit anderen Worten.
6. "frage_persoenlich": eine Frage nach der eigenen Erfahrung des Schreibers zum Thema, endet mit "Berichte ausführlich." (Beispiele: "Wie sieht es an deiner Schule mit X aus? Berichte ausführlich." / "Hast du X? Berichte ausführlich.")
7. "frage_meinung": eine Bewertungsfrage (oft Ja/Nein), endet mit "Begründe deine Meinung ausführlich." (Beispiele: "Ist X sinnvoll? Begründe deine Meinung ausführlich." / "Sollte man X? Begründe deine Meinung ausführlich.")
8. Escape alle Anführungszeichen innerhalb der Strings korrekt für JSON (\\").
9. NEUES Thema — nicht: Musik, Hausaufgaben, Lesen, Zu-spät-Kommen, Nebenjobs, Haustiere, Gewalt im Fernsehen, Zu Hause mithelfen (schon oft benutzt). "Taschengeld" aus dem Formatbeispiel unten ist NUR zur Strukturreferenz — wähle es NICHT als eigenes Thema.${notaAntiRepeticao(['Musik','Hausaufgaben','Lesen','Zu-spät-Kommen','Nebenjobs','Haustiere','Gewalt im Fernsehen','Zu Hause mithelfen','Taschengeld'])}

BEISPIEL für die korrekte JSON-Struktur (NUR zur Formatreferenz — dieses Thema NICHT verwenden):
{"thema": "Taschengeld", "personen": [{"name": "Finn", "aussage": "Ich bekomme jeden Monat 20 Euro Taschengeld. Das reicht mir eigentlich gut, weil ich nicht so viel kaufe. Nur für neue Fußballschuhe muss ich immer länger sparen."}, {"name": "Mia", "aussage": "Meine Eltern geben mir kein festes Taschengeld. Ich bekomme Geld, wenn ich etwas brauche, zum Beispiel für Kino oder Kleidung. Das finde ich eigentlich besser."}, {"name": "Ben", "aussage": "Ich finde, Taschengeld sollte man sich verdienen. Ich helfe im Garten meiner Oma und bekomme dafür Geld. So lerne ich, dass Geld nicht einfach so kommt."}, {"name": "Lea", "aussage": "Bei uns bekommen alle Geschwister gleich viel Taschengeld, egal wie alt sie sind. Ich finde das unfair, weil meine große Schwester viel mehr Sachen braucht als ich."}], "frage_persoenlich": "Bekommst du Taschengeld oder verdienst du dir dein Geld selbst? Berichte ausführlich.", "frage_meinung": "Sollten Kinder für Hausarbeit Taschengeld bekommen? Begründe deine Meinung ausführlich."}${refBlock}

Erstelle jetzt eine neue Aufgabe nach diesen Regeln.`;

  const raw = await callGemini(prompt, 4000);
  const json = extractJson(raw);
  registrarTemaGerado(json.thema);
  const quelltext = json.personen.map(p => `${p.name}: ${p.aussage}`).join('\n\n');
  const aufgabe = `${json.thema}\n\nIn einem Internetforum gibt es eine Diskussion zum Thema „${json.thema}".\nDu findest hier dazu folgende Aussagen (siehe Sprechblasen oben).\n\n${meta.forumClosing}\n\nBearbeite in deinem Beitrag die folgenden drei Punkte:\n\n• Gib alle vier Aussagen aus dem Internetforum mit eigenen Worten wieder.\n• ${json.frage_persoenlich}\n• ${json.frage_meinung}\n\nDu hast insgesamt 75 Minuten Zeit.\nDu brauchst die Wörter nicht zu zählen.`;
  state.aufgabaObj = { aufgabe, quelltext, personen: json.personen, thema: json.thema };
  $('aufgabeTag').textContent = `${niveauLabel(state.niveau)} · ${meta.label}`;
  $('aufgabeSchwierigkeit').textContent = `Schwierigkeit ${state.schwierigkeit}/8`;
  $('aufgabeText').textContent = aufgabe;
  $('quelltext').style.display = 'none';
  const bal = $('baloes');
  bal.innerHTML = json.personen.map(p => `<div class="balloon"><span class="name">${escapeHtml(p.name)}</span>${escapeHtml(p.aussage)}</div>`).join('');
  bal.style.display = 'grid';
}

if ($('btnGerarIA')) $('btnGerarIA').addEventListener('click', gerarComIA);

/* ---------- Modus-Tabs na config ---------- */
let modusAtual = 'neu';
let msSeleccionado = null;

document.querySelectorAll('.modus-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    modusAtual = tab.dataset.modus;
    document.querySelectorAll('.modus-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    if (modusAtual === 'real') {
      $('blocoNeu').style.display = 'none';
      $('blocoReal').style.display = 'block';
      renderMsPicker();
    } else {
      $('blocoReal').style.display = 'none';
      $('blocoNeu').style.display = 'block';
    }
  });
});

function extrairTema(filename, texto){
  const dash = filename?.match(/–\s*(.+)$/);
  if (dash) return dash[1].trim();
  return texto?.split(/[\.\n]/)[0]?.trim()?.split(' ')[0] || '—';
}

function renderMsPicker(){
  const grid = $('msPickerGrid');
  const grupo = NIVEAU_GROUP[state.niveau];

  // Mostra TODOS os Modellsätze do grupo (B1, C1, etc.)
  // independentemente do tipo — o tipo é determinado pelo próprio Modellsatz
  const lista = state.bank
    .filter(b => NIVEAU_GROUP[b.niveau] === grupo)
    .sort((a,b) => (extrairNumeroModellsatz(a.filename)||99) - (extrairNumeroModellsatz(b.filename)||99));

  if (!lista.length) {
    grid.innerHTML = `<div class="ms-empty">Keine Modellsätze im Banco für das Niveau "${niveauLabel(state.niveau)}". Bitte erst Modellsätze über das Supabase-Dashboard einfügen.</div>`;
    return;
  }
  grid.innerHTML = '';
  lista.forEach(item => {
    const num = extrairNumeroModellsatz(item.filename);
    const tema = extrairTema(item.filename, item.text);
    const tipoLabel = (TEXTSORTEN[item.niveau] || []).find(t => t.key === item.textsorte)?.label || item.textsorte;
    const preview = item.text.replace(/\s+/g,' ').trim().slice(0, 130);
    const card = document.createElement('div');
    card.className = 'ms-card' + (msSeleccionado?.id === item.id ? ' selected' : '');
    card.innerHTML = `
      <span class="ms-num">Modellsatz ${num ?? '—'} · ${escapeHtml(tipoLabel)}</span>
      <div class="ms-thema">${escapeHtml(tema)}</div>
      <div class="ms-preview">${escapeHtml(preview)}&hellip;</div>`;
    card.addEventListener('click', () => {
      msSeleccionado = item;
      // Sincroniza o tipo com o que está no banco
      state.tipoKey = item.textsorte;
      document.querySelectorAll('.ms-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      $('btnToSchreibenReal').disabled = false;
    });
    grid.appendChild(card);
  });
}

/* Nível/Tipo no modo Real — espelha o seletor do modo Neu */
function renderNiveauRowReal(){
  const row = $('niveauRowReal');
  if (!row) return;
  row.innerHTML = '';
  NIVEAUS.forEach(n => {
    const btn = document.createElement('button');
    btn.className = 'niveau-btn' + (n === state.niveau ? ' active' : '');
    btn.textContent = niveauLabel(n);
    btn.addEventListener('click', () => {
      state.niveau = n;
      state.tipoKey = TEXTSORTEN[n][0].key;
      msSeleccionado = null;
      $('btnToSchreibenReal').disabled = true;
      renderNiveauRowReal();
      renderMsPicker();
    });
    row.appendChild(btn);
  });
}

/* Botão "Com esta tarefa escrever" → pula aufgabe, vai direto pra schreiben */
if ($('btnToSchreibenReal')) {
  $('btnToSchreibenReal').addEventListener('click', () => {
    if (!msSeleccionado) return;
    carregarModellsatzReal(msSeleccionado);
    aufgabeVisivel = true;
    renderAufgabeInline();
    $('textInput').value = '';
    state.maxPage = Math.max(state.maxPage, 2);
    goToPage('schreiben');
    iniciarCronometro();
    restaurarRascunho();
    iniciarSalvamentoNuvemPeriodico();
  });
}

function carregarModellsatzReal(item){
  state._modoReal = true;
  const meta = currentMeta();
  const num = extrairNumeroModellsatz(item.filename);
  const tema = extrairTema(item.filename, item.text);

  if (state.niveau === 'B1' && (state.tipoKey === 'beitrag' || state.tipoKey === 'leserbrief')) {
    const linhas = item.text.split(/\n+/);
    const personen = [];
    const pessoaNomeRegex = /^([A-ZÄÖÜ][a-zäöüß]+):\s*(.+)/;
    let aufgabeLinhas = [];
    let dentroAufgabe = false;
    linhas.forEach(l => {
      const m = l.match(pessoaNomeRegex);
      if (m && !dentroAufgabe) {
        personen.push({ name: m[1], aussage: m[2] });
      } else if (l.toLowerCase().includes('schreibe') || l.toLowerCase().includes('bearbeite')) {
        dentroAufgabe = true;
        aufgabeLinhas.push(l);
      } else if (dentroAufgabe) {
        aufgabeLinhas.push(l);
      }
    });
    const aufgabe = aufgabeLinhas.join('\n').trim() || item.text;
    const quelltext = personen.map(p => `${p.name}: ${p.aussage}`).join('\n\n');
    state.aufgabaObj = { aufgabe, quelltext, personen, thema: tema };
    // Popula aufgabe card (usado pelo modal "📋 Aufgabe")
    $('aufgabeTag').textContent = `${niveauLabel(state.niveau)} · ${meta.label} · Modellsatz ${num}`;
    $('aufgabeSchwierigkeit').textContent = 'Echter Modellsatz';
    $('aufgabeText').textContent = aufgabe;
    $('quelltext').style.display = 'none';
    $('refNote').textContent = item.filename;
    if (personen.length) {
      const bal = $('baloes');
      bal.innerHTML = personen.map(p =>
        `<div class="balloon"><span class="name">${escapeHtml(p.name)}</span>${escapeHtml(p.aussage)}</div>`
      ).join('');
      bal.style.display = 'grid';
    } else {
      $('baloes').style.display = 'none';
    }
  } else {
    state.aufgabaObj = { aufgabe: item.text, quelltext: '', thema: tema };
    $('aufgabeTag').textContent = `${niveauLabel(state.niveau)} · ${meta.label} · Modellsatz ${num}`;
    $('aufgabeSchwierigkeit').textContent = 'Echter Modellsatz';
    $('aufgabeText').textContent = item.text;
    $('quelltext').style.display = 'none';
    $('baloes').style.display = 'none';
    $('refNote').textContent = item.filename;
  }
  $('btnToSchreiben').disabled = false;
}
if ($('btnBackToConfig')) $('btnBackToConfig').addEventListener('click', () => {
  if (state.classroomSubmission) return;
  goToPage('config');
});
if ($('btnToSchreiben')) $('btnToSchreiben').addEventListener('click', () => {
  aufgabeVisivel = true;
  renderAufgabeInline();
  $('textInput').value = '';
  state.maxPage = Math.max(state.maxPage, 2);
  goToPage('schreiben');
  iniciarCronometro();
  restaurarRascunho();
  iniciarSalvamentoNuvemPeriodico();
});

/* ---------- Page: schreiben ---------- */
/* ---------- Rascunho automático (localStorage) ---------- */
const DRAFT_KEY = 'sprachio_draft';
let draftSaveTimer = null;

function draftIdAtual(){
  // Identifica a tarefa atual (nível + tipo + tema) pra não misturar rascunhos de tarefas diferentes
  const thema = state.aufgabaObj?.thema || (state.aufgabaObj?.aufgabe || '').slice(0, 40);
  return `${state.niveau}|${state.tipoKey}|${thema}`;
}

function salvarRascunho(){
  const text = $('textInput').value;
  if (!text.trim()) { limparRascunho(); return; }
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      id: draftIdAtual(),
      text,
      savedAt: new Date().toISOString()
    }));
  } catch(e) { /* localStorage indisponível — ignora silenciosamente */ }
}

function restaurarRascunho(){
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (draft.id === draftIdAtual() && draft.text && !$('textInput').value.trim()) {
      $('textInput').value = draft.text;
      updateWordCount();
      mostrarAvisoRascunho();
    }
  } catch(e) { /* ignora */ }
}

function limparRascunho(){
  try { localStorage.removeItem(DRAFT_KEY); } catch(e) {}
}

function mostrarAvisoRascunho(){
  const aviso = document.createElement('div');
  aviso.textContent = '📝 Rascunho automaticamente wiederhergestellt';
  aviso.style.cssText = 'font-size:0.78rem;color:var(--ok);margin-bottom:10px;';
  const wrap = $('textInput')?.closest('.schreibfeld-wrap');
  if (wrap) wrap.insertBefore(aviso, wrap.firstChild);
  setTimeout(() => aviso.remove(), 4000);
}

/* ---------- Rascunho na nuvem (retomar de qualquer dispositivo, com cronômetro pausado) ---------- */
let cloudDraftInterval = null;

async function salvarRascunhoNuvem(){
  if (!_session?.user?.id) { console.warn('[Rascunho-Nuvem] sem sessão de usuário — não salva.'); return; }
  const texto = $('textInput')?.value || '';
  if (!texto.trim() || !state.aufgabaObj) return;
  try {
    const res = await sbFetch('rascunhos', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id: _session.user.id,
        niveau: state.niveau,
        tipo_key: state.tipoKey,
        schwierigkeit: state.schwierigkeit,
        aufgaba_obj: state.aufgabaObj,
        texto,
        segundos_restantes: timerSeconds,
        atualizado_em: new Date().toISOString()
      })
    });
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      console.error('[Rascunho-Nuvem] Fehler beim Speichern — Tabelle "rascunhos" existiert? RLS korrekt?', res.status, detalhe);
      return;
    }
    mostrarIndicadorSalvo();
  } catch(e) { console.error('[Rascunho-Nuvem] Netzwerkfehler beim Speichern:', e); }
}

function mostrarIndicadorSalvo(){
  let ind = $('rascunhoSalvoIndicador');
  if (!ind) {
    ind = document.createElement('div');
    ind.id = 'rascunhoSalvoIndicador';
    ind.className = 'rascunho-salvo-indicador';
    document.body.appendChild(ind);
  }
  ind.textContent = '☁️ Gespeichert';
  ind.classList.add('show');
  clearTimeout(ind._timeout);
  ind._timeout = setTimeout(() => ind.classList.remove('show'), 1800);
}

async function apagarRascunhoNuvem(){
  if (!_session?.user?.id) return;
  try {
    await sbFetch(`rascunhos?user_id=eq.${_session.user.id}`, { method: 'DELETE' });
  } catch(e) { /* ignora */ }
}

function iniciarSalvamentoNuvemPeriodico(){
  clearInterval(cloudDraftInterval);
  cloudDraftInterval = setInterval(salvarRascunhoNuvem, 20000); // a cada 20s
  document.addEventListener('visibilitychange', salvarAoTrocarAba);
}

function pararSalvamentoNuvemPeriodico(){
  clearInterval(cloudDraftInterval);
  document.removeEventListener('visibilitychange', salvarAoTrocarAba);
}

function salvarAoTrocarAba(){
  // Dispara quando o usuário troca de aba, minimiza ou fecha — mais confiável que só o intervalo
  if (document.visibilityState === 'hidden') salvarRascunhoNuvem();
}

async function verificarRascunhoNuvem(){
  if (!_session?.user?.id) return null;
  try {
    const res = await sbFetch(`rascunhos?user_id=eq.${_session.user.id}&select=*&limit=1`);
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      console.error('[Rascunho-Nuvem] Fehler beim Laden — Tabelle "rascunhos" existiert? RLS korrekt?', res.status, detalhe);
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch(e) { console.error('[Rascunho-Nuvem] Netzwerkfehler beim Laden:', e); return null; }
}

function renderAvisoRascunhoNuvem(rascunho){
  const box = $('rascunhoNuvemBox');
  if (!box) return;
  if (!rascunho) { box.style.display = 'none'; return; }

  const tema = rascunho.aufgaba_obj?.thema || (rascunho.aufgaba_obj?.aufgabe || '').slice(0, 60) || '—';
  const minutosAtras = Math.max(0, Math.round((Date.now() - new Date(rascunho.atualizado_em).getTime()) / 60000));
  const tempoTexto = minutosAtras < 60 ? `vor ${minutosAtras} Min.` : `vor ${Math.round(minutosAtras/60)} Std.`;

  box.style.display = 'block';
  box.innerHTML = `
    <div class="rascunho-nuvem-card">
      <div class="rascunho-nuvem-txt">
        <strong>📝 Unfertiger Text gefunden</strong>
        <span>${escapeHtml(niveauLabel(rascunho.niveau))} · ${escapeHtml(tema)} · ${tempoTexto}</span>
      </div>
      <div class="rascunho-nuvem-btns">
        <button class="ghost" id="btnDescartarRascunho">Verwerfen</button>
        <button class="primary" id="btnFortsetzenRascunho">Fortsetzen →</button>
      </div>
    </div>`;

  $('btnFortsetzenRascunho').addEventListener('click', () => retomarRascunhoNuvem(rascunho));
  $('btnDescartarRascunho').addEventListener('click', async () => {
    await apagarRascunhoNuvem();
    box.style.display = 'none';
  });
}

function retomarRascunhoNuvem(rascunho){
  state.niveau = rascunho.niveau;
  state.tipoKey = rascunho.tipo_key;
  state.schwierigkeit = rascunho.schwierigkeit || 4;
  state.aufgabaObj = rascunho.aufgaba_obj;
  state.classroomSubmission = !!rascunho.aufgaba_obj?.classroom;

  const classroomContext = $('classroomContext');
  if (classroomContext) {
    if (state.classroomSubmission) {
      const turma = rascunho.aufgaba_obj?.turma_nome || 'Sua turma';
      classroomContext.innerHTML = '<strong>Atividade da sua turma</strong><span>' + escapeHtml(turma) + ' · ' + escapeHtml(niveauLabel(state.niveau)) + '</span>';
      classroomContext.style.display = 'block';
    } else {
      classroomContext.style.display = 'none';
    }
  }

  renderNiveauRow();
  renderTeileRow();
  if ($('diffSlider')) { $('diffSlider').value = state.schwierigkeit; $('diffVal').textContent = state.schwierigkeit; }

  aufgabeVisivel = true;
  renderAufgabeInline();
  $('textInput').value = rascunho.texto || '';
  updateWordCount();

  state.maxPage = Math.max(state.maxPage, 2);
  goToPage('schreiben');
  iniciarCronometro(rascunho.segundos_restantes);
  iniciarSalvamentoNuvemPeriodico();

  if ($('rascunhoNuvemBox')) $('rascunhoNuvemBox').style.display = 'none';
  const freePracticeButton = $('btnGerarIA');
  if (freePracticeButton) {
    freePracticeButton.style.display = state.classroomSubmission ? 'none' : '';
  }
  const classNote = $('classroomContext');
  if (classNote && state.classroomSubmission) classNote.style.display = 'block';
}

function updateWordCount(){
  const text = $('textInput').value.trim();
  const count = text ? text.split(/\s+/).length : 0;
  $('wortzahlEl').textContent = count + ' Wörter';
}
if ($('textInput')) $('textInput').addEventListener('input', () => {
  updateWordCount();
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(salvarRascunho, 800);
});
if ($('btnBackToAufgabe')) $('btnBackToAufgabe').addEventListener('click', () => { pararSalvamentoNuvemPeriodico(); goToPage('aufgabe'); });
async function enviarEntregaTurma(text) {
  if (!_session?.user?.id || !state.aufgabaObj?.aufgabe_id || !state.aufgabaObj?.turma_id) {
    throw new Error('A atividade da turma não pôde ser identificada.');
  }

  const res = await sbFetch('entregas_turma', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      tarefa_id: state.aufgabaObj.aufgabe_id,
      turma_id: state.aufgabaObj.turma_id,
      aluno_id: _session.user.id,
      aluno_email: _session.user.email || null,
      texto: text,
      status: 'enviada'
    })
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error('Entrega HTTP ' + res.status + ': ' + detalhe);
  }
}

function mostrarEntregaEnviada() {
  $('loadingResult').style.display = 'none';
  $('feedback').style.display = 'none';
  const aviso = $('entregaEnviada');
  if (aviso) aviso.style.display = 'block';
}

if ($('btnSenden')) $('btnSenden').addEventListener('click', async () => {
  const text = $('textInput').value.trim();
  if (!text) return;
  pararCronometro();
  limparRascunho();
  pararSalvamentoNuvemPeriodico();
  await apagarRascunhoNuvem();
  state._textoEnviado = text;
  state.maxPage = Math.max(state.maxPage, 3);
  goToPage('korrektur');

  if (state.classroomSubmission) {
    $('loadingResult').style.display = 'block';
    $('loadingResult').querySelector('.spin')?.remove();
    $('loadingResult').innerHTML = '<div style="font-size:1.2rem;margin-bottom:8px;">✓</div><strong>Enviando para o professor…</strong>';
    try {
      await enviarEntregaTurma(text);
      mostrarEntregaEnviada();
    } catch (e) {
      console.error(e);
      $('loadingResult').innerHTML = '<div style="color:var(--err);">Não foi possível enviar a atividade. Tente novamente.</div>';
    }
    return;
  }

  $('loadingResult').style.display = 'block';
  $('feedback').style.display = 'none';
  await runKorrektur(text);
});

/* ---------- Page: korrektur ---------- */
async function runKorrektur(text){
  if (state.niveau === 'B1') {
    await runKorrekturDSD1(text);
  } else if (state.niveau === 'A2') {
    await runKorrekturIVA2(text);
  } else {
    await runKorrekturGenerico(text);
  }
}

/* ============================================================
   IVA 2 (A2) — Superprompt oficial, baseado nos "Ausführungs-
   bestimmungen für die Internationalen schulischen Vergleichs-
   arbeiten der ZfA" (Stand 2020), Kapitel 5.2.2 "Bewertungs-
   kriterien für die Schriftliche Kommunikation IVA 2".
   5 Kriterien, Skala 4-3-2-1-0 pro Kriterium, max. 20 Punkte.
   A2 nach GER gilt als erreicht ab 12 Punkten.
   ============================================================ */
async function runKorrekturIVA2(text){
  const meta = currentMeta();
  const quelltextInfo = state.aufgabaObj.quelltext ? `\nAusgangstext: ${state.aufgabaObj.quelltext}` : '';

  const prompt = `Du bist eine erfahrene DaF-Lehrkraft und Prüferin für die "Internationale schulische Vergleichsarbeit 2" (IVA 2) der ZfA (Zentralstelle für das Auslandsschulwesen). Du bewertest streng nach den offiziellen Bewertungskriterien für die Schriftliche Kommunikation IVA 2 (Ausführungsbestimmungen, Stand 2020), aber stets wohlwollend und altersgerecht für Schüler/innen von 12-14 Jahren (Klassenstufe 7-8).

AUFGABE: Bewerte die folgende Schülerarbeit (persönliche E-Mail, Antwort auf vier Arbeitsaufträge) nach den fünf offiziellen Kriterien.

PRÜFUNGSAUFGABE:
Aufgabentext: ${state.aufgabaObj.aufgabe}${quelltextInfo}

SCHÜLERTEXT:
"""
${text}
"""

BEWERTUNGSKRITERIEN (jeweils 4-3-2-1-0 Punkte, max. 20 Punkte gesamt):

1. TEXTAUFBAU (0-4): Bei 4 Punkten entspricht der Text vollständig der geforderten Textsorte (Anrede, Adressatenbezug, Schlussformel) und die Schreibsituation (Antwortmail) ist eindeutig klar. Bei 0 Punkten wird die Textsorte nicht beachtet, die Schreibsituation bleibt unklar. Dazwischen abgestuft.

2. INHALT (0-4): Bei 4 Punkten sind alle vier Arbeitsaufträge ausführlich beantwortet. Bei 2 Punkten sind entweder alle Punkte nur kurz beantwortet, oder zwei ausführlich und zwei nur kurz. Bei 0 Punkten sind zwei oder mehr Punkte unbearbeitet. WICHTIG: Wenn das Thema völlig verfehlt wird, erhält der gesamte Teil SK 0 Punkte insgesamt (Sonderregel).

3. VERFÜGBARKEIT SPRACHLICHER MITTEL (0-4): Bei 4 Punkten drückt sich der Schüler mit seinem Wortschatz (Substantive, Verben, Adjektive) angemessen zu den geforderten Punkten aus, verwendet Hauptsätze und einfache Nebensätze (weil, dass, wenn), Modalverben, Inversion, Zeit-/Ortsangaben, passende Zeitformen, Frage- und Ausrufesätze. Bei 0 Punkten sind Wortschatz und Strukturen so begrenzt, dass die Aufgabe nicht bewältigt werden kann. Kalibriere den erwarteten Wortschatz an ${wortlisteHinweis('A2')}.

4. GRAMMATIK (0-4): Bei 4 Punkten verwendet der Schüler einfache grammatische Mittel überwiegend korrekt (Präsens, Perfekt, Präteritum der Hilfs-/Modalverben, Konnektoren, Artikel, Pluralbildung, Deklination, Inversion) — Fehler beeinträchtigen die Verständlichkeit nicht. Bei 0 Punkten ist der Text wegen zu vieler Fehler nur mit Mühe verständlich.

5. ORTHOGRAFIE (0-4): Bei 4 Punkten schreibt der Schüler vertraute Wörter orthografisch richtig und verwendet einfache Satzzeichen korrekt. Bei 0 Punkten beeinträchtigen zahlreiche Rechtschreib-/Interpunktionsfehler die Verständlichkeit.

NIVEAUEINSCHÄTZUNG: A2 nach GER gilt für die Schriftliche Kommunikation als erreicht, wenn insgesamt mindestens 12 von 20 Punkten erzielt werden.

WICHTIGE GRUNDSÄTZE:
- Wohlwollende Bewertung, altersgerecht (12-14 Jahre)
- Jede Punktevergabe mit konkreten Textbelegen begründen
- Bei Grenzfällen transparent erläutern

Antworte NUR mit einem einzigen JSON-Objekt, keine Einleitung, keine Markdown-Backticks. Alle Felder auf Deutsch. Format:
{
  "schritt2_bewertung": {
    "textaufbau":          {"punkte": 0, "begruendung": "...", "belege_positiv": ["..."], "belege_schwach": ["..."]},
    "inhalt":              {"punkte": 0, "begruendung": "...", "belege_positiv": ["..."], "belege_schwach": ["..."]},
    "sprachliche_mittel":  {"punkte": 0, "begruendung": "...", "belege_positiv": ["..."], "belege_schwach": ["..."]},
    "grammatik":           {"punkte": 0, "begruendung": "...", "belege_positiv": ["..."], "belege_schwach": ["..."]},
    "orthografie":         {"punkte": 0, "begruendung": "...", "belege_positiv": ["..."], "belege_schwach": ["..."]}
  },
  "schritt3_belegsammlung": {
    "gesamtpunkte": 0,
    "max_punkte": 20,
    "niveaueinschaetzung": "A2 nach GER erreicht" | "A2 nach GER noch nicht erreicht (knapp)" | "A2 nach GER noch nicht erreicht",
    "niveaubegruendung": "..."
  },
  "schritt4_sprachanalyse": {
    "grammatikfehler": [{"original": "...", "zielstruktur": "...", "kategorie": "Satzstellung|Kasus|Artikel|Verbformen|Zeitform"}],
    "orthografiefehler": [{"original": "...", "zielschreibung": "..."}]
  },
  "schritt5_feedback": {
    "gut_gelungen": ["...", "...", "..."],
    "verbessern": ["...", "...", "..."],
    "naechstes_lernziel": "..."
  },
  "vokabelkarten": [{"wort": "...", "bedeutung": "kurze Erklärung/Übersetzung auf Deutsch", "beispiel": "Beispielsatz mit dem Wort"}]
}
"vokabelkarten": maximal 5 nützliche Vokabeln zum Wiederholen. Begrenze "grammatikfehler" und "orthografiefehler" auf jeweils maximal 6 Einträge (wichtigste zuerst). Halte "begruendung" kurz und prägnant.`;

  try {
    const raw = await callGemini(prompt, 6000);
    const json = extractJson(raw);
    renderFeedbackIVA2(json);
    const feedbackSimples = {
      niveau_einschaetzung: json.schritt3_belegsammlung?.niveaueinschaetzung || '—',
      status: json.schritt3_belegsammlung?.niveaueinschaetzung || '—',
      erfuellung: json.schritt2_bewertung?.inhalt?.begruendung || '',
      aufbau: json.schritt2_bewertung?.textaufbau?.begruendung || '',
      sprache: json.schritt2_bewertung?.grammatik?.begruendung || '',
      tipp: json.schritt5_feedback?.naechstes_lernziel || '',
      korrekturen: (json.schritt4_sprachanalyse?.grammatikfehler || []).map(f => ({
        original: f.original, korrektur: f.zielstruktur, erklaerung: f.kategorie
      }))
    };
    await salvarHistorico(state._textoEnviado || '', feedbackSimples, json.vokabelkarten);
  } catch(e) {
    console.error(e);
    $('loadingResult').style.display = 'none';
    $('feedback').style.display = 'block';
    $('fbErfuellung').textContent = mensagemErroAmigavel(e);
  }
}

function renderFeedbackIVA2(json){
  const s2 = json.schritt2_bewertung || {};
  const s3 = json.schritt3_belegsammlung || {};
  const s4 = json.schritt4_sprachanalyse || {};
  const s5 = json.schritt5_feedback || {};

  $('stampNiveau').textContent = s3.niveaueinschaetzung || '—';
  $('stampTag').textContent = `${s3.gesamtpunkte ?? '?'} / ${s3.max_punkte ?? 20} Punkte`;

  const kategorien = [
    { key:'textaufbau',         label:'Textaufbau' },
    { key:'inhalt',             label:'Inhalt' },
    { key:'sprachliche_mittel', label:'Sprachliche Mittel' },
    { key:'grammatik',          label:'Gramática' },
    { key:'orthografie',        label:'Ortografia' },
  ];
  let bewertungHTML = `<table class="fb-table"><thead><tr><th>Kategorie</th><th>Pkt</th><th>Begründung</th></tr></thead><tbody>`;
  let gesamtPunkte = 0;
  kategorien.forEach(k => {
    const kat = s2[k.key] || {};
    const p = kat.punkte ?? '?';
    if (typeof p === 'number') gesamtPunkte += p;
    const pos = (kat.belege_positiv || []).map(b => `<span class="beleg-pos">✓ ${escapeHtml(b)}</span>`).join('');
    const neg = (kat.belege_schwach || []).map(b => `<span class="beleg-neg">✗ ${escapeHtml(b)}</span>`).join('');
    bewertungHTML += `<tr><td class="kat-name">${k.label}</td><td class="kat-punkte">${p}/4</td><td>${escapeHtml(kat.begruendung||'')}${pos?'<br>'+pos:''}${neg?'<br>'+neg:''}</td></tr>`;
  });
  bewertungHTML += `<tr class="gesamt-row"><td colspan="2"><strong>Gesamt</strong></td><td><strong>${s3.gesamtpunkte ?? gesamtPunkte} / 20</strong></td></tr></tbody></table>`;
  $('fbErfuellung').innerHTML = bewertungHTML;

  $('fbAufbau').innerHTML = `<strong>${escapeHtml(s3.niveaueinschaetzung||'—')}</strong> — ${escapeHtml(s3.niveaubegruendung||'')}`;

  let analyseHTML = '';
  if ((s4.grammatikfehler||[]).length) {
    analyseHTML += '<strong>✗ Erros de gramática</strong><ul class="analyse-list">';
    (s4.grammatikfehler||[]).forEach(f => { analyseHTML += `<li><span class="orig">${escapeHtml(f.original)}</span> → <span class="korr">${escapeHtml(f.zielstruktur)}</span><span class="erkl">${escapeHtml(f.kategorie)}</span></li>`; });
    analyseHTML += '</ul>';
  }
  if ((s4.orthografiefehler||[]).length) {
    analyseHTML += '<strong>✗ Erros de ortografia</strong><ul class="analyse-list">';
    (s4.orthografiefehler||[]).forEach(f => { analyseHTML += `<li><span class="orig">${escapeHtml(f.original)}</span> → <span class="korr">${escapeHtml(f.zielschreibung)}</span></li>`; });
    analyseHTML += '</ul>';
  }
  $('fbSprache').innerHTML = analyseHTML || '—';

  const list = $('korrekturenList');
  list.innerHTML = '';
  (s5.gut_gelungen || []).forEach(g => { const li = document.createElement('li'); li.innerHTML = `<span class="korr">✓</span> ${escapeHtml(g)}`; list.appendChild(li); });
  (s5.verbessern || []).forEach(v => { const li = document.createElement('li'); li.innerHTML = `<span class="orig">→</span> ${escapeHtml(v)}`; list.appendChild(li); });

  $('fbTip').textContent = 'Próximo objetivo: ' + (s5.naechstes_lernziel || '');
  $('loadingResult').style.display = 'none';
  $('feedback').style.display = 'block';
  const stamp = $('stamp');
  stamp.style.animation = 'none'; stamp.offsetHeight; stamp.style.animation = null;
}

/* ============================================================
   DSD I (B1) — Superprompt oficial, 5 Schritte, 8 Kategorien
   ============================================================ */
async function runKorrekturDSD1(text){
  const meta = currentMeta();
  const quelltextInfo = state.aufgabaObj.quelltext
    ? `\nForum-Aussagen/Ausgangstext:\n${state.aufgabaObj.quelltext}` : '';
  const personenInfo = state.aufgabaObj.personen
    ? `\nForum-Personen: ${state.aufgabaObj.personen.map(p=>`${p.name}: ${p.aussage}`).join(' | ')}` : '';

  const prompt = `Du bist eine erfahrene DaF-Lehrkraft sowie DSD-I-Prüferin mit umfassender Erfahrung in der Korrektur und Kalibrierung von Schülertexten. Du arbeitest streng nach den offiziellen Bewertungskriterien der Schriftlichen Kommunikation (DSD I, Anlage 12), bewertest jedoch stets wohlwollend und niveaugerecht auf A2/B1-Niveau.

AUFGABE: Analysiere und bewerte die folgende Schülerarbeit zur Schriftlichen Kommunikation im DSD I in fünf Schritten.

PRÜFUNGSAUFGABE:
Textsorte: ${meta.label}
Niveau: DSD I (B1)${quelltextInfo}${personenInfo}
Aufgabentext: ${state.aufgabaObj.aufgabe}

SCHÜLERTEXT:
"""
${text}
"""

WICHTIGE BEWERTUNGSGRUNDSÄTZE:
- DSD-I-Niveau (A2/B1) als Maßstab
- Wohlwollende Bewertung
- Verständlichkeit hat Vorrang vor Fehlerfreiheit
- Strukturen (Kategorie 6) und Grammatik (Kategorie 7) STRIKT GETRENNT bewerten — Strukturen = Vielfalt und Angemessenheit, Grammatik = Korrektheit
- Bei Kategorie 5 (Wortschatz): Vergleiche den verwendeten Wortschatz mit ${wortlisteHinweis('B1')}. Wörter deutlich darüber sind kein Fehler (im Gegenteil, das kann positiv erwähnt werden), aber wenn der Wortschatz spürbar unter dem B1-Niveau bleibt, erwähne das in der Begründung.
- Jede Punktevergabe mit konkreten Textbelegen begründen
- Bei Grenzfällen transparent erläutern

Antworte NUR mit einem einzigen JSON-Objekt, keine Einleitung, keine Markdown-Backticks. Alle Felder auf Deutsch. Format:
{
  "schritt2_bewertung": {
    "gesamteindruck":     {"punkte": 0, "begruendung": "...", "belege_positiv": ["'...'"], "belege_schwach": ["'...'"]},
    "wiedergabe":         {"punkte": 0, "begruendung": "...", "belege_positiv": [], "belege_schwach": []},
    "eigene_erfahrungen": {"punkte": 0, "begruendung": "...", "belege_positiv": [], "belege_schwach": []},
    "eigene_meinung":     {"punkte": 0, "begruendung": "...", "belege_positiv": [], "belege_schwach": []},
    "wortschatz":         {"punkte": 0, "begruendung": "...", "belege_positiv": [], "belege_schwach": []},
    "strukturen":         {"punkte": 0, "begruendung": "WICHTIG: nur Vielfalt/Angemessenheit, NICHT grammatische Korrektheit", "belege_positiv": [], "belege_schwach": []},
    "grammatik":          {"punkte": 0, "begruendung": "WICHTIG: nur Korrektheit (Satzstellung, Kasus, Verbformen, Kongruenz, Artikel), NICHT Vielfalt", "belege_positiv": [], "belege_schwach": []},
    "orthografie":        {"punkte": 0, "begruendung": "...", "belege_positiv": [], "belege_schwach": []}
  },
  "schritt3_belegsammlung": {
    "gesamtpunkte": 0,
    "max_punkte": 24,
    "niveaueinschaetzung": "A2 | A2+ | B1 knapp erreicht | B1 erreicht | B1 sicher erreicht",
    "niveaubegruendung": "..."
  },
  "schritt4_sprachanalyse": {
    "gelungene_strukturen": [{"typ": "weil-Satz", "beleg": "'...'"}],
    "grammatikfehler": [{"original": "...", "zielstruktur": "...", "kategorie": "Satzstellung|Kasus|Artikel|Verbformen|Nebensatzstellung"}],
    "orthografiefehler": [{"original": "...", "zielschreibung": "..."}],
    "wortschatz": {"positiv": ["..."], "auffaelligkeiten": ["..."]}
  },
  "schritt5_feedback": {
    "gut_gelungen": ["...", "...", "..."],
    "verbessern": ["...", "...", "..."],
    "naechstes_lernziel": "..."
  },
  "vokabelkarten": [{"wort": "...", "bedeutung": "kurze Erklärung/Übersetzung auf Deutsch", "beispiel": "Beispielsatz mit dem Wort"}]
}
Punkte pro Kategorie: 0-3. Gesamt: max 24 Punkte. Halte "begruendung" und die "belege"-Einträge KURZ und PRÄGNANT (max. 1-2 Sätze), um Platz zu sparen.
"vokabelkarten": maximal 5 nützliche Vokabeln zum Wiederholen — entweder falsch verwendete Wörter (korrigiert) oder thematisch passende neue Wörter, die der Schüler noch lernen sollte.
Begrenze "grammatikfehler" und "orthografiefehler" auf jeweils maximal 6 Einträge (wichtigste zuerst), um die Antwort nicht zu lang werden zu lassen.`;

  try {
    const raw = await callGemini(prompt, 8000);
    const json = extractJson(raw);
    renderFeedbackDSD1(json);
    const feedbackSimples = {
      niveau_einschaetzung: json.schritt3_belegsammlung?.niveaueinschaetzung || '—',
      status: json.schritt3_belegsammlung?.niveaueinschaetzung || '—',
      erfuellung: json.schritt2_bewertung?.gesamteindruck?.begruendung || '',
      aufbau: json.schritt2_bewertung?.strukturen?.begruendung || '',
      sprache: json.schritt2_bewertung?.grammatik?.begruendung || '',
      tipp: json.schritt5_feedback?.naechstes_lernziel || '',
      korrekturen: (json.schritt4_sprachanalyse?.grammatikfehler || []).map(f => ({
        original: f.original, korrektur: f.zielstruktur, erklaerung: f.kategorie
      }))
    };
    await salvarHistorico(state._textoEnviado || '', feedbackSimples, json.vokabelkarten);
  } catch(e) {
    console.error(e);
    $('loadingResult').style.display = 'none';
    $('feedback').style.display = 'block';
    $('fbErfuellung').textContent = mensagemErroAmigavel(e);
  }
}

/* ============================================================
   IVA 2 (A2) und DSD II (B2/C1) — Korrektur PROVISÓRIA.
   TODO: substituir por prompts oficiais assim que o usuário os enviar
   (mesmo modelo do superprompt DSD I, mas com os critérios corretos
   para IVA 2 e DSD II).
   ============================================================ */
async function runKorrekturGenerico(text){
  const meta = currentMeta();
  const quelltextInfo = state.aufgabaObj.quelltext ? `\nAusgangstext/Grafikbeschreibung: ${state.aufgabaObj.quelltext}` : '';

  const prompt = `Du bist ein erfahrener Prüfer für Deutsch als Fremdsprache. Bewerte folgenden Schülertext für die Textsorte "${meta.label}" auf Zielniveau DSD II (Niveau B2/C1) (Schwierigkeitsgrad der Aufgabe: ${state.schwierigkeit}/8). Sei präzise und schnell, keine langen Einleitungen.

HINWEIS: Dies ist eine vorläufige, allgemeine Korrektur (kein offizielles Bewertungsraster für dieses Prüfungsformat).

Wortschatz-Kalibrierung: Bewerte den verwendeten Wortschatz auch im Vergleich zu ${wortlisteHinweis('C1')} — erwähne im "sprache"-Feld, ob der Wortschatz spürbar über, unter oder genau auf diesem Niveau liegt.

Aufgabe: ${state.aufgabaObj.aufgabe}${quelltextInfo}
Schülertext:
"""
${text}
"""
Antworte NUR mit einem JSON-Objekt, keine Einleitung, keine Markdown-Backticks, auf Deutsch, kurz und konkret. Format:
{"niveau_einschaetzung": "geschätztes tatsächliches Niveau des Textes", "status": "erreicht" | "knapp erreicht" | "noch nicht erreicht" | "übertroffen", "erfuellung": "1-2 Sätze zur Aufgabenerfüllung", "aufbau": "1-2 Sätze zu Struktur/Konnektoren", "sprache": "1-2 Sätze zu Wortschatz und Grammatik", "korrekturen": [{"original":"kurzer fehlerhafter Ausschnitt","korrektur":"korrigierte Version","erklaerung":"kurze Erklärung"}], "tipp": "ein konkreter nächster Schritt", "vokabelkarten": [{"wort": "...", "bedeutung": "kurze Erklärung/Übersetzung auf Deutsch", "beispiel": "Beispielsatz mit dem Wort"}]}
"vokabelkarten": 3-5 nützliche Vokabeln zum Wiederholen — entweder falsch verwendete Wörter (korrigiert) oder thematisch passende neue Wörter.
Maximal 6 Korrekturen, wichtigste zuerst.`;

  try {
    const raw = await callGemini(prompt, 3800);
    const json = extractJson(raw);
    renderFeedbackGenerico(json);
    await salvarHistorico(state._textoEnviado || '', json, json.vokabelkarten);
  } catch(e) {
    console.error(e);
    $('loadingResult').style.display = 'none';
    $('feedback').style.display = 'block';
    $('fbErfuellung').textContent = mensagemErroAmigavel(e);
  }
}

function renderFeedbackGenerico(json){
  $('stampNiveau').textContent = json.niveau_einschaetzung || '—';
  $('stampTag').textContent = json.status || '';

  $('fbErfuellung').innerHTML = `<p style="margin:0;font-size:0.94rem;line-height:1.6;color:var(--ink-soft);">${escapeHtml(json.erfuellung || '')}</p>
    <p style="margin-top:10px;font-size:0.76rem;color:var(--warn);">⚠ Vorläufige Korrektur — offizielles Bewertungsraster für dieses Format folgt.</p>`;
  $('fbAufbau').innerHTML = escapeHtml(json.aufbau || '');
  $('fbSprache').innerHTML = `<p style="margin:0;font-size:0.94rem;line-height:1.6;color:var(--ink-soft);">${escapeHtml(json.sprache || '')}</p>`;

  const list = $('korrekturenList');
  list.innerHTML = '';
  (json.korrekturen || []).forEach(k => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="orig">${escapeHtml(k.original)}</span> → <span class="korr">${escapeHtml(k.korrektur)}</span><span class="erkl">${escapeHtml(k.erklaerung)}</span>`;
    list.appendChild(li);
  });

  $('fbTip').textContent = '→ ' + (json.tipp || '');

  $('loadingResult').style.display = 'none';
  $('feedback').style.display = 'block';
  const stamp = $('stamp');
  stamp.style.animation = 'none'; stamp.offsetHeight; stamp.style.animation = null;
}

function renderFeedbackDSD1(json){
  const s2 = json.schritt2_bewertung || {};
  const s3 = json.schritt3_belegsammlung || {};
  const s4 = json.schritt4_sprachanalyse || {};
  const s5 = json.schritt5_feedback || {};

  // Carimbo
  $('stampNiveau').textContent = s3.niveaueinschaetzung || '—';
  $('stampTag').textContent = `${s3.gesamtpunkte ?? '?'} / ${s3.max_punkte ?? 24} Punkte`;

  // Seção 1: Bewertung (8 categorias em tabela)
  const kategorien = [
    { key:'gesamteindruck',     label:'Gesamteindruck' },
    { key:'wiedergabe',         label:'Reprodução do conteúdo' },
    { key:'eigene_erfahrungen', label:'Experiências pessoais' },
    { key:'eigene_meinung',     label:'Opinião pessoal' },
    { key:'wortschatz',         label:'Vocabulário' },
    { key:'strukturen',         label:'Estruturas' },
    { key:'grammatik',          label:'Gramática' },
    { key:'orthografie',        label:'Ortografia' },
  ];

  let bewertungHTML = `<table class="fb-table"><thead><tr><th>Kategorie</th><th>Pkt</th><th>Begründung</th></tr></thead><tbody>`;
  let gesamtPunkte = 0;
  kategorien.forEach(k => {
    const kat = s2[k.key] || {};
    const p = kat.punkte ?? '?';
    if (typeof p === 'number') gesamtPunkte += p;
    const pos = (kat.belege_positiv || []).map(b => `<span class="beleg-pos">✓ ${escapeHtml(b)}</span>`).join('');
    const neg = (kat.belege_schwach || []).map(b => `<span class="beleg-neg">✗ ${escapeHtml(b)}</span>`).join('');
    bewertungHTML += `<tr>
      <td class="kat-name">${k.label}</td>
      <td class="kat-punkte">${p}/3</td>
      <td>${escapeHtml(kat.begruendung||'')}${pos?'<br>'+pos:''}${neg?'<br>'+neg:''}</td>
    </tr>`;
  });
  bewertungHTML += `<tr class="gesamt-row"><td colspan="2"><strong>Gesamt</strong></td><td><strong>${s3.gesamtpunkte ?? gesamtPunkte} / 24</strong></td></tr></tbody></table>`;
  $('fbErfuellung').innerHTML = bewertungHTML;

  // Seção 2: Niveaueinschätzung
  $('fbAufbau').innerHTML = `<strong>${escapeHtml(s3.niveaueinschaetzung||'—')}</strong> — ${escapeHtml(s3.niveaubegruendung||'')}`;

  // Seção 3: Sprachanalyse
  let analyseHTML = '';

  // Gelungene Strukturen
  if ((s4.gelungene_strukturen||[]).length) {
    analyseHTML += '<strong>✓ Estruturas bem utilizadas</strong><ul class="analyse-list">';
    (s4.gelungene_strukturen||[]).forEach(g => {
      analyseHTML += `<li><em>${escapeHtml(g.typ)}</em> — ${escapeHtml(g.beleg)}</li>`;
    });
    analyseHTML += '</ul>';
  }

  // Grammatikfehler
  if ((s4.grammatikfehler||[]).length) {
    analyseHTML += '<strong>✗ Erros de gramática</strong><ul class="analyse-list">';
    (s4.grammatikfehler||[]).forEach(f => {
      analyseHTML += `<li><span class="orig">${escapeHtml(f.original)}</span> → <span class="korr">${escapeHtml(f.zielstruktur)}</span><span class="erkl">${escapeHtml(f.kategorie)}</span></li>`;
    });
    analyseHTML += '</ul>';
  }

  // Orthografiefehler
  if ((s4.orthografiefehler||[]).length) {
    analyseHTML += '<strong>✗ Erros de ortografia</strong><ul class="analyse-list">';
    (s4.orthografiefehler||[]).forEach(f => {
      analyseHTML += `<li><span class="orig">${escapeHtml(f.original)}</span> → <span class="korr">${escapeHtml(f.zielschreibung)}</span></li>`;
    });
    analyseHTML += '</ul>';
  }

  $('fbSprache').innerHTML = analyseHTML || '—';

  // Seção 4: Korrekturen list -> reutiliza pra Schülerfeedback
  const list = $('korrekturenList');
  list.innerHTML = '';
  const gut = s5.gut_gelungen || [];
  const verb = s5.verbessern || [];
  gut.forEach(g => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="korr">✓</span> ${escapeHtml(g)}`;
    list.appendChild(li);
  });
  verb.forEach(v => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="orig">→</span> ${escapeHtml(v)}`;
    list.appendChild(li);
  });

  $('fbTip').textContent = 'Próximo objetivo: ' + (s5.naechstes_lernziel || '');

  $('loadingResult').style.display = 'none';
  $('feedback').style.display = 'block';
  const stamp = $('stamp');
  stamp.style.animation = 'none'; stamp.offsetHeight; stamp.style.animation = null;
}
/* ---------- Musterlösung (texto-modelo pra comparar) ---------- */
if ($('btnMusterloesung')) $('btnMusterloesung').addEventListener('click', async () => {
  const btn = $('btnMusterloesung');
  btn.disabled = true;
  btn.textContent = 'Criando…';
  $('musterloesungResult').innerHTML = '';
  const meta = currentMeta();
  const prompt = `Du bist DaF-Lehrkraft. Schreibe eine vorbildliche Musterlösung (Beispieltext) für folgende Aufgabe auf Niveau ${niveauLabel(state.niveau)} (Textsorte: ${meta.label}):

${state.aufgabaObj?.aufgabe || ''}

Der Text soll ein realistisches, gut geschriebenes Beispiel für dieses Niveau sein — nicht perfekt-akademisch, sondern wie ein starker Schüler auf diesem Niveau schreiben würde. Antworte NUR mit dem Text selbst, keine Einleitung, keine Erklärung, keine Anführungszeichen.`;
  try {
    const texto = await callGemini(prompt, 1500);
    $('musterloesungResult').innerHTML = `<div class="fokus-result" style="margin-top:12px;">${escapeHtml(texto)}</div>`;
  } catch(e) {
    $('musterloesungResult').innerHTML = `<div class="fokus-result" style="margin-top:12px;">Fehler beim Erstellen. Bitte nochmal versuchen.</div>`;
  }
  btn.disabled = false;
  btn.textContent = '📄 Musterlösung anzeigen';
});

if ($('btnNeueTextsorte')) $('btnNeueTextsorte').addEventListener('click', () => { state.maxPage = 0; goToPage('config'); });
if ($('btnNochmal')) $('btnNochmal').addEventListener('click', () => {
  $('textInput').value=''; updateWordCount(); renderAufgabeInline(); goToPage('schreiben'); iniciarCronometro();
  iniciarSalvamentoNuvemPeriodico();
  if ($('musterloesungResult')) $('musterloesungResult').innerHTML = '';
  if ($('btnMusterloesung')) $('btnMusterloesung').textContent = '📄 Musterlösung anzeigen';
});

/* ---------- Init ---------- */
(async function init(){
  const authed = await initAuth();
  if (!authed) return;
  await loadBank();
  renderNiveauRow();
  renderTeileRow();
  renderNiveauRowReal();
  if (!location.hash) location.hash = '#/config';
  onHashChange();

  // Klassenaufgabe direkt aus der URL laden. app.js wird vor
  // aufgabe-turma.js eingebunden, deshalb darf der Classroom-Flow
  // nicht davon abhängen, dass aufgabe-turma.js zuerst localStorage setzt.
  let classroomDraft = null;
  try {
    const params = new URLSearchParams(location.search);
    const taskId = params.get('aufgabe_id') || params.get('id');
    if (taskId) {
      const resTask = await sbFetch(
        `aufgabas_turma?id=eq.${encodeURIComponent(taskId)}&select=id,turma_id,niveau,aufgabenstellung,created_at&limit=1`
      );
      if (resTask.ok) {
        const rowsTask = await resTask.json();
        const task = Array.isArray(rowsTask) ? rowsTask[0] : null;
        if (task) {
          classroomDraft = {
            user_id: _session.user.id,
            niveau: task.niveau,
            tipo_key: task.niveau === 'A2' ? 'email_informell' : task.niveau === 'C1' ? 'erörterung_grafik' : 'leserbrief',
            schwierigkeit: 4,
            aufgaba_obj: {
              aufgabe: task.aufgabenstellung || '',
              quelltext: '',
              thema: (task.aufgabenstellung || '').split(/\\n+/)[0].slice(0,120),
              aufgabe_id: task.id,
              turma_id: task.turma_id,
              classroom: true
            },
            texto: '',
            segundos_restantes: 0,
            atualizado_em: new Date().toISOString()
          };
        }
      }
    }
  } catch(e) {
    console.warn('[Klassenaufgabe] URL-Aufgabe konnte nicht geladen werden:', e);
  }

  // Fallback para o fluxo antigo via localStorage.
  if (!classroomDraft) try {
    const raw = localStorage.getItem('sprachio_classroom_assignment');
    if (raw) {
      const task = JSON.parse(raw);
      if (task?.aufgabe_id && task?.turma_id) {
        classroomDraft = {
          user_id: _session.user.id,
          niveau: task.niveau,
          tipo_key: task.niveau === 'A2' ? 'email_informell' : task.niveau === 'C1' ? 'erörterung_grafik' : 'leserbrief',
          schwierigkeit: 4,
          aufgaba_obj: {
            aufgabe: task.aufgabenstellung || '',
            quelltext: '',
            thema: (task.aufgabenstellung || '').split(/\\n+/)[0].slice(0,120),
            aufgabe_id: task.aufgabe_id,
            turma_id: task.turma_id,
            classroom: true
          },
          texto: '',
          segundos_restantes: 0,
          atualizado_em: new Date().toISOString()
        };
        localStorage.removeItem('sprachio_classroom_assignment');
      }
    }
  } catch(e) {
    console.warn('[Klassenaufgabe] localStorage-Übergabe konnte nicht gelesen werden:', e);
  }

  const rascunhoNuvem = classroomDraft || await verificarRascunhoNuvem();
  if (rascunhoNuvem) {
    if (classroomDraft) {
      retomarRascunhoNuvem(rascunhoNuvem);
    } else {
      renderAvisoRascunhoNuvem(rascunhoNuvem);
    }
  }
})();

/* ================================================================
   CRONÔMETRO
   ================================================================ */
const TEMPO_PROVA = { A2: 45, B1: 75, C1: 120 }; // minutos

let timerInterval = null;
let timerSeconds = 0;

function iniciarCronometro(segundosIniciais){
  clearInterval(timerInterval);
  if (typeof segundosIniciais === 'number' && segundosIniciais > 0) {
    timerSeconds = segundosIniciais;
  } else {
    const minutos = TEMPO_PROVA[state.niveau] || 75;
    timerSeconds = minutos * 60;
  }
  renderCronometro();
  timerInterval = setInterval(() => {
    timerSeconds--;
    renderCronometro();
    if (timerSeconds <= 0) {
      clearInterval(timerInterval);
      const el = $('cronometro');
      if (el) { el.classList.add('esgotado'); el.textContent = '00:00 — Zeit!'; }
    }
  }, 1000);
}

function pararCronometro(){
  clearInterval(timerInterval);
}

function renderCronometro(){
  const el = $('cronometro');
  if (!el) return;
  const m = Math.floor(timerSeconds / 60);
  const s = timerSeconds % 60;
  el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.classList.toggle('aviso', timerSeconds <= 300 && timerSeconds > 0);   // laranja nos últimos 5 min
  el.classList.toggle('esgotado', timerSeconds <= 0);
}

/* ================================================================
   HISTÓRICO (Supabase)
   ================================================================ */
async function salvarHistorico(texto, feedback, vokabelkarten){
  try {
    const meta = currentMeta();
    await sbFetch('historico', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: _session?.user?.id,
        niveau: state.niveau,
        textsorte: meta.label,
        schwierigkeit: state.schwierigkeit,
        thema: state.aufgabaObj?.thema || state.aufgabaObj?.aufgabe?.split('\n')[0] || '—',
        texto_aluno: texto,
        nivel_atingido: feedback.niveau_einschaetzung || null,
        status: feedback.status || null,
        erfuellung: feedback.erfuellung || null,
        aufbau: feedback.aufbau || null,
        sprache: feedback.sprache || null,
        tipp: feedback.tipp || null,
        korrekturen: JSON.stringify(feedback.korrekturen || []),
      })
    });
    await salvarVocabulario(vokabelkarten, state.niveau);
  } catch(e) {
    console.warn('Histórico não salvo:', e);
  }
}

async function salvarVocabulario(cartas, niveau){
  if (!cartas || !cartas.length) return;
  try {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    const rows = cartas.slice(0, 6).map(c => ({
      user_id: _session?.user?.id,
      wort: c.wort,
      bedeutung: c.bedeutung,
      beispiel: c.beispiel || null,
      niveau,
      proxima_revisao: amanha.toISOString().slice(0,10)
    }));
    await sbFetch('vocabulario', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(rows)
    });
  } catch(e) {
    console.warn('Vocabulário não salvo:', e);
  }
}

async function carregarHistorico(){
  const el = $('historicoLista');
  if (!el) return;
  el.innerHTML = '<div class="hist-loading">Laden&hellip;</div>';
  try {
    const res = await sbFetch('historico?select=*&order=created_at.desc&limit=50');
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      el.innerHTML = '<div class="hist-empty">Noch keine Einträge. Nach dem ersten Korrigieren erscheinen hier deine Ergebnisse.</div>';
      return;
    }
    el.innerHTML = rows.map(r => {
      const data = new Date(r.created_at).toLocaleDateString('de-DE');
      const statusClass = r.status === 'erreicht' || r.status === 'übertroffen' ? 'gut' : r.status === 'knapp erreicht' ? 'ok' : 'schlecht';
      return `<div class="hist-card">
        <div class="hist-top">
          <span class="hist-thema">${escapeHtml(r.thema)}</span>
          <span class="hist-badge ${statusClass}">${escapeHtml(r.niveau_atingido || '—')} · ${escapeHtml(r.status || '—')}</span>
        </div>
        <div class="hist-meta">${escapeHtml(r.niveau)} · ${escapeHtml(r.textsorte)} · Schwierigkeit ${r.schwierigkeit}/8 · ${data}</div>
        <div class="hist-tipp">→ ${escapeHtml(r.tipp || '')}</div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div class="hist-empty">Fehler beim Laden des Verlaufs.</div>';
  }
}

// Hook salvar histórico depois de renderFeedback
/* (nota: renderFeedback foi renomeada para renderFeedbackDSD1 / renderFeedbackGenerico) */

/* ================================================================
   AUFGABE INLINE (tela de escrita) — sempre visível, com toggle
   ================================================================ */
let aufgabeVisivel = true;

function renderAufgabeInline(){
  const painel = $('aufgabeInline');
  if (!state.aufgabaObj || !painel) return;
  const meta = currentMeta();

  $('aufgabeInlineTag').textContent = `${niveauLabel(state.niveau)} · ${meta.label}`;

  const bal = $('baloesInline');
  if (state.aufgabaObj.personen && state.aufgabaObj.personen.length) {
    bal.innerHTML = state.aufgabaObj.personen
      .map(p => `<div class="balloon"><span class="name">${escapeHtml(p.name)}</span>${escapeHtml(p.aussage)}</div>`)
      .join('');
    bal.style.display = 'grid';
  } else {
    bal.style.display = 'none';
    bal.innerHTML = '';
  }

  $('aufgabeInlineText').textContent = state.aufgabaObj.aufgabe || '';
  $('aufgabeInlineBody').classList.toggle('collapsed', !aufgabeVisivel);
  $('btnToggleAufgabe').textContent = aufgabeVisivel ? 'Ausblenden' : 'Einblenden';
}

document.getElementById('btnToggleAufgabe')?.addEventListener('click', () => {
  aufgabeVisivel = !aufgabeVisivel;
  $('aufgabeInlineBody').classList.toggle('collapsed', !aufgabeVisivel);
  $('btnToggleAufgabe').textContent = aufgabeVisivel ? 'Ausblenden' : 'Einblenden';
});
