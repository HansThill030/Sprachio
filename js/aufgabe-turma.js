/* Sprachio — carrega uma Aufgabe da turma e entrega ao fluxo normal do Trainer */
(function(){
  const params = new URLSearchParams(location.search);
  // Aceita os dois formatos para manter compatibilidade com links antigos.
  const taskId = params.get('aufgabe_id') || params.get('id');
  if (!taskId) return;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let task = null;
  let session = null;

  async function setup(){
    const cfg = window.SCHREIBTRAINER_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      throw new Error('Supabase-Konfiguration fehlt.');
    }
    const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const sb = mod.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const result = await sb.auth.getSession();
    session = result.data.session;
    if (!session) {
      location.href = '/login';
      return false;
    }
    return true;
  }

  async function rest(path, options = {}){
    const cfg = window.SCHREIBTRAINER_CONFIG;
    const headers = Object.assign({
      apikey: cfg.SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json'
    }, options.headers || {});
    return fetch(`${cfg.SUPABASE_URL}/rest/v1/${path}`, Object.assign({}, options, {headers}));
  }

  function buildDraft(t){
    const niveau = ['A2','B1','C1'].includes(t.niveau) ? t.niveau : 'B1';
    const tipo = niveau === 'A2' ? 'email_informell' : niveau === 'B1' ? 'leserbrief' : 'erörterung_grafik';
    return {
      user_id: session.user.id,
      niveau,
      tipo_key: tipo,
      schwierigkeit: 4,
      aufgaba_obj: {
        aufgabe: t.aufgabenstellung || '',
        quelltext: '',
        thema: (t.aufgabenstellung || '').split(/\n+/)[0].slice(0,120),
        aufgabe_id: t.id,
        turma_id: t.turma_id,
        classroom: true
      },
      texto: '',
      // rascunhos.segundos_restantes é NOT NULL. 0 significa que o Trainer
      // deve iniciar um cronômetro novo, em vez de tentar restaurar um valor.
      segundos_restantes: 0,
      atualizado_em: new Date().toISOString()
    };
  }

  async function main(){
    try {
      if (!await setup()) return;

      const res = await rest(`aufgabas_turma?id=eq.${encodeURIComponent(taskId)}&select=id,turma_id,niveau,aufgabenstellung,created_at&limit=1`);
      const raw = await res.text();
      if (!res.ok) throw new Error(`Aufgabe HTTP ${res.status}: ${raw}`);
      const rows = JSON.parse(raw);
      task = Array.isArray(rows) ? rows[0] : null;
      if (!task) throw new Error('Aufgabe nicht gefunden.');

      // rascunhos tem user_id como PRIMARY KEY. Upsert atualiza o rascunho
      // do aluno sem criar uma segunda linha.
      const draft = await rest('rascunhos', {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(buildDraft(task))
      });
      if (!draft.ok) {
        const detail = await draft.text().catch(() => '');
        throw new Error(`Rascunho HTTP ${draft.status}: ${detail}`);
      }

      // app.js carrega o rascunho durante sua inicialização.
      for (let i = 0; i < 150; i++) {
        const btn = document.getElementById('btnFortsetzenRascunho');
        if (btn) {
          btn.click();
          return;
        }
        await sleep(100);
      }

      throw new Error('Der Trainer konnte den gespeicherten Entwurf nicht öffnen.');
    } catch (e) {
      console.error('[Sprachio Aufgabe]', e);
      const message = e && e.message ? e.message : String(e);
      const box = document.getElementById('feedback') || document.body;
      if (box && box.id === 'feedback') {
        const el = document.getElementById('fbErfuellung');
        if (el) el.textContent = 'Die Aufgabe konnte nicht geladen werden. Bitte versuche es erneut.';
      }
      alert('Die Aufgabe konnte nicht geladen werden. Bitte versuche es erneut.');
      console.error('[Sprachio Aufgabe – Ursache]', message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
