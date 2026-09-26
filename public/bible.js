/* Viewer renderer consumes only the server's receipt-only projection. */
(()=>{
  'use strict';
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const root=document.getElementById('record');
  const KINDS={characters:'Character',locations:'Location',props:'Prop',vehicles:'Vehicle',audio:'Audio'};
  function media(t){const m=t.media;if(!m.available)return '<p>Approved media unavailable. The approval remains recorded.</p>';
    if(m.type==='video')return `<video controls preload="metadata" src="${e(m.url)}" aria-label="${e(t.label)}"></video>`;
    if(m.type==='audio')return `<audio controls preload="metadata" src="${e(m.url)}" aria-label="${e(t.label)}"></audio>`;
    return `<img loading="lazy" src="${e(m.url)}" alt="${e(t.label)} · Approved">`;}
  async function load(){
    root.setAttribute('aria-busy','true');
    try{
      const response=await fetch('/api/bible',{cache:'no-store'});if(!response.ok)throw Error('unavailable');const doc=await response.json();
      const rows=[...doc.entities,...doc.shots];
      // A publication, not a workspace: kind above the readable name, the approval source folded under each plate, and no gap filled from drafts.
      const kind=r=>r.list?(KINDS[r.list]||'Element'):`Shot${r.scene?' · '+r.scene:''}`;
      root.innerHTML=`<header class="record-head"><p class="record-kicker">Approved record · Read only</p><h1>${e(doc.title||'Untitled project')}</h1>${doc.format?`<p class="record-format">${e(doc.format)}</p>`:''}<p class="record-standfirst">Current receipt-backed material and deliberate shot sound placements. Other creative working notes stay in the editor workspace.</p><nav class="record-links" aria-label="Record actions"><a href="/api/bible/export?preset=approved" download>Download Approved record</a><a href="/">Editor workspace</a></nav></header><div class="record-find"><label for="record-search">Find approved material</label><input id="record-search" type="search" placeholder="Search by name or ID"></div><p id="record-count" role="status"></p><div id="record-rows">${rows.map(r=>`<section class="record-section" id="record-${e(r.list||'shot')}-${e(encodeURIComponent(r.id))}" data-record-search="${e([r.name,r.id,r.list,r.scene].join(' ').toLowerCase())}"><p class="record-kind">${e(kind(r))}</p><h2>${e(r.name||r.id)}</h2><p class="record-id">ID · ${e(r.id)}</p><div class="record-grid">${r.targets.map(t=>`<article class="record-target"><h3>${e(t.label)}</h3><p class="record-approved">${t.media.type==='audio'&&!t.media.available?'Approval history · original recording unavailable':t.placement?'Placed approved recording':'Approved'}</p>${t.placement?'<p>Audio item · '+e(t.placement.audioEntityName)+' ('+e(t.placement.audioEntityId)+')</p><p>Role · '+e(t.placement.role)+' · Timing · '+e(t.placement.timing)+(t.placement.cue?' · '+e(t.placement.cue):'')+'</p><small>Receipt '+e(t.receiptId)+' · Asset '+e(t.assetId)+'</small>':''}${media(t)}<details class="record-source"><summary>Approval source</summary><small>File · ${e(t.value)}</small><small>Receipt ${e(t.receiptId)} · ${e(t.at)}</small></details></article>`).join('')}</div></section>`).join('')||'<section class="record-empty"><h2>No Approved material yet</h2><p>This record shows only current receipt-backed material. It will not fill gaps with drafts or candidates.</p></section>'}</div>`;
      const filter=()=>{let n=0;const q=document.getElementById('record-search').value.trim().toLowerCase();root.querySelectorAll('[data-record-search]').forEach(el=>{el.hidden=!el.dataset.recordSearch.includes(q);if(!el.hidden)n++;});document.getElementById('record-count').textContent=n?`${n} records`:q?'No matching approved material.':'No current approved material.';};
      document.getElementById('record-search').addEventListener('input',filter);filter();
      root.querySelectorAll('img,video,audio').forEach(el=>el.addEventListener('error',()=>{const p=document.createElement('p');p.textContent='Approved media could not be loaded. The approval remains recorded.';el.replaceWith(p);},{once:true}));
    }catch{root.innerHTML='<section class="record-error"><h1>Approved record unavailable</h1><p>The record could not be loaded. Your material has not been changed.</p><button type="button" id="record-retry">Try again</button></section>';document.getElementById('record-retry').onclick=load;}
    root.setAttribute('aria-busy','false');
  }
  load();
})();
