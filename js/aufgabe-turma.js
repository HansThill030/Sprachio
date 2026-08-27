/* Sprachio — carrega uma Aufgabe da turma usando o mesmo fluxo do Trainer */
(function(){
  const params = new URLSearchParams(location.search);
  const taskId = params.get('aufgabe_id');
  if (!taskId) return;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let task=null, session=null;
  async function setup(){
    const cfg=window.SCHREIBTRAINER_CONFIG||{};
    const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const sb=mod.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const s=await sb.auth.getSession(); session=s.data.session;
    if(!session){location.href='/login';return false;}
    window.__classroomSb=sb; return true;
  }
  async function rest(path,options={}){
    const cfg=window.SCHREIBTRAINER_CONFIG;
    const headers=Object.assign({apikey:cfg.SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},options.headers||{});
    return fetch(`${cfg.SUPABASE_URL}/rest/v1/${path}`,Object.assign({},options,{headers}));
  }
  async function main(){
    try{
      if(!await setup())return;
      const res=await rest(`aufgabas_turma?id=eq.${encodeURIComponent(taskId)}&select=id,turma_id,niveau,aufgabenstellung,created_at&limit=1`);
      if(!res.ok)throw new Error(`Aufgabe HTTP ${res.status}: ${await res.text()}`);
      task=(await res.json())[0]; if(!task)throw new Error('Aufgabe nicht gefunden.');
      const niveau=['A2','B1','C1'].includes(task.niveau)?task.niveau:'B1';
      const tipo=niveau==='A2'?'email_informell':niveau==='B1'?'leserbrief':'erörterung_grafik';
      const aufgabaObj={aufgabe:task.aufgabenstellung,quelltext:'',thema:task.aufgabenstellung.split(/\n+/)[0].slice(0,120),aufgabe_id:task.id,turma_id:task.turma_id,classroom:true};
      await rest(`rascunhos?user_id=eq.${encodeURIComponent(session.user.id)}`,{method:'DELETE'});
      const draft=await rest('rascunhos',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({user_id:session.user.id,niveau,tipo_key:tipo,schwierigkeit:4,aufgaba_obj:aufgabaObj,texto:'',segundos_restantes:null,atualizado_em:new Date().toISOString()})});
      if(!draft.ok)throw new Error(`Rascunho HTTP ${draft.status}: ${await draft.text()}`);
      for(let i=0;i<100;i++){const b=document.getElementById('btnFortsetzenRascunho');if(b){b.click();break;}await sleep(100);}
      for(let i=0;i<20;i++){if(document.getElementById('page-schreiben')?.classList.contains('active'))break;await sleep(100);}
      const send=document.getElementById('btnSenden'); if(send)send.addEventListener('click',linkHistory,{once:true});
    }catch(e){console.error('[Sprachio Aufgabe]',e);alert('Die Aufgabe konnte nicht geladen werden. Bitte versuche es erneut.');}
  }
  async function linkHistory(){
    for(let i=0;i<45;i++){
      await sleep(1000);
      try{
        const res=await rest(`historico?user_id=eq.${encodeURIComponent(session.user.id)}&select=id,aufgabe_id,created_at&order=created_at.desc&limit=1`);
        if(!res.ok)continue; const rows=await res.json(); if(!rows.length)continue; const row=rows[0];
        if(Date.now()-new Date(row.created_at).getTime()>90000)return;
        if(row.aufgabe_id===task.id)return;
        const patch=await rest(`historico?id=eq.${encodeURIComponent(row.id)}&user_id=eq.${encodeURIComponent(session.user.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({aufgabe_id:task.id})});
        if(patch.ok)return;
      }catch(e){console.warn('[Sprachio Aufgabe] Historico-Link',e);}
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',main);else main();
})();
