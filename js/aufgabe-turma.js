/* Sprachio — Aufgaben aus einer Klasse */
(function(){
  const params = new URLSearchParams(location.search);
  const taskId = params.get('aufgabe_id');
  if (!taskId) return;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function loadTaskAndStart(){
    for(let i=0;i<120;i++){
      if (window.state && window._session && typeof window.sbFetch === 'function') break;
      await sleep(100);
    }
    if (!window.state || !window._session || typeof window.sbFetch !== 'function') {
      console.error('[Sprachio Aufgabe] Trainer konnte nicht initialisiert werden.');
      return;
    }

    try {
      const res = await window.sbFetch(`aufgabas_turma?id=eq.${encodeURIComponent(taskId)}&select=id,turma_id,niveau,aufgabenstellung,created_at&limit=1`);
      if(!res.ok) throw new Error(`Aufgabe HTTP ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      const task = rows[0];
      if(!task) throw new Error('Aufgabe nicht gefunden.');

      const niveau = ['A2','B1','C1'].includes(task.niveau) ? task.niveau : 'B1';
      window.state.niveau = niveau;
      window.state.tipoKey = (window.TEXTSORTEN?.[niveau]?.[0]?.key) || (niveau==='A2'?'email_informell':niveau==='B1'?'leserbrief':'erörterung_grafik');
      window.state.schwierigkeit = 4;
      window.state.aufgabaObj = {
        aufgabe: task.aufgabenstellung,
        quelltext: '',
        thema: task.aufgabenstellung.split(/\n+/)[0].slice(0,120),
        aufgabe_id: task.id,
        turma_id: task.turma_id,
        classroom: true
      };
      window.state._aufgabeId = task.id;
      window.state._turmaId = task.turma_id;
      window.state.maxPage = Math.max(window.state.maxPage, 2);

      if(typeof window.renderAufgabeInline === 'function') window.renderAufgabeInline();
      const input = document.getElementById('textInput');
      if(input) input.value = '';
      if(typeof window.updateWordCount === 'function') window.updateWordCount();
      if(typeof window.goToPage === 'function') window.goToPage('schreiben');
      if(typeof window.iniciarCronometro === 'function') window.iniciarCronometro();
      if(typeof window.restaurarRascunho === 'function') window.restaurarRascunho();
      if(typeof window.iniciarSalvamentoNuvemPeriodico === 'function') window.iniciarSalvamentoNuvemPeriodico();

      // Após a correção normal do app, vincula o registro de historico à Aufgabe da turma.
      const btn = document.getElementById('btnSenden');
      if(btn){
        btn.addEventListener('click', () => finalizarVinculo(task.id), {once:true});
      }
    } catch(e){
      console.error('[Sprachio Aufgabe]', e);
      alert('Die Aufgabe konnte nicht geladen werden. Bitte versuche es erneut.');
    }
  }

  async function finalizarVinculo(aufgabeId){
    // O app.js primeiro executa a correção e salva o histórico. Esperamos esse INSERT.
    for(let i=0;i<30;i++){
      await sleep(1000);
      try{
        const res = await window.sbFetch(`historico?user_id=eq.${encodeURIComponent(window._session.user.id)}&select=id,aufgabe_id,created_at&order=created_at.desc&limit=1`);
        if(!res.ok) continue;
        const rows = await res.json();
        if(!rows.length) continue;
        const row = rows[0];
        // Só vincula um registro recém-criado (até 90 segundos).
        if(Date.now() - new Date(row.created_at).getTime() > 90000) return;
        if(row.aufgabe_id === aufgabeId) return;
        const patch = await window.sbFetch(`historico?id=eq.${encodeURIComponent(row.id)}&user_id=eq.${encodeURIComponent(window._session.user.id)}`, {
          method:'PATCH',
          headers:{Prefer:'return=minimal'},
          body:JSON.stringify({aufgabe_id:aufgabeId})
        });
        if(patch.ok) return;
        console.warn('[Sprachio Aufgabe] Historico konnte nicht verknüpft werden:', await patch.text());
      }catch(e){ console.warn('[Sprachio Aufgabe] Verknüpfung:',e); }
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadTaskAndStart);
  else loadTaskAndStart();
})();
