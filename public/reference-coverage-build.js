/* EV2-7 Build coverage — the Reference Desk's one front door for filling views.
   Scope is always entity + continuity state + one view. Every commit goes through an existing
   writer: exact enrollment (/api/references/enroll) for view assignment, the crop candidate
   writer for crops, entity intake for sheet uploads and the coverage route for generation.
   Filling a view never approves; approval stays the Desk footer's separate decision.
   The flow object below is ephemeral: nothing in it is persisted. */
(function() {
  "use strict";
  const e=v=>esc(String(v??'')),a=v=>attr(String(v??''));
  let build=null,serial=0;
  const modal=()=>document.querySelector('#modal:not(.hidden) [data-build-coverage]');
  const Ref=()=>typeof CineBraidReferenceMedia!=='undefined'?CineBraidReferenceMedia:null;
  const auto=()=>window.__CINEBRAID_COVERAGE_AUTOMATION||null;
  const entityOf=b=>b&&P?.[b.list]?.find(x=>x.id===b.id)||null;
  const inScope=b=>!!b&&b===build&&b.slug===ACTIVE_PROJECT_SLUG&&b.epoch===PROJECT_OPEN_EPOCH&&!!entityOf(b);
  const button=(data,label,cls='',extra='')=>'<button type="button" class="rd-button '+cls+'" '+data+' '+extra+'>'+label+'</button>';
  const folder=list=>({characters:'anchors',locations:'plates',props:'props',vehicles:'vehicles'})[list]||'media';
  const plural=(n,word)=>n+' '+word+(n===1?'':'s');
  function context(b) {
    const entity=entityOf(b),A=auto();
    return entity&&A?.stateCoverageContext?A.stateCoverageContext(b.list,entity,b.stateId):{available:false,reason:'Build coverage is unavailable on this page. Reload CineBraid.'};
  }
  const slotOf=(b,entity=entityOf(b))=>(entity?.coverageSlots||[]).find(s=>s.id===b.slotId)||null;
  const viewName=(b,entity)=>{const slot=slotOf(b,entity);return slot?slot.label||slot.id:'';};
  function defaultName(entity){const R=Ref(),id=R?R.defaultStateId(entity):'state-default';return (entityStateListRead(entity,true).find(s=>s.id===id)?.name)||'Default';}

  function open({list,id,stateId,slotId='',method='',source=null}={}) {
    const entity=P?.[list]?.find(x=>x.id===id);
    if(!entity)return toast('This reference is unavailable.');
    if(!Ref()||!auto()?.stateCoverageContext)return toast('Build coverage is unavailable on this page. Reload CineBraid.');
    const ctx=auto().stateCoverageContext(list,entity,stateId);
    if(!ctx.available)return toast(ctx.reason);
    build={token:++serial,slug:ACTIVE_PROJECT_SLUG,epoch:PROJECT_OPEN_EPOCH,revision:PROJECT_REVISION,list,id,stateId,stateName:ctx.state.name||'Default',isDefault:ctx.isDefault,
      slotId:(slotId&&(entity.coverageSlots||[]).some(s=>s.id===slotId))?slotId:(ctx.missing[0]||ctx.views[0]?.slot||(entity.coverageSlots||[]).find(s=>!s.retired))?.id||'',step:'method',source:null,pendingCrop:null,notice:'',
      /* The view the filmmaker actually asked for — the caller's own, or the one they choose here.
         A dialog opened with no view has no requested view, and generation starts with nothing selected. */
      requested:(slotId&&(entity.coverageSlots||[]).some(s=>s.id===slotId))?slotId:'',
      /* PAID GENERATION SAFETY — a flow launched for one view is never opened holding several paid requests.
         The selection is seeded from the requested view alone, when the generate step is entered. */
      assign:{status:'idle',error:'',code:'',bindingId:''},generation:{receiptId:ctx.receiptId,slotIds:[],clientRequestIds:{},status:'idle',error:'',jobIds:[],confirm:false},
      returned:{name:'',ack:false,error:''},sheetUpload:{saved:'',error:''},busy:false};
    if(source&&(method==='sheet'||method==='crop'))return crop(build,source);
    if(method==='sheet')build.step='sheet';
    render({fresh:true});
  }

  /* ---- markup ---- */
  // The Desk's header and view buttons read the same viewStatus/coverageSummary, so the three agree word for word.
  function viewsTable(b,ctx) {
    const R=Ref();
    return '<p class="bc-views-summary" id="bc-views-summary">'+e(R&&ctx.coverage?R.coverageSummary(ctx.coverage):'')+'</p><table class="bc-views" aria-describedby="bc-views-summary"><caption>Required views for '+e(b.stateName)+'</caption><thead><tr><th scope="col">View</th><th scope="col">Status</th></tr></thead><tbody>'+ctx.views.map(v=>{
      const target=v.slot.id===b.slotId;
      return '<tr'+(target?' aria-current="true" class="bc-view-target"':'')+'><th scope="row">'+e(v.slot.label||v.slot.id)+(target?' <small>· target</small>':'')+'</th><td data-bc-status="'+a(v.status)+'">'+e(v.label)+'</td></tr>';
    }).join('')+'</tbody></table>';
  }
  function header(b,entity,ctx) {
    const view=viewName(b,entity);
    return '<header class="bc-head"><div><p class="rd-eyebrow">Reference coverage</p><h3 id="bc-title" tabindex="-1">Build coverage · '+e(entity.name||entity.id)+' · '+e(b.stateName)+'</h3></div><button type="button" class="cancel" data-bc-action="close" '+(b.busy?'disabled':'')+'>Close</button></header>'
      +'<p class="bc-target" id="bc-target">Target: <b>'+e(entity.name||entity.id)+'</b> · <b>'+e(b.stateName)+'</b> · <b>'+e(view||'Choose a view')+'</b></p>'
      +'<p class="bc-approval">'+e(b.stateName)+' reference: <b>'+(ctx.canon?'Approved':'Not approved')+'</b> — approval is a separate decision. Filling a view leaves approval unchanged.</p>';
  }
  function viewSelect(b,ctx,entity) {
    const slots=(entity.coverageSlots||[]).filter(s=>!s.retired&&(ctx.views.some(v=>v.slot.id===s.id)||s.id===b.slotId));
    return '<label class="bc-field">View to fill<select id="bc-view" '+(b.busy||b.pendingCrop?'disabled':'')+'><option value="">Choose a view</option>'+slots.map(s=>{const v=ctx.views.find(x=>x.slot.id===s.id);return '<option value="'+a(s.id)+'" '+(s.id===b.slotId?'selected':'')+'>'+e((s.label||s.id)+(v?.filled?' · filled':v?.earlier?' · earlier selection':''))+'</option>';}).join('')+'</select></label>';
  }
  function generateReason(b,ctx,entity) {
    if(!Ref())return 'Reference readers are unavailable. Reload CineBraid.';
    if(!ctx.canon)return b.isDefault?'Approve a '+b.stateName+' reference first.':'Approve a '+b.stateName+' reference first; '+defaultName(entity)+'’s approval is not used.';
    if(!ctx.primaryEligible)return 'The approved '+b.stateName+' image is unavailable or is not a single view, so it cannot guide generation.';
    if(!ctx.missing.length)return 'Every required view for '+b.stateName+' is filled.';
    if(typeof falGenerationReady!=='function'||!falGenerationReady())return 'Cloud image generation is not set up. Enable it in Settings first.';
    if(typeof entityCoverageActiveJobs==='function'&&entityCoverageActiveJobs(b.list,b.id,'angles').length)return 'Coverage generation is already running for '+(entity.name||entity.id)+'. Review results when it returns.';
    return '';
  }
  function returnedRows(b,entity) {
    const R=Ref(),def=R?R.defaultStateId(entity):'state-default',media=entityMedia(b.list,entity);
    return (entity.candidateFiles||[]).filter(r=>(r.targetStateId||def)===b.stateId&&r.targetCoverageSlotId===b.slotId&&referenceArtifactStructure(r)==='single'&&!r.referenceBinding&&r.decision!=='rejected')
      .map(r=>({row:r,item:media.find(m=>m.name===(r.stored||r.name))})).filter(x=>x.item&&x.item.available!==false);
  }
  function method(label,id,reason,detail) {
    return '<div class="bc-method'+(reason?' is-disabled':'')+'">'+button('data-bc-method="'+id+'" id="bc-method-'+id+'"',label,'','aria-describedby="bc-why-'+id+'"'+(reason?' disabled':''))+'<small id="bc-why-'+id+'">'+(reason?'<b>Unavailable:</b> ':'')+e(reason||detail)+'</small></div>';
  }
  function stepMethod(b,ctx,entity) {
    const view=viewName(b,entity),needView=view?'':'Choose the view to fill first.',returned=b.slotId?returnedRows(b,entity):[];
    return viewSelect(b,ctx,entity)+'<fieldset class="bc-methods"><legend>How do you want to fill '+e(view||'this view')+'?</legend>'
      +method('Generate missing views','generate',generateReason(b,ctx,entity),'Paid cloud requests from the approved '+b.stateName+' reference. You review the cost before anything is sent.')
      +method('Choose from Production Media','media',needView,'Pick an existing image and assign it to '+(view||'the view')+' for '+b.stateName+'.')
      +method('Upload','upload','','A single view, or a multi-view sheet you crop next.')
      +method('Crop from a reference sheet','sheet','','Crop one view at a time from a turnaround or contact sheet.')
      +(returned.length?method('Use a returned result','returned',needView,plural(returned.length,'unassigned result')+' for '+view+' in '+b.stateName+'.'):'')
      +'</fieldset>';
  }
  function stepUpload(b) {
    return '<fieldset class="bc-methods"><legend>What are you uploading?</legend>'
      +method('A single view','upload-single',b.slotId?'':'Choose the view to fill first.','One image that shows exactly one view. It is added as a candidate and assigned to the view you choose.')
      +'<div class="bc-method"><label class="rd-file">A multi-view sheet<input id="bc-sheet-file" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp" '+(b.busy?'disabled':'')+'></label><small>Saved to this reference as a sheet for '+e(b.stateName)+'. A sheet is a source: you crop views from it next.</small>'
      +(b.sheetUpload.saved?button('data-bc-action="sheet-save-retry"','Retry saving the sheet','rd-primary',b.busy?'disabled':''):button('data-bc-action="upload-sheet"','Upload sheet and crop','rd-primary',b.busy?'disabled':''))+'</div>'
      +(b.sheetUpload.error?'<p class="bc-error" role="alert">'+e(b.sheetUpload.error)+'</p>':'')
      +'</fieldset>'+button('data-bc-action="back"','Back');
  }
  function stepSheet(b,entity) {
    const media=entityMedia(b.list,entity),R=Ref(),stateName=id=>entityStateListRead(entity,true).find(s=>s.id===id)?.name||id;
    const sheets=(entity.candidateFiles||[]).filter(r=>referenceArtifactStructure(r)==='sheet').map(r=>({row:r,item:media.find(m=>m.name===(r.stored||r.name))})).filter(x=>x.item&&x.item.available!==false);
    return '<fieldset class="bc-methods"><legend>Choose the sheet to crop</legend><ul class="bc-sheets">'+sheets.map(({row,item})=>{
      const other=row.targetStateId&&row.targetStateId!==b.stateId?'Brought in for '+stateName(row.targetStateId)+'; it cannot supply '+b.stateName+' views.':'';
      // A sheet's own missing record is about the sheet, never about the state being worked on.
      return '<li><button type="button" class="bc-sheet" data-bc-sheet="'+a(item.name)+'" '+(other?'disabled aria-describedby="bc-sheet-'+a(item.name)+'"':'')+'><img src="'+a(item.url)+'" alt=""><span>'+e(row.original||item.name)+'</span></button><small id="bc-sheet-'+a(item.name)+'">'+e(other||(row.targetStateId?'Sheet for '+b.stateName:'No state recorded on this sheet (it does not change '+b.stateName+')'))+'</small></li>';
    }).join('')+'</ul>'+(sheets.length?'':'<p>No sheet has been brought in for this reference yet.</p>')
      +'<div class="bc-row">'+button('data-bc-action="media-sheet" id="bc-action-media-sheet"','Choose a sheet from Production Media')+button('data-bc-method="upload"','Upload a sheet')+'</div></fieldset>'+button('data-bc-action="back"','Back');
  }
  function stepReturned(b,entity) {
    const rows=returnedRows(b,entity),view=viewName(b,entity);
    return '<fieldset class="bc-methods"><legend>Returned results for '+e(view)+' · '+e(b.stateName)+'</legend><ul class="bc-returned">'+rows.map(({row,item})=>'<li><label><input type="radio" id="bc-returned-'+a(item.name)+'" name="bc-returned" value="'+a(item.name)+'" '+(b.returned.name===item.name?'checked':'')+'><img src="'+a(item.url)+'" alt=""><span>'+e(row.original||item.name)+'</span></label></li>').join('')+'</ul>'
      +'<label class="rd-check"><input id="bc-returned-ack" type="checkbox" '+(b.returned.ack?'checked':'')+'> Assign the selected result to '+e(view)+' for '+e(b.stateName)+'.</label>'
      +(b.returned.error?'<p class="bc-error" role="alert">'+e(b.returned.error)+'</p>':'')
      +'<div class="bc-row">'+button('data-bc-action="back"','Back')+button('data-bc-action="returned-assign"','Assign to '+e(view),'rd-primary',(!b.returned.name||!b.returned.ack||b.busy)?'disabled':'')+'</div></fieldset>';
  }
  /* PAID GENERATION SAFETY — ONE REQUESTED VIEW IS ONE PAID REQUEST.
     The view that launched this flow is named, listed first and selected; every other missing
     view starts unchecked and is only added by an explicit press. The main action says what it
     would generate, never a request count the filmmaker did not choose, and nothing is sent
     until the confirmation step's own press. */
  const requestedSlotIds=(b,ctx)=>ctx.available&&b.requested&&ctx.missing.some(s=>s.id===b.requested)?[b.requested]:[];
  const genOrder=(b,ctx)=>[...ctx.missing].sort((x,y)=>(y.id===b.requested?1:0)-(x.id===b.requested?1:0));
  function priceFor(n) {
    return typeof generationPriceLine==='function'&&typeof configuredImageRate==='function'?generationPriceLine({rate:configuredImageRate(typeof CONFIG==='object'?CONFIG:{}),quantity:3*n,local:false}):null;
  }
  // The paid total, or the plain statement that it cannot be shown. Either way the request count is named.
  function quoteLine(n,{sent=0}={}) {
    const price=n?priceFor(n):null,priced=!!price&&price.kind!=='unavailable';
    return '<div class="bc-quote"><b>'+plural(n,'paid request')+' · up to '+plural(3*n,'image')+'</b><span>Cloud · fal (existing coverage owner). Each request is paid.</span>'
      +(priced?'<em data-bc-price-kind="'+a(price.kind)+'">'+e(price.headline)+' · '+e(price.detail)+'</em>'
        :'<em data-bc-price-kind="unavailable">This is a paid request. The total cannot be shown because pricing is unavailable.</em>')
      +(sent?'<span>'+(sent===1?'One of these requests was':sent+' of these requests were')+' already submitted and will not be sent again.</span>':'')+'</div>';
  }
  function stepGenerate(b,ctx,entity) {
    const reason=generateReason(b,ctx,entity),g=b.generation,order=genOrder(b,ctx);
    const requested=(entity.coverageSlots||[]).find(s=>s.id===b.requested)||null,requestedName=requested?(requested.label||requested.id):'';
    const requestedMissing=!!b.requested&&ctx.missing.some(s=>s.id===b.requested);
    const chosen=order.filter(s=>g.slotIds.includes(s.id)),n=chosen.length,names=chosen.map(s=>s.label||s.id);
    const sent=chosen.filter(s=>g.jobIds.some(j=>j.slotId===s.id)).length;
    const onlyRequested=n===1&&chosen[0]?.id===b.requested;
    if(g.status==='submitted')return '<div class="bc-done" role="status"><p><b>'+plural(g.jobIds.length,'request')+' submitted for '+e(b.stateName)+'.</b> Results return as candidates for '+e(b.stateName)+'. Nothing is assigned or approved until you choose.</p></div><div class="bc-row">'+button('data-bc-action="results"','Review results','rd-primary')+button('data-bc-action="close"','Close')+'</div>';
    if(g.confirm)return '<div class="bc-confirm" role="alert"><p id="bc-confirm-target" tabindex="-1"><b>'+(n===1?'Generate '+e(names[0]):'Generate '+n+' views')+' for '+e(entity.name||entity.id)+' · '+e(b.stateName)+'</b></p><ul class="bc-confirm-views">'+chosen.map(s=>'<li>'+e(s.label||s.id)+(s.id===b.requested?' · requested':'')+'</li>').join('')+'</ul><p>Nothing has been sent yet. The next press submits '+e(plural(n,'paid request'))+' and may return up to '+e(plural(3*n,'image'))+'.</p></div>'
      +quoteLine(n,{sent})
      +(g.error?'<p class="bc-error" role="alert">'+e(g.error)+'</p>':'')
      +'<div class="bc-row">'+button('data-bc-action="generate-back"','Back','',b.busy?'disabled':'')+button('data-bc-action="generate-submit"',b.busy?'Submitting…':'Submit '+plural(n,'paid request'),'rd-primary',b.busy?'disabled':'')+'</div>';
    return (reason?'<p class="bc-error" role="alert">'+e(reason)+'</p>':'')
      +'<div class="bc-source">'+(ctx.primary?.url?'<img src="'+a(ctx.primary.url)+'" alt="Approved '+a(b.stateName)+' reference">':'')+'<p><b>Approved '+e(b.stateName)+' reference</b><small>Each request asks for one view of this approved image. Supporting views are only those assigned for '+e(b.stateName)+'.</small></p></div>'
      +'<fieldset class="bc-gen-views"><legend>'+(requestedMissing?'Generate '+e(requestedName)+' for '+e(b.stateName):'Choose the views to generate for '+e(b.stateName))+'</legend>'
      +order.map(s=>{const target=s.id===b.requested;return '<label class="rd-check'+(target?' bc-gen-target':'')+'"><input type="checkbox" id="bc-gen-'+a(s.id)+'" data-bc-gen-slot="'+a(s.id)+'" '+(g.slotIds.includes(s.id)?'checked':'')+' '+(b.busy?'disabled':'')+'> '+e(s.label||s.id)+(target?' <small>· requested</small>':'')+'</label>';}).join('')
      +'<p class="bc-gen-note">'+(requestedMissing?'Only '+e(requestedName)+' is selected. Other missing views are added only if you choose them.':'Nothing is selected. Choose each view you want to pay for.')+'</p></fieldset>'
      +(ctx.missing.length>1?'<div class="bc-row bc-gen-scope">'+(n<ctx.missing.length?button('data-bc-action="generate-all" id="bc-gen-all"','Select all missing views','',b.busy?'disabled':''):'')+(requestedMissing&&!onlyRequested?button('data-bc-action="generate-only" id="bc-gen-only"','Select only '+e(requestedName),'',b.busy?'disabled':''):'')+'</div>':'')
      +(n?quoteLine(n,{sent}):'<p class="bc-gen-empty">No view is selected, so nothing would be sent.</p>')
      +(g.error?'<p class="bc-error" role="alert">'+e(g.error)+'</p>':'')
      +'<div class="bc-row">'+button('data-bc-action="back"','Back','',b.busy?'disabled':'')+button('data-bc-action="generate-review"',b.busy?'Preparing… nothing has been sent yet':n===1?'Generate '+e(names[0]):n>1?'Generate '+n+' views':'Generate '+e(requestedName||'view'),'rd-primary',(reason||!n||b.busy)?'disabled':'')+'</div>';
  }
  function stepAssign(b,entity,ctx) {
    const view=viewName(b,entity),s=b.assign,asset=b.pendingCrop?.assetId||b.source?.assetId||'',what=b.pendingCrop?'The crop is saved as a candidate. ':'';
    const detail='<details class="bc-detail"><summary>Failure detail</summary><pre>'+e(['Target: '+(entity.name||entity.id)+' · '+b.stateName+' · '+view,'Asset: '+asset,'Crop candidate: '+(b.pendingCrop?.stored||'—'),'Source: '+(b.source?.name||'—'),'Code: '+(s.code||'—')].join('\n'))+'</pre></details>';
    if(s.status==='saving')return '<p class="bc-status" role="status">Assigning '+e(view)+' for '+e(b.stateName)+'…</p>';
    if(s.status==='refreshing')return '<p class="bc-status" role="status">Re-reading the saved project. Nothing is assigned.</p>';
    if(s.status==='stale')return '<p class="bc-error" role="alert">The project changed while this was open. Refresh the target before assigning.</p>'+detail+'<div class="bc-row">'+button('data-bc-action="refresh-target" id="bc-refresh-target"','Refresh target','rd-primary')+button('data-bc-action="keep"','Keep as candidate')+'</div>';
    // Refreshed: the target, as the saved project now has it, is shown before anything is written. Only the next press assigns.
    if(s.status==='confirm'){
      const v=ctx.views.find(x=>x.slot.id===b.slotId),now=!v?view+' is not a required view for '+b.stateName+'.':v.filled?view+' for '+b.stateName+' is filled now. Assigning replaces its current image; that image stays a candidate.':v.earlier?view+' for '+b.stateName+': '+v.label+'. Assigning fills it for '+b.stateName+'.':view+' for '+b.stateName+' is not filled.';
      return '<p class="bc-status" role="status" id="bc-confirm-now" data-bc-now="'+a(v?v.status:'optional')+'">'+e(now)+'</p><p class="bc-target-line">'+e(what)+'Target: <b>'+e(entity.name||entity.id)+'</b> · <b>'+e(b.stateName)+'</b> · <b>'+e(view)+'</b></p><div class="bc-row">'+button('data-bc-action="assign-confirm" id="bc-assign-confirm"','Assign to '+e(view)+' for '+e(b.stateName),'rd-primary')+button('data-bc-action="keep"','Keep as candidate')+'</div>';
    }
    if(s.status==='unknown')return '<p class="bc-error" role="alert">'+e(what)+(s.code==='unconfirmed'?'The assignment was saved. CineBraid could not re-read the project here to show it.':'CineBraid could not confirm whether the assignment was saved.')+'</p>'+detail+'<div class="bc-row">'+button('data-bc-action="assign-retry"','Check and retry','rd-primary')+button('data-bc-action="keep"','Keep as candidate')+'</div>';
    if(s.status==='failed')return '<p class="bc-error" role="alert">'+e(what)+'Assigning it to '+e(view)+' for '+e(b.stateName)+' was not saved: '+e(s.error)+'</p>'+detail+'<div class="bc-row">'+button('data-bc-action="assign-retry"','Retry assignment','rd-primary')+button('data-bc-action="keep"','Keep as candidate')+'</div>';
    return '<p class="bc-status" role="status">Ready to assign to '+e(view)+' for '+e(b.stateName)+'.</p>';
  }
  function stepDone(b,entity,ctx) {
    const view=viewName(b,entity),more=ctx.missing.filter(s=>s.id!==b.slotId);
    const text=b.doneKind==='candidate'?'Crop saved as a candidate. No view changed.':b.doneKind==='kept'?'The '+(b.pendingCrop?'crop':'image')+' stays a candidate. No view changed.':view+' is filled for '+b.stateName+'. Approval is unchanged.';
    return '<div class="bc-done" role="status"><p><b>'+e(text)+'</b></p></div><div class="bc-row">'+(more.length?button('data-bc-action="next"','Build next missing view','rd-primary'):'')+(view?button('data-bc-action="results"','Review '+e(view)+' results'):'')+button('data-bc-action="close"','Close',more.length?'':'rd-primary')+'</div>';
  }
  function render({fresh=false,focus='bc-title'}={}) {
    const b=build;if(!b)return;
    if(!inScope(b))return lost(b);
    const entity=entityOf(b),ctx=context(b);
    if(!ctx.available){build=null;if(modal())closeModal();return toast(ctx.reason);}
    if(b.slotId&&!slotOf(b,entity))b.slotId='';
    const body=b.step==='upload'?stepUpload(b):b.step==='sheet'?stepSheet(b,entity):b.step==='returned'?stepReturned(b,entity):b.step==='generate'?stepGenerate(b,ctx,entity):b.step==='assign'?stepAssign(b,entity,ctx):b.step==='done'?stepDone(b,entity,ctx):stepMethod(b,ctx,entity);
    const html='<div class="bc-dialog" data-build-coverage data-bc-step="'+a(b.step)+'">'+header(b,entity,ctx)+(b.notice?'<p class="bc-note" role="status">'+e(b.notice)+'</p>':'')+'<div class="bc-layout"><section class="bc-work">'+body+'</section><aside class="bc-side">'+viewsTable(b,ctx)+'</aside></div></div>';
    if(fresh||!modal()||!updateOpenModal(html)){openModal(html);document.querySelector('#modal .modal-box')?.classList.add('rd-picker-box','bc-box');}
    if(focus)setTimeout(()=>{if(build===b)document.getElementById(focus)?.focus({preventScroll:true});},0);
  }
  function lost(b) {
    if(build===b)build=null;
    if(modal())closeModal();
    toast('The open project or reference changed. Build coverage closed; nothing further was changed.');
  }

  /* ---- crop ---- */
  function crop(b,source) {
    if(!inScope(b))return lost(b);
    const entity=entityOf(b);
    if(source.kind==='entity'&&!entityMedia(b.list,entity).some(m=>m.name===source.name))return toast('That sheet is unavailable.');
    b.source={...source};b.step='crop';
    if(modal())closeModal({restoreFocus:false});
    openCoverageSheetExtractor(b.list,b.id,source.name,true,{token:b.token,stateId:b.stateId,slotId:b.slotId,source:b.source});
  }
  async function cropSave(assign) {
    const b=build,state=window._coverageCrop;
    if(!b||!state?.guided||state.guided.token!==b.token)return toast('This crop belongs to a Build coverage session that closed. Reopen Build coverage.');
    if(!state.acknowledged||state.saving)return;
    if(!inScope(b))return lost(b);
    const pressed=document.getElementById(assign?'coverage-crop-guided-assign':'coverage-crop-guided-candidate');
    b.slotId=state.slotId;b.requested=state.slotId;
    const saved=await auto().saveCoverageCropCandidate(state,{assign:false,targetStateId:b.stateId});
    if(build!==b)return;
    if(!saved.ok){
      if(saved.busy)return;
      // The upload is kept: a retry completes it and never uploads twice. The view it was made for is fixed from here.
      if(pressed)pressed.textContent='Retry saving crop';
      const select=document.getElementById('coverage-crop-slot');if(select&&state.pendingCrop)select.disabled=true;
      return;
    }
    b.pendingCrop={stored:saved.row.stored,assetId:saved.assetId,stateId:b.stateId,slotId:state.slotId,saved:true};
    b.revision=PROJECT_REVISION;
    if(!assign){b.step='done';b.doneKind='candidate';return render({fresh:true});}
    b.step='assign';render({fresh:true});
    return runAssign(b);
  }
  function cancelCrop() {
    const b=build;closeModal();
    if(!b||!inScope(b))return;
    b.step=b.pendingCrop?'done':'method';b.doneKind=b.pendingCrop?'candidate':'';
    render({fresh:true});
  }

  /* ---- assignment ---- */
  async function runAssign(b=build,{refresh=false}={}) {
    if(!b||b.busy)return;
    if(!inScope(b))return lost(b);
    const entity=entityOf(b),assetId=b.pendingCrop?.assetId||b.source?.assetId||'';
    if(!slotOf(b,entity)){b.assign={status:'failed',error:'This view no longer exists.',code:'scope',bindingId:''};return render();}
    let reread=false;
    b.busy=true;
    try {
      if(refresh){
        // An unknown outcome is checked against a re-read project; if it cannot be re-read, nothing is sent again.
        const refreshed=await load({intent:'refresh'});if(build!==b)return;if(!inScope(b))return lost(b);
        if(refreshed&&refreshed.committed===false){b.assign={status:'unknown',error:'',code:'unknown',bindingId:''};b.notice='CineBraid could not re-read the project ('+(refreshed.reason||'refresh refused')+'). Nothing was sent; check again.';return;}
        b.revision=PROJECT_REVISION;b.notice='';
        // And it reuses the EXACT saved crop: if that row left the reference while this was open, nothing is assigned in its place.
        if(b.pendingCrop&&!(entityOf(b)?.candidateFiles||[]).some(r=>(r.stored||r.name)===b.pendingCrop.stored)){b.assign={status:'failed',error:'The saved crop is no longer on this reference.',code:'scope',bindingId:''};return;}
      }
      if(PROJECT_REVISION!==b.revision){b.assign={status:'stale',error:'',code:'stale',bindingId:''};return;}
      b.assign={status:'saving',error:'',code:'',bindingId:''};render();
      const result=await CineBraidReferenceDesk.enrollExact({slug:b.slug,epoch:b.epoch,list:b.list,id:b.id,stateId:b.stateId,slotId:b.slotId,assetId,revision:PROJECT_REVISION});
      if(build!==b)return;
      b.assign={status:'done',error:'',code:'',bindingId:result.bindingId};b.revision=PROJECT_REVISION;b.step='done';b.doneKind='assigned';b.notice='';
    }catch(error){
      if(build!==b)return;
      if(error.code==='scope'&&(b.slug!==ACTIVE_PROJECT_SLUG||b.epoch!==PROJECT_OPEN_EPOCH)){b.busy=false;return lost(b);}
      // The server's revision moved: the same If-Match can only be refused again. Re-read and show the target; never re-post blind.
      reread=error.code==='PROJECT_REVISION_CONFLICT'||error.action==='reload';
      const unknown=error.code==='unknown'||error.code==='unverified'||error.code==='unconfirmed';
      b.assign=reread?{status:'refreshing',error:'',code:error.code||'reload',bindingId:''}:{status:unknown?'unknown':'failed',error:error.message||'The assignment was not saved.',code:error.code||'refused',bindingId:''};
    }finally{
      if(build===b){b.busy=false;if(!reread)render();}
    }
    if(reread&&build===b)return refreshTarget(b,{conflict:true});
  }
  /* Refresh target is a read. It re-reads the saved project, re-checks the entity, state, view and the
     exact pending image, and then shows the target and whether the view is filled now. Nothing is
     assigned until "Assign to <View> for <State>" is pressed. */
  async function refreshTarget(b,{conflict=false}={}) {
    if(!b||b.busy)return;
    if(!inScope(b))return lost(b);
    const stale=(notice)=>{b.assign={status:'stale',error:'',code:'stale',bindingId:''};b.notice=notice;};
    const refuse=(message,code)=>{b.assign={status:'failed',error:message,code,bindingId:''};};
    b.busy=true;b.assign={status:'refreshing',error:'',code:b.assign.code||'',bindingId:''};render({focus:''});
    try {
      const refreshed=await load({intent:'refresh'});if(build!==b)return;if(!inScope(b))return lost(b);
      if(refreshed&&refreshed.committed===false)return stale('CineBraid could not re-read the project ('+(refreshed.reason||'refresh refused')+'). Nothing was assigned; refresh again.');
      const entity=entityOf(b),ctx=context(b),assetId=b.pendingCrop?.assetId||b.source?.assetId||'';
      if(!ctx.available)return refuse(ctx.reason,'scope');
      if(!slotOf(b,entity))return refuse('This view no longer exists.','scope');
      if(b.pendingCrop&&!(entity.candidateFiles||[]).some(r=>(r.stored||r.name)===b.pendingCrop.stored))return refuse('The saved crop is no longer on this reference.','scope');
      const inventory=await fetch('/api/references/media?project='+encodeURIComponent(b.slug),{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
      if(build!==b)return;if(!inScope(b))return lost(b);
      if(!inventory)return stale('CineBraid could not check the exact image. Nothing was assigned; refresh again.');
      const image=(inventory.images||[]).find(r=>r.assetId===assetId);
      if(!image?.available)return refuse('The exact image is unavailable ('+(image?.reason||'missing')+'). Nothing was assigned.','refused');
      b.revision=PROJECT_REVISION;
      const bound=Ref().findExactBinding(entityOf(b),{assetId,stateId:b.stateId,slotId:b.slotId});
      if(bound){
        b.assign={status:'done',error:'',code:'',bindingId:Ref().keyOf(bound)};b.step='done';b.doneKind='assigned';b.notice='The saved project already has this image assigned. Nothing new was written.';return;
      }
      b.assign={status:'confirm',error:'',code:'',bindingId:''};
      b.notice=(conflict?'The project changed before the assignment was saved, so nothing was assigned. ':'')+'The target was re-read from the saved project. Check it, then assign.';
    }catch(error){if(build===b)stale('CineBraid could not re-read the project ('+(error.message||'refresh failed')+'). Nothing was assigned; refresh again.');}
    finally{if(build===b){b.busy=false;render({focus:b.assign.status==='confirm'?'bc-assign-confirm':b.assign.status==='stale'?'bc-refresh-target':'bc-title'});}}
  }

  /* ---- generation ---- */
  /* NOTHING IS SENT BEFORE THE CONFIRMATION PRESS. review() only shows the exact targets and
     the paid count; submitGeneration() refuses to send unless that confirmation is on screen. */
  function reviewGeneration(b) {
    if(!b||b.busy)return;
    if(!inScope(b))return lost(b);
    const g=b.generation,ctx=context(b);
    if(ctx.available)g.slotIds=g.slotIds.filter(id=>ctx.missing.some(s=>s.id===id)||g.jobIds.some(j=>j.slotId===id));
    if(!g.slotIds.length||generateReason(b,ctx,entityOf(b)))return render();
    // Focus lands on the confirmation itself, never on the control that would pay for it.
    g.confirm=true;g.error='';return render({focus:'bc-confirm-target'});
  }
  async function submitGeneration(b) {
    if(!b||b.busy)return;
    if(!inScope(b))return lost(b);
    const g=b.generation,before=context(b);
    if(before.available)g.slotIds=g.slotIds.filter(id=>before.missing.some(s=>s.id===id)||g.jobIds.some(j=>j.slotId===id));
    const count=g.slotIds.length;
    if(!count)return render();
    // A press that arrives without the confirmation on screen shows it instead of submitting.
    if(!g.confirm){g.confirm=true;return render();}
    b.busy=true;g.error='';render();
    try {
      // Nothing is sent while preparing: the open project must be saved and the approval re-read first.
      await flushPendingProjectSave();
      const settled=projectSaveSettled();
      if(!settled.settled)throw Object.assign(Error((settled.reason||'The project is not saved.')+' Nothing was submitted.'),{stop:true});
      if(!inScope(b))throw Object.assign(Error('The open project changed. Nothing was submitted.'),{lost:true});
      const entity=entityOf(b),ctx=context(b);
      if(!ctx.available)throw Error(ctx.reason+' Nothing was submitted.');
      // The approval this dialog showed is the one that must still hold. A change is shown, never silently spent.
      if(ctx.receiptId!==g.receiptId){g.receiptId=ctx.receiptId;throw Error('The '+b.stateName+' approval changed while this was open. Review the new source above before submitting. Nothing was submitted.');}
      const reason=g.jobIds.length?'':generateReason(b,ctx,entity);if(reason)throw Error(reason+' Nothing was submitted.');
      const slots=g.slotIds.map(id=>(entity.coverageSlots||[]).find(s=>s.id===id));
      if(slots.some(s=>!s))throw Error('A chosen view no longer exists. Nothing was submitted.');
      const A=auto(),R=Ref(),direction=String(entity.coverageGenerationNotes||'');
      for(const slot of slots){
        if(g.jobIds.some(j=>j.slotId===slot.id))continue;
        const clientRequestId=g.clientRequestIds[slot.id]||(g.clientRequestIds[slot.id]=A.coverageClientRequestId(b.list,b.id,'slot',b.stateId+':'+slot.id));
        const job=await A.submitCoverageJob(b.list,entity,{prompt:A.coverageSlotPrompt(b.list,entity,slot,direction),outputCount:3,resolution:'4k',aspectRatio:referenceAspectLabel(b.list),coverageJobType:'slot',coverageMode:'individual',requestCount:count,maximumImages:3*count,slot,stateId:b.stateId,stateName:b.stateName,clientRequestId});
        // The server reuses an active job for the same view regardless of state; a reused job for another state is not this request.
        if((job?.continuityStateId||R.defaultStateId(entity))!==b.stateId||job?.targetCoverageSlotId!==slot.id)throw Object.assign(Error('An active request for '+(slot.label||slot.id)+' in another state is still running; nothing new was submitted for '+b.stateName+'.'),{stop:true});
        g.jobIds.push({slotId:slot.id,jobId:job.id});
      }
      g.status='submitted';
      await load({intent:'refresh'}).catch(()=>{});
    }catch(error){
      g.status='failed';g.error=error.message||'The request could not be submitted.';g.confirm=false;
      if(error.lost){b.busy=false;return lost(b);}
    }finally{
      if(build===b){b.busy=false;render();}
    }
  }

  /* ---- sheet and returned sources ---- */
  async function uploadSheet(b) {
    if(!b||b.busy)return;
    if(!inScope(b))return lost(b);
    const file=document.getElementById('bc-sheet-file')?.files?.[0];
    if(!file){b.sheetUpload.error='Choose the sheet image first.';return render({focus:'bc-sheet-file'});}
    b.busy=true;b.sheetUpload.error='';
    try {
      const {saved,settled}=await intakeEntityFiles({list:b.list,id:b.id,files:[file],structure:'sheet',targetStateId:b.stateId,targetStateName:b.stateName});
      if(build!==b)return;
      if(!saved.length)throw Error('The sheet could not be uploaded. Nothing was added.');
      b.sheetUpload.saved=saved[0];
      if(!settled.settled)throw Error('The sheet is on disk but this reference is not saved yet, so it cannot be cropped. '+(settled.reason||''));
      b.busy=false;return crop(b,{kind:'entity',name:saved[0]});
    }catch(error){if(build===b)b.sheetUpload.error=error.message;}
    finally{if(build===b&&b.busy){b.busy=false;render();}}
  }
  async function retrySheetSave(b) {
    if(!b||b.busy||!b.sheetUpload.saved)return;
    b.busy=true;
    try {
      await flushPendingProjectSave();const settled=projectSaveSettled();
      if(!settled.settled)throw Error('The sheet is on disk but this reference is not saved yet. '+(settled.reason||''));
      b.busy=false;return crop(b,{kind:'entity',name:b.sheetUpload.saved});
    }catch(error){if(build===b)b.sheetUpload.error=error.message;}
    finally{if(build===b&&b.busy){b.busy=false;render();}}
  }
  async function assignReturned(b) {
    if(!b||b.busy||!b.returned.name||!b.returned.ack)return;
    if(!inScope(b))return lost(b);
    const entity=entityOf(b);
    if(!returnedRows(b,entity).some(x=>x.item.name===b.returned.name)){b.returned.error='That result is no longer available for this view.';return render();}
    b.busy=true;
    try {
      const response=await fetch('/api/media/prepare-identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectSlug:b.slug,dir:folder(b.list),name:b.returned.name})});
      const prepared=await response.json().catch(()=>({}));
      if(!response.ok||prepared.status!=='ready'||!prepared.assetId)throw Error('This result’s identity is not ready. Nothing was assigned; retry.');
      if(build!==b)return;
      b.source={kind:'returned',name:b.returned.name,assetId:prepared.assetId};b.revision=PROJECT_REVISION;b.step='assign';b.busy=false;
      render();return runAssign(b);
    }catch(error){if(build===b){b.returned.error=error.message;b.busy=false;render();}}
  }

  /* ---- events ---- */
  function act(t) {
    const b=build;if(!b)return;
    if(t.hasAttribute('data-bc-sheet'))return crop(b,{kind:'entity',name:t.dataset.bcSheet});
    const m=t.dataset.bcMethod,x=t.dataset.bcAction;
    if(m){
      if(!inScope(b))return lost(b);
      if(m==='generate'){
        const g=b.generation,ctx=context(b);
        if(g.status==='submitted')Object.assign(g,{status:'idle',jobIds:[],clientRequestIds:{},error:''});
        // Entering, and re-entering, selects the requested view alone — never every missing view.
        if(ctx.available&&!g.jobIds.length)g.slotIds=requestedSlotIds(b,ctx);
        b.step='generate';g.confirm=false;return render();
      }
      if(m==='media')return toPicker(b,{upload:false},'method','bc-method-media');
      if(m==='upload-single')return toPicker(b,{upload:true},'upload','bc-method-upload-single');
      if(m==='upload'||m==='sheet'||m==='returned'){b.step=m;return render();}
    }
    if(x==='close'){const slot=b.slotId;build=null;closeModal();return window.CineBraidReferenceDesk?.focusSlot?.(slot);}
    if(x==='back'){b.step='method';b.generation.confirm=false;return render();}
    if(x==='generate-back'){b.generation.confirm=false;return render();}
    if(x==='generate-all'){const ctx=context(b);if(ctx.available)b.generation.slotIds=ctx.missing.map(s=>s.id);b.generation.confirm=false;return render({focus:'bc-gen-only'});}
    if(x==='generate-only'){const ctx=context(b);b.generation.slotIds=requestedSlotIds(b,ctx);b.generation.confirm=false;return render({focus:'bc-gen-all'});}
    if(x==='generate-review')return reviewGeneration(b);
    if(x==='generate-submit')return submitGeneration(b);
    if(x==='results'){const scope={list:b.list,id:b.id,stateId:b.stateId,slotId:b.slotId};build=null;closeModal();return CineBraidResults.open(scope);}
    if(x==='media-sheet')return toPicker(b,{sheetMode:true},'sheet','bc-action-media-sheet');
    if(x==='upload-sheet')return uploadSheet(b);
    if(x==='sheet-save-retry')return retrySheetSave(b);
    if(x==='returned-assign')return assignReturned(b);
    if(x==='assign-retry')return runAssign(b,{refresh:b.assign.status==='unknown'});
    if(x==='refresh-target')return refreshTarget(b);
    if(x==='assign-confirm'&&b.assign.status==='confirm')return runAssign(b);
    if(x==='keep'){b.step='done';b.doneKind='kept';return render();}
    if(x==='next'){
      const ctx=context(b),next=ctx.available?ctx.missing.find(s=>s.id!==b.slotId):null;
      Object.assign(b,{slotId:next?.id||b.slotId,requested:next?.id||b.requested,pendingCrop:null,assign:{status:'idle',error:'',code:'',bindingId:''},returned:{name:'',ack:false,error:''},notice:'',step:'method'});
      if(b.source&&(b.source.kind==='entity'||b.source.kind==='media'))return crop(b,b.source);
      b.source=null;return render({focus:'bc-view'});
    }
  }
  /* The picker replaces this dialog. Build coverage closes without a deferred focus restore (which would land
     behind the picker), and a Cancel, Escape or backdrop dismissal of the picker returns here, to the step and
     the control that opened it. */
  function toPicker(b,options,step,control) {
    const own=b;closeModal({restoreFocus:false});
    const opened=CineBraidReferenceDesk.openPickerFor({list:b.list,id:b.id,stateId:b.stateId,slotId:b.slotId,...options,onDone:done=>finishPicker(own,done),onCancel:()=>resumeFromPicker(own,step,control)});
    if(opened===false)resumeFromPicker(own,step,control);
    return opened;
  }
  function resumeFromPicker(b,step,control) {
    if(build!==b)return;
    if(!inScope(b))return lost(b);
    // The Desk control for this view becomes the dialog's opener again, so closing Build coverage later still returns focus to the Desk.
    ([...document.querySelectorAll('[data-rd-slot]')].find(el=>el.dataset.rdSlot===b.slotId)||document.querySelector('[data-rd-action="build"]'))?.focus?.({preventScroll:true});
    b.step=step;render({fresh:true,focus:control});
  }
  function finishPicker(b,done) {
    if(build!==b||!inScope(b))return;
    b.slotId=done?.slotId||b.slotId;b.assign={status:'done',error:'',code:'',bindingId:done?.bindingId||''};b.step='done';b.doneKind='assigned';b.revision=PROJECT_REVISION;
    render({fresh:true});
  }
  document.addEventListener('click',event=>{
    const t=event.target.closest?.('[data-build-coverage] [data-bc-method],[data-build-coverage] [data-bc-action],[data-build-coverage] [data-bc-sheet]');
    if(!t||t.disabled)return;
    act(t);
  });
  document.addEventListener('change',event=>{
    const t=event.target,b=build;if(!b||!t.closest?.('[data-build-coverage]'))return;
    // Choosing the view here IS the request; the generation selection follows it and never grows past it.
    if(t.id==='bc-view'){b.slotId=t.value;b.requested=t.value;b.returned={name:'',ack:false,error:''};if(!b.generation.jobIds.length){b.generation.slotIds=requestedSlotIds(b,context(b));b.generation.confirm=false;}return render({focus:'bc-view'});}
    if(t.hasAttribute('data-bc-gen-slot')){const id=t.dataset.bcGenSlot;b.generation.slotIds=t.checked?[...new Set([...b.generation.slotIds,id])]:b.generation.slotIds.filter(x=>x!==id);b.generation.confirm=false;return render({focus:'bc-gen-'+id});}
    if(t.name==='bc-returned'){b.returned.name=t.value;b.returned.ack=false;b.returned.error='';return render({focus:'bc-returned-'+t.value});}
    if(t.id==='bc-returned-ack'){b.returned.ack=t.checked;return render({focus:'bc-returned-ack'});}
  });
  // A project switch closes the flow: a target from another open project is never assigned.
  window.addEventListener('cinebraid:route-rendered',()=>{if(build&&(build.slug!==ACTIVE_PROJECT_SLUG||build.epoch!==PROJECT_OPEN_EPOCH)){build=null;if(modal())closeModal();}});
  window.CineBraidBuildCoverage={open,cropSave,cancelCrop,state:()=>build};
})();
