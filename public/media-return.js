/* Ephemeral navigation only: no storage, selection authority or project writes. */
(function(){
  let origin=null,pending=false;
  function capture(extra={}){const control=document.activeElement;return {slug:ACTIVE_PROJECT_SLUG,epoch:PROJECT_OPEN_EPOCH,hash:location.hash,scroll:document.getElementById('main')?.scrollTop||0,focus:control?.getAttribute('data-md-open')||control?.getAttribute('data-md-inspect')||'',view:typeof captureRouteViewState==='function'?captureRouteViewState():null,...extra};}
  function valid(){return origin&&origin.slug===ACTIVE_PROJECT_SLUG&&origin.epoch===PROJECT_OPEN_EPOCH;}
  function go(hash,saved){if(!saved)return false;origin=saved;closeModal({restoreFocus:false});location.hash=hash;if(location.hash===hash&&typeof route==='function')route();return true;}
  function back(){if(!valid()){origin=null;return;}pending=true;closeModal({restoreFocus:false});if(location.hash===origin.hash)route();else location.hash=origin.hash;}
  window.addEventListener('cinebraid:route-rendered',()=>{
    if(!valid()){origin=null;return;}
    if(pending&&location.hash===origin.hash){const saved=origin;pending=false;origin=null;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(saved.view&&typeof applyRouteDisclosureState==='function')applyRouteDisclosureState(saved.view);document.getElementById('main').scrollTop=saved.scroll;if(saved.resume)saved.resume();else {const el=[...document.querySelectorAll('[data-md-open]')].find(x=>x.dataset.mdOpen===saved.focus);el?.focus({preventScroll:true});}}));return;}
    if(location.hash!==origin.hash||origin.resume){const main=document.getElementById('main');if(main&&!main.querySelector('[data-media-return]')){const button=document.createElement('button');button.type='button';button.className='md-return';button.dataset.mediaReturn='';button.textContent=origin.resume?'Return to media selection':'Return to Production media';button.onclick=back;(main.querySelector('.reference-desk,.shot-desk')||main).prepend(button);}}
  });
  window.CineBraidMediaReturn={capture,go,back,cancel(){origin=null;pending=false;}};
})();
