/* Ephemeral navigation only: no storage, selection authority or project writes. */
(function(){
  let origin=null,pending=false;
  function capture(extra={}){const control=document.activeElement;return {slug:ACTIVE_PROJECT_SLUG,epoch:PROJECT_OPEN_EPOCH,hash:location.hash,scroll:document.getElementById('main')?.scrollTop||0,controlId:control?.id||'',controlText:control?.textContent||'',focus:control?.getAttribute('data-md-open')||control?.getAttribute('data-md-inspect')||'',view:typeof captureRouteViewState==='function'?captureRouteViewState():null,...extra};}
  function valid(){return origin&&origin.slug===ACTIVE_PROJECT_SLUG&&origin.epoch===PROJECT_OPEN_EPOCH;}
  function go(hash,saved){if(!saved)return false;origin=saved;closeModal({restoreFocus:false});const same=location.hash===hash;location.hash=hash;if(same&&typeof route==='function')route();return true;}
  function back(){if(!valid()){origin=null;return;}pending=true;closeModal({restoreFocus:false});if(location.hash===origin.hash)route();else location.hash=origin.hash;}
  window.addEventListener('cinebraid:route-rendered',()=>{
    if(!valid()){origin=null;return;}
    if(pending&&location.hash===origin.hash){const saved=origin;pending=false;origin=null;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(saved.view&&typeof applyRouteDisclosureState==='function')applyRouteDisclosureState(saved.view);document.getElementById('main').scrollTop=saved.scroll;if(saved.resume)saved.resume();else {const el=(saved.controlId&&document.getElementById(saved.controlId))||[...document.querySelectorAll('[data-md-open],button,a')].find(x=>saved.focus?x.dataset.mdOpen===saved.focus:x.textContent===saved.controlText);el?.focus({preventScroll:true});}}));return;}
    if(location.hash!==origin.hash||origin.resume){const main=document.getElementById('main');if(main&&!main.querySelector('[data-media-return]')){const button=document.createElement('button');button.type='button';button.className='md-return';button.dataset.mediaReturn='';button.textContent=origin.label||(origin.resume?'Return to media selection':'Return to Production media');button.onclick=back;(main.querySelector('.reference-desk,.shot-desk,.results-desk')||main).prepend(button);}}
  });
  window.CineBraidMediaReturn={capture,go,back,matches(hash){return valid()&&origin.hash===hash;},cancel(){origin=null;pending=false;}};
})();
