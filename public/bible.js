/* Viewer renderer consumes only the server's receipt-only projection. */
(()=>{
  'use strict';
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const root=document.getElementById('record');
  function media(t){const m=t.media;if(!m.available)return '<p>Approved media unavailable. The approval remains recorded.</p>';
    if(m.type==='video')return `<video controls preload="metadata" src="${e(m.url)}" aria-label="${e(t.label)}"></video>`;
    if(m.type==='audio')return `<audio controls preload="metadata" src="${e(m.url)}" aria-label="${e(t.label)}"></audio>`;
    return `<img loading="lazy" src="${e(m.url)}" alt="${e(t.label)} · Approved">`;}
  async function load(){
    root.setAttribute('aria-busy','true');
    try{
      const response=await fetch('/api/bible',{cache:'no-store'});if(!response.ok)throw Error('unavailable');const doc=await response.json();
      const rows=[...doc.entities,...doc.shots];
      root.innerHTML=`<header class="record-head"><p>APPROVED RECORD · READ ONLY</p><h1>${e(doc.title||'Untitled project')}</h1><p>${e(doc.format)}</p><p>Current receipt-backed material. Names identify each target; creative intent is kept in the editor workspace.</p><nav class="record-links" aria-label="Record actions"><a href="/api/bible/export?preset=approved">Download Approved record</a><a href="/">Editor workspace</a></nav></header><label for="record-search">Find approved material</label><input id="record-search" type="search" placeholder="Search by name or ID"><p id="record-count" role="status"></p><div id="record-rows">${rows.map(r=>`<section class="record-section" data-record-search="${e([r.name,r.id,r.list,r.scene].join(' ').toLowerCase())}"><h2>${e(r.name)} <small>${e(r.id)}</small></h2><div class="record-grid">${r.targets.map(t=>`<article class="record-target"><h3>${e(t.label)}</h3><p class="record-approved">Approved</p>${media(t)}<small>${e(t.value)}</small><small>Receipt ${e(t.receiptId)} · ${e(t.at)}</small></article>`).join('')}</div></section>`).join('')}</div>`;
      const filter=()=>{let n=0;const q=document.getElementById('record-search').value.trim().toLowerCase();root.querySelectorAll('[data-record-search]').forEach(el=>{el.hidden=!el.dataset.recordSearch.includes(q);if(!el.hidden)n++;});document.getElementById('record-count').textContent=n?`${n} records`:q?'No matching approved material.':'No current approved material.';};
      document.getElementById('record-search').addEventListener('input',filter);filter();
      root.querySelectorAll('img,video,audio').forEach(el=>el.addEventListener('error',()=>{const p=document.createElement('p');p.textContent='Approved media could not be loaded. The approval remains recorded.';el.replaceWith(p);},{once:true}));
    }catch{root.innerHTML='<h1>Approved record unavailable</h1><p>The record could not be loaded. Your material has not been changed.</p><button id="record-retry">Try again</button>';document.getElementById('record-retry').onclick=load;}
    root.setAttribute('aria-busy','false');
  }
  load();
})();
