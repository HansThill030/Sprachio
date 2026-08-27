/* Sprachio Lehrer-Modus Erweiterungen */
(function () {
  if (!/\/professor\/?$/.test(window.location.pathname)) return;
  if (window.__sprachioProfessorEnhancements) return;
  window.__sprachioProfessorEnhancements = true;

  var cfg = window.SCHREIBTRAINER_CONFIG;
  if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;

  var esc = function (s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
  var fetchJson = function (sb, path, options) {
    options = options || {};
    var headers = Object.assign({ apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + sb._session.access_token, 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(cfg.SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, options, { headers: headers })).then(function (r) {
      return r.text().then(function (t) { var data = t ? JSON.parse(t) : []; if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + t); return data; });
    });
  };

  import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(function (mod) {
    var sb = mod.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return sb.auth.getSession().then(function (r) {
      if (!r.data || !r.data.session) return;
      sb._session = r.data.session;
      observeProfessor(sb);
    });
  }).catch(function (e) { console.warn('[Sprachio Lehrer]', e); });

  function observeProfessor(sb) {
    var observer = new MutationObserver(function () {
      var title = document.querySelector('.screen-title');
      var taskArea = document.getElementById('aufgabeTurmaInput');
      if (title && taskArea) {
        enhanceTaskComposer(sb);
        enhanceClassResults(sb, title.textContent.trim());
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () {
      var title = document.querySelector('.screen-title');
      if (title) enhanceClassResults(sb, title.textContent.trim());
    }, 1000);
  }

  function enhanceTaskComposer(sb) {
    if (document.getElementById('sprachioAiTaskBox')) return;
    var textarea = document.getElementById('aufgabeTurmaInput');
    if (!textarea) return;
    var section = textarea.closest('div') || textarea.parentElement;
    var box = document.createElement('div');
    box.id = 'sprachioAiTaskBox';
    box.style.cssText = 'border:1px solid var(--line);border-radius:var(--r-sm);padding:14px;margin:12px 0;background:var(--bg);';
    box.innerHTML = '<div style="font-family:Space Grotesk,sans-serif;font-weight:700;font-size:.88rem;margin-bottom:10px;">✨ Aufgabe mit KI erstellen</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">' +
      '<select id="sprachioAiLevel" style="padding:9px;border:1px solid var(--line);border-radius:6px;background:var(--card);font:inherit;"><option>A2</option><option selected>B1</option><option>C1</option></select>' +
      '<select id="sprachioAiType" style="padding:9px;border:1px solid var(--line);border-radius:6px;background:var(--card);font:inherit;"><option>Beitrag</option><option>Leserbrief</option><option>E-Mail</option><option>Erörterung</option></select>' +
      '</div>' +
      '<input id="sprachioAiTheme" placeholder="Thema, z.B. Künstliche Intelligenz in der Schule" style="width:100%;box-sizing:border-box;margin-top:8px;padding:9px;border:1px solid var(--line);border-radius:6px;font:inherit;">' +
      '<input id="sprachioAiContent" placeholder="Neuer Inhalt/Schwerpunkt, z.B. Datenschutz und soziale Medien" style="width:100%;box-sizing:border-box;margin-top:8px;padding:9px;border:1px solid var(--line);border-radius:6px;font:inherit;">' +
      '<input id="sprachioAiBasis" placeholder="Optional: bestehendes Thema als Inspiration" style="width:100%;box-sizing:border-box;margin-top:8px;padding:9px;border:1px solid var(--line);border-radius:6px;font:inherit;">' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;"><button type="button" id="sprachioAiGenerate" class="primary">✨ Aufgabe generieren</button><span id="sprachioAiStatus" style="font-size:.78rem;color:var(--ink-faint);"></span></div>';
    textarea.parentNode.insertBefore(box, textarea);

    document.getElementById('sprachioAiGenerate').addEventListener('click', async function () {
      var level = document.getElementById('sprachioAiLevel').value;
      var type = document.getElementById('sprachioAiType').value;
      var theme = document.getElementById('sprachioAiTheme').value.trim();
      var content = document.getElementById('sprachioAiContent').value.trim();
      var basis = document.getElementById('sprachioAiBasis').value.trim();
      var status = document.getElementById('sprachioAiStatus');
      if (!theme) { status.textContent = 'Bitte ein Thema angeben.'; return; }
      var btn = this; btn.disabled = true; status.textContent = 'Generiere…';
      try {
        var res = await fetch(cfg.SUPABASE_URL + '/functions/v1/generate-classroom-task', {
          method: 'POST',
          headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + sb._session.access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ niveau: level, textsorte: type, thema: theme, inhalt: content, basis: basis })
        });
        var data = await res.json();
        if (!res.ok || !data.text) throw new Error(data.error || 'Generierung fehlgeschlagen');
        textarea.value = data.text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        status.textContent = '✓ Aufgabe erstellt. Du kannst sie vor dem Teilen bearbeiten.';
      } catch (e) { console.error('[Sprachio KI]', e); status.textContent = '❌ ' + e.message; }
      finally { btn.disabled = false; }
    });
  }

  async function findCurrentClass(sb, title) {
    var rows = await fetchJson(sb, 'turmas?professor_id=eq.' + encodeURIComponent(sb._session.user.id) + '&select=id,nome');
    return (rows || []).find(function (t) { return t.nome === title; }) || null;
  }

  async function enhanceClassResults(sb, title) {
    var marker = document.getElementById('sprachioScopedResults');
    if (marker && marker.dataset.title === title) return;
    var turma = await findCurrentClass(sb, title).catch(function () { return null; });
    if (!turma) return;
    var members = await fetchJson(sb, 'turma_membros?turma_id=eq.' + encodeURIComponent(turma.id) + '&select=user_id').catch(function () { return []; });
    var tasks = await fetchJson(sb, 'aufgabas_turma?turma_id=eq.' + encodeURIComponent(turma.id) + '&select=id,niveau,aufgabenstellung,created_at&order=created_at.desc').catch(function () { return []; });
    var ids = (tasks || []).map(function (t) { return t.id; });
    var history = [];
    if (ids.length) {
      history = await fetchJson(sb, 'historico?aufgabe_id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,user_id,aufgabe_id,niveau_atingido,created_at,texto,correcao&order=created_at.desc').catch(function () { return []; });
    }
    var old = document.getElementById('sprachioScopedResults');
    if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.id = 'sprachioScopedResults'; wrap.dataset.title = title;
    wrap.style.cssText = 'margin-top:28px;';
    var byTask = {};
    (history || []).forEach(function (h) { (byTask[h.aufgabe_id] ||= []).push(h); });
    wrap.innerHTML = '<div class="section-label">📚 Ergebnisse dieser Klasse</div>' + ((tasks || []).length ? tasks.map(function (t) {
      var rows = byTask[t.id] || [];
      return '<div class="aufgaben-list-item" style="margin-bottom:12px;"><div class="meta">' + esc(t.niveau || '') + ' · ' + (t.created_at ? new Date(t.created_at).toLocaleDateString('de-DE') : '') + '</div><div style="font-weight:600;margin-bottom:8px;">' + esc(t.aufgabenstellung) + '</div>' + (rows.length ? rows.map(function (h) { return '<details style="border-top:1px solid var(--line);padding:8px 0;"><summary style="cursor:pointer;font-size:.82rem;">Schüler ' + esc((h.user_id || '').slice(0,8)) + ' · ' + esc(h.niveau_atingido || '—') + '</summary><div style="font-size:.82rem;line-height:1.5;margin-top:8px;"><b>Text:</b><div style="white-space:pre-wrap;margin:4px 0 10px;">' + esc(h.texto || '') + '</div><b>Korrektur:</b><div style="white-space:pre-wrap;">' + esc(h.correcao || '') + '</div></div></details>'; }).join('') : '<div style="font-size:.8rem;color:var(--ink-faint);">Noch keine Abgaben.</div>') + '</div>';
    }).join('') : '<div class="ms-empty">Noch keine Aufgabe geteilt.</div>');
    var app = document.getElementById('app');
    if (app) app.appendChild(wrap);

    /* The original teacher view used user_id only. Hide that unscoped history UI so
       a student active in multiple classes cannot leak results across classes. */
    var list = document.getElementById('alunosList');
    if (list) {
      list.querySelectorAll('[data-verlauf]').forEach(function (b) { b.style.display = 'none'; });
      var rows = list.querySelectorAll('.aluno-row');
      rows.forEach(function (row) {
        var button = row.querySelector('[data-verlauf]');
        if (!button) return;
        var uid = button.getAttribute('data-verlauf');
        var count = (history || []).filter(function (h) { return h.user_id === uid; }).length;
        var stats = row.querySelector('.stats');
        if (stats) stats.textContent = count + ' Aufgaben · nur diese Klasse';
      });
    }
  }
})();
