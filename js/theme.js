(function(){
  var KEY = 'sprachio_theme';
  var saved = localStorage.getItem(KEY) || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', saved);

  function criarBotao(){
    if (document.getElementById('themeToggle')) return;
    var btn = document.createElement('button');
    btn.id = 'themeToggle';
    btn.setAttribute('aria-label', 'Design wechseln (hell/dunkel)');
    btn.setAttribute('title', 'Design wechseln');
    btn.setAttribute('type', 'button');
    btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
    btn.addEventListener('click', function(){
      var atual = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', atual);
      localStorage.setItem(KEY, atual);
      btn.textContent = atual === 'dark' ? '☀️' : '🌙';
    });
    document.body.appendChild(btn);
  }

  function carregarAufgabenPendentes(){
    if (!/\/trainer-hub\/?$/.test(window.location.pathname)) return;
    if (window.__sprachioPendingTasksLoaded) return;
    window.__sprachioPendingTasksLoaded = true;

    var iniciar = function(){
      var cfg = window.SCHREIBTRAINER_CONFIG;
      if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
      import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(function(mod){
        var supabase = mod.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
        return supabase.auth.getSession().then(function(result){
          var session = result.data && result.data.session;
          if (!session) return null;
          var uid = session.user.id;
          return Promise.all([
            supabase.from('professores').select('user_id').eq('user_id', uid).maybeSingle(),
            supabase.from('turma_membros').select('turma_id').eq('user_id', uid)
          ]).then(function(results){
            var professor = results[0].data;
            var memberships = results[1].data || [];
            if (professor || !memberships.length) return null;
            var turmaIds = memberships.map(function(m){ return m.turma_id; });
            return Promise.all([
              supabase.from('aufgabas_turma').select('id,turma_id,niveau,aufgabenstellung,created_at').in('turma_id', turmaIds).order('created_at', {ascending:false}),
              supabase.from('historico').select('aufgabe_id').eq('user_id', uid).not('aufgabe_id', 'is', null)
            ]);
          }).then(function(results){
            if (!results) return;
            var taskResult = results[0], historyResult = results[1];
            if (taskResult.error) throw taskResult.error;
            var tasks = taskResult.data || [];
            var done = new Set((historyResult.data || []).map(function(h){ return h.aufgabe_id; }));
            var pending = tasks.filter(function(t){ return !done.has(t.id); });
            renderPending(pending);
          });
        });
      }).catch(function(err){ console.warn('[Sprachio] Aufgaben-Pin konnte nicht geladen werden:', err); });
    };

    if (window.SCHREIBTRAINER_CONFIG) iniciar();
    else window.addEventListener('load', iniciar, {once:true});
  }

  function renderPending(tasks){
    if (!tasks.length) return;
    var style = document.createElement('style');
    style.textContent = `
      .sprachio-pending-pin{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--indigo);border-left:4px solid var(--accent);border-radius:var(--r);padding:14px 16px;margin:0 0 28px;box-shadow:0 4px 18px rgba(0,0,0,.06)}
      .sprachio-pending-pin .pin-icon{font-size:1.55rem;flex-shrink:0}
      .sprachio-pending-pin .pin-content{flex:1;min-width:0}
      .sprachio-pending-pin .pin-label{font-family:'Space Grotesk',sans-serif;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);margin-bottom:3px}
      .sprachio-pending-pin .pin-title{font-family:'Space Grotesk',sans-serif;font-weight:700;color:var(--ink);font-size:.96rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sprachio-pending-pin .pin-meta{font-size:.76rem;color:var(--ink-faint);margin-top:3px}
      .sprachio-pending-pin .pin-actions{display:flex;gap:7px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}
      .sprachio-pending-pin .pin-actions a{font-size:.78rem;font-weight:600;padding:8px 12px;border-radius:var(--r-sm);text-decoration:none;border:1px solid var(--line);color:var(--ink-soft)}
      .sprachio-pending-pin .pin-actions a.primary-pin{background:var(--ink);border-color:var(--ink);color:#fff}
      .sprachio-pending-more{margin-top:8px;font-size:.76rem;color:var(--ink-faint)}
      @media(max-width:620px){.sprachio-pending-pin{align-items:flex-start}.sprachio-pending-pin .pin-actions{width:100%;justify-content:flex-start}.sprachio-pending-pin{flex-wrap:wrap}}
    `;
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'sprachio-pending-pin';
    var first = tasks[0];
    var extra = tasks.length > 1 ? '<div class="sprachio-pending-more">+' + (tasks.length - 1) + ' weitere offene Aufgabe' + (tasks.length - 1 === 1 ? '' : 'n') + '</div>' : '';
    wrap.innerHTML = '<div class="pin-icon">📌</div>' +
      '<div class="pin-content"><div class="pin-label">Offene Aufgabe</div><div class="pin-title"></div><div class="pin-meta"></div>' + extra + '</div>' +
      '<div class="pin-actions"><a class="primary-pin" href="/aufgabe-turma?id=' + encodeURIComponent(first.id) + '">Jetzt bearbeiten →</a><a href="/minhas-turmas">Alle anzeigen</a></div>';
    wrap.querySelector('.pin-title').textContent = first.aufgabenstellung || 'Aufgabe ohne Titel';
    wrap.querySelector('.pin-meta').textContent = (first.niveau || '') + (first.created_at ? ' · ' + new Date(first.created_at).toLocaleDateString('de-DE') : '');

    var banner = document.getElementById('loginBannerWrap');
    var hero = document.querySelector('.hub-hero');
    if (banner && banner.parentNode) banner.parentNode.insertBefore(wrap, banner.nextSibling);
    else if (hero && hero.parentNode) hero.parentNode.insertBefore(wrap, hero.nextSibling);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ criarBotao(); carregarAufgabenPendentes(); });
  } else {
    criarBotao();
    carregarAufgabenPendentes();
  }
})();
