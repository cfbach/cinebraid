#!/usr/bin/env python3
"""EV2-4 actual application workflow proof. Disposable synthetic fixtures only."""
import ast,json,os,pathlib,socket,struct,subprocess,sys,tempfile,time,urllib.request,zlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from browser_runtime import disposable_workspace,require_browser,launch_chromium,canon_receipts
source=(ROOT/'tests/ev2-3-media-real-browser.py').read_text(encoding='utf-8-sig')
functions=[n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name in ('free_port','png','iso','build_fixture')]
exec(compile(ast.Module(body=functions,type_ignores=[]),'<synthetic builders>','exec'))
OUT=pathlib.Path(os.environ.get('EV2_ACCEPTANCE_DIR') or tempfile.mkdtemp(prefix='cinebraid-bible-qa-'));OUT.mkdir(parents=True,exist_ok=True)
w=disposable_workspace('ev2-4-working-bible',sample=False,active_project='o5-media-qa');slug=build_fixture(w.projects_root)
pf=w.projects_root/slug/'project.json';p=json.loads(pf.read_text(encoding='utf-8'))
p['meta']['title']='Signal House · Synthetic production'
p['meta']['world']={'setting':'An isolated coastal relay station during the last night of its operation.','include':'Salt-stained surfaces and practical work lights.','reject':'No ornamental science-fiction interfaces.'}
p['meta']['globalStylePrompt']='Quiet observation. Deep shadow, weathered surfaces and restrained pools of warm light.'
p['characters'][0]['creationDescription']='A maintenance engineer in a worn work coat. Practical, composed, visibly tired.'
p['characters'][0]['notes']='Kai measures each answer before speaking. Silence carries the tension.'
p['locations'][0]['creationDescription']='An exposed maintenance bay facing the sea. Keep scale legible.'
p['shots'][0]['codes']=['KAI','HULL']
for i in range(247):p['characters'].append({'id':f'CAST-{i:03}','name':f'Crew member {i:03}','notes':'Synthetic large-cast record.','creationDescription':'Unspecified.','candidateFiles':[]})
pf.write_text(json.dumps(p),encoding='utf-8')
port=free_port();base=f'http://127.0.0.1:{port}';log=open(OUT/'browser-runtime.log','w',encoding='utf-8')
server=subprocess.Popen(['node','server.js'],cwd=ROOT,env=w.env(port),stdout=log,stderr=log)
held=[];checks=[];errors=[];blocked=[];save_mode='ok';authority_mode='ok';mutations=[]
def check(name,value):
 checks.append({'check':name,'passed':bool(value)});assert value,name
def capture(page,name):page.screenshot(path=str(OUT/(name+'.png')),full_page=False)
try:
 for _ in range(160):
  try:urllib.request.urlopen(base+'/api/project',timeout=1);break
  except Exception:time.sleep(.15)
 with require_browser('EV2-4 Working Bible')() as pw:
  browser=launch_chromium(pw,headless=True);context=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
  def guard(r):
   global save_mode
   url=r.request.url
   if url.startswith(('data:','blob:')):return r.continue_()
   if not url.startswith(base+'/'):
    if 'fonts.google' in url:return r.fulfill(status=200,body='')
    blocked.append(url);return r.abort()
   if url==base+'/api/project/ask':return r.fulfill(status=200,content_type='application/json',body=json.dumps({'answer':'Suggested creative intent: Kai speaks only when the machinery falls silent. Review this wording before saving it.'}))
   if '/api/bible' in url and '/export' not in url:
    if authority_mode=='hold':held.append(r);return
    if authority_mode=='error':return r.fulfill(status=503,content_type='application/json',body='{"error":"Synthetic read failure"}')
    if authority_mode=='delay':time.sleep(.7)
   if r.request.method not in ('GET','HEAD'):
    mutations.append({'url':url.replace(base,''),'method':r.request.method})
    if url.split('?')[0] not in (base+'/api/project',base+'/api/projects/'+slug+'/project',base+'/api/local-file/resolve',base+'/api/shots/SH010/folder'):
     blocked.append(url);return r.abort()
    if r.request.method=='PUT' and save_mode=='fail':return r.fulfill(status=503,content_type='application/json',body='{"error":"Synthetic save failure"}')
   r.continue_()
  context.route('**/*',guard)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base+'/#/bible/project');page.locator('.wb-document h2').wait_for();page.wait_for_function('projectSaveSettled().settled');page.wait_for_timeout(500)
  baseline=page.evaluate('JSON.stringify(P.productionAuthority)')
  check('Editor navigation owns Bible',page.locator('.nav-btn[data-view="bible"]').count()==1)
  check('Only real project creative fields shown','The creative foundation' in page.locator('.wb-document').inner_text())
  check('Large cast is bounded',page.locator('.wb-rows>a').count()==40)
  for width,height in ((1280,720),(1440,900),(1920,1080),(390,844)):
   page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(120);capture(page,f'overview-{width}')
   check(f'No horizontal page obstruction {width}',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  page.set_viewport_size({'width':1440,'height':900})
  page.locator('[data-wb="next"]').click();check('Large cast pagination changes bounded rows','Crew member 039' in page.locator('.wb-rows').inner_text());capture(page,'large-cast-1440')
  page.locator('[data-wb="previous"]').click()
  page.locator('#wb-search').fill('Kai');page.locator('.wb-rows>a').click();page.locator('.wb-document>h2').wait_for();page.locator('.wb-approved').first.wait_for()
  check('Entity prose distinct from approved target','Creative intent · saved in this project' in page.locator('.wb-document').inner_text())
  capture(page,'character-1440')
  page.locator('[data-field="notes"]').click();page.locator('#wb-text').fill('A measured voice. A final night on the coast.');capture(page,'edit-1440')
  awaitless=page.evaluate("async()=>{const old=PROJECT_OPEN_EPOCH;await switchProject('does-not-exist');return old===PROJECT_OPEN_EPOCH&&CineBraidWorkingBible.blocked();}")
  check('Unsubmitted draft blocks project replacement',awaitless)
  count_before=len(mutations);page.evaluate("async()=>{requestDeleteProject(ACTIVE_PROJECT_SLUG,'synthetic');requestArchiveProject(ACTIVE_PROJECT_SLUG,'synthetic');await restoreProjectBackup('synthetic-backup.json');}");check('Open draft guards delete, archive and backup restore before any request',len(mutations)==count_before)
  save_mode='fail';page.locator('[data-wb="save"]').click();page.locator('#wb-save-status[role="alert"]').wait_for()
  check('Failed save keeps typed text',page.locator('#wb-text').input_value()=='A measured voice. A final night on the coast.')
  capture(page,'save-failure-1440')
  page.set_viewport_size({'width':390,'height':844});page.locator('[data-wb="save"]').scroll_into_view_if_needed();capture(page,'save-failure-390')
  check('Mobile failed-save controls reachable',page.locator('[data-wb="save"]').is_enabled())
  save_mode='ok';page.locator('[data-wb="save"]').click();page.wait_for_function('!CineBraidWorkingBible.blocked()&&projectSaveSettled().settled')
  check('Retry writes through existing save chain',json.loads(pf.read_text(encoding='utf-8'))['characters'][0]['notes']=='A measured voice. A final night on the coast.')
  check('Ordinary save preserves approval ledger',page.evaluate('JSON.stringify(P.productionAuthority)')==baseline)
  page.set_viewport_size({'width':1440,'height':900});page.locator('#wb-open-reference').click();page.locator('[data-reference-desk]').wait_for();page.locator('.wb-return [data-wb="back"]').click();page.locator('.wb-document>h2').wait_for();page.wait_for_timeout(250)
  check('Reference return preserves entity and search',page.url.endswith('#/bible/characters/KAI') and page.locator('#wb-search').input_value()=='Kai')
  check('Reference return restores initiating focus',page.evaluate('document.activeElement.id')=='wb-open-reference')
  page.locator('#wb-target-0').focus();page.keyboard.press('Enter');page.locator('[data-reference-desk]').wait_for();page.locator('.wb-return [data-wb="back"]').click();page.wait_for_timeout(250)
  check('Keyboard exact-target return restores focus',page.evaluate('document.activeElement.id')=='wb-target-0')
  page.locator('[data-field="notes"]').focus();page.keyboard.press('Enter');page.locator('#wb-text').wait_for();check('Keyboard editing moves focus into the editor',page.evaluate('document.activeElement.id')=='wb-text');page.locator('[data-wb="discard"]').click()

  page.locator('#wb-open-media').click();page.locator('.production-contact-sheet').wait_for();check('Media link selects exact entity relationship',page.evaluate("CineBraidMediaBrowser.instances.get('production').state.related")=='characters:KAI')
  capture(page,'related-media-1440')
  page.locator('[data-md-open]').first.click();page.locator('[data-mi-action="open-owner"]').first.click();page.locator('[data-media-return]').wait_for();capture(page,'nested-reference-return-1440')
  page.locator('.wb-return [data-wb="back"]').click();page.wait_for_timeout(250)
  check('Direct Bible return clears nested media return session',page.locator('[data-media-return]').count()==0)
  check('Media return restores initiating focus',page.evaluate('document.activeElement.id')=='wb-open-media')
  shot=page.locator('.wb-shot-links a').first;check('Existing shot relationship shown',shot.count()==1);shot.click();page.wait_for_function("location.hash==='#/shot/SH010'&&document.body.dataset.renderReady==='1'");page.locator('.wb-return [data-wb="back"]').click();page.wait_for_timeout(250)
  check('Shot return preserves exact entity',page.url.endswith('#/bible/characters/KAI'))
  authority_mode='hold';page.locator('[data-wb="reload-authority"]').click();page.locator('.wb-authority[aria-busy="true"]').wait_for();check('Loading authority never claims no approval','No current approved reference' not in page.locator('.wb-authority').inner_text());capture(page,'authority-loading-1440');authority_mode='ok'
  for request in held:request.continue_()
  held.clear();page.locator('.wb-approved').first.wait_for()
  authority_mode='error';page.locator('[data-wb="reload-authority"]').click();page.locator('.wb-authority [role="alert"]').wait_for();capture(page,'authority-read-failure-1440')
  check('Read failure is not an empty approval claim','No current approved reference' not in page.locator('.wb-authority').inner_text())
  authority_mode='ok';page.locator('[data-wb="reload-authority"]').click();page.locator('.wb-approved').first.wait_for()
  # Missing approved original is separate from approval status.
  (w.projects_root/slug/'anchors'/'KAI_DEFAULT_V001.png').unlink();page.locator('[data-wb="reload-authority"]').click();page.locator('.wb-missing').wait_for();capture(page,'missing-approved-1440')
  check('Missing original retains receipt wording','receipt remains recorded' in page.locator('.wb-authority').inner_text())
  page.set_viewport_size({'width':390,'height':844});page.locator('.wb-missing').scroll_into_view_if_needed();capture(page,'missing-approved-390')
  page.set_viewport_size({'width':1440,'height':900});page.locator('[data-wb="braidy"]').click();check('Opening Braidy is advisory only',page.evaluate('JSON.stringify(P.productionAuthority)')==baseline)
  check('No assistant request made on opening',not any('/ask' in r['url'] for r in mutations))
  before_suggestion=page.evaluate('JSON.stringify(P)');page.evaluate("()=>CineBraidBraidy.ask('Suggest one line of creative intent for this character.')");page.wait_for_function("CineBraidBraidy.lastAnswer().includes('Kai speaks')");check('Receiving suggestion changes no project data',page.evaluate('JSON.stringify(P)')==before_suggestion);check('Suggestion stays bound to typed entity',page.evaluate('CineBraidBraidy.handoff().target.id')=='characters:KAI');capture(page,'advisory-suggestion-1440')
  page.goto(base+'/#/settings');page.locator('a[href="#/bible/project"]').wait_for();check('Settings points to single creative editor',page.locator('#cfg-global-visual-style').count()==0)
  viewer=context.new_page();viewer.goto(base+'/bible.html');viewer.locator('.record-target').first.wait_for();capture(viewer,'approved-record-1440')
  check('Viewer omits creative prose and supporting action','measured voice' not in viewer.locator('body').inner_text() and viewer.locator('a[href*="supporting"]').count()==0)
  viewer.set_viewport_size({'width':390,'height':844});capture(viewer,'approved-record-390');check('Viewer mobile width fits',viewer.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  # Location writer, long prose, and project-style mirror use existing storage.
  page.goto(base+'/#/bible/locations/HULL');page.locator('[data-field="creationDescription"]').wait_for();page.locator('[data-field="creationDescription"]').click()
  long_text='A weathered relay bay. '+('Keep the sea light soft and the practical lights warm. '*100)
  page.locator('#wb-text').fill(long_text);page.locator('[data-wb="save"]').click();page.wait_for_function('!CineBraidWorkingBible.blocked()&&projectSaveSettled().settled')
  check('Location visual description saves without truncation',json.loads(pf.read_text(encoding='utf-8'))['locations'][0]['creationDescription']==long_text)
  capture(page,'location-long-text-1440')
  page.goto(base+'/#/bible/project');page.locator('[data-field="globalStylePrompt"]').wait_for();page.locator('[data-field="globalStylePrompt"]').click();page.locator('#wb-text').fill('Restrained coastal light. No decorative glow.');page.locator('[data-wb="save"]').click();page.wait_for_function('!CineBraidWorkingBible.blocked()&&projectSaveSettled().settled')
  saved=json.loads(pf.read_text(encoding='utf-8'));check('Project visual language uses current writer',saved['meta']['globalStylePrompt']=='Restrained coastal light. No decorative glow.')
  check('Project style mirror stays coherent',any(x.get('text')==saved['meta']['globalStylePrompt'] for x in saved['meta'].get('styleBlocks',[])))
  check('Creative edits still preserve authority',page.evaluate('JSON.stringify(P.productionAuthority)')==baseline)
  # Return to an in-memory draft from another workflow preserves text and caret.
  page.locator('[data-field="worldSetting"]').click();page.locator('#wb-text').fill('Unsubmitted coastal setting.');page.locator('#wb-text').evaluate('(el)=>{el.focus();el.setSelectionRange(4,12)}')
  page.locator('a[href="#/shots"]').last.click();page.locator('.wb-return [data-wb="back"]').click();page.locator('#wb-text').wait_for();check('Draft survives owner round trip',page.locator('#wb-text').input_value()=='Unsubmitted coastal setting.')
  page.locator('[data-wb="discard"]').click();check('Discard does not write',json.loads(pf.read_text(encoding='utf-8'))['meta']['world']['setting']!='Unsubmitted coastal setting.')
  # Simulate a removed entity in this disposable browser record: recovery may
  # copy/discard the orphan draft, but must not recreate or write the entity.
  page.goto(base+'/#/bible/characters/KAI');page.locator('[data-field="notes"]').wait_for();page.locator('[data-field="notes"]').click();page.locator('#wb-text').fill('Orphan draft to preserve.')
  count_before=len(mutations);page.evaluate("()=>{window.__orphan=P.characters.find(x=>x.id==='KAI');P.characters=P.characters.filter(x=>x.id!=='KAI');route();}");page.locator('#wb-stale-text').wait_for();check('Removed entity exposes copyable draft',page.locator('#wb-stale-text').input_value()=='Orphan draft to preserve.');capture(page,'removed-entity-recovery-1440')
  page.locator('[data-wb="discard-stale"]').click();check('Orphan draft release performs no save or recreation',len(mutations)==count_before and not page.evaluate('CineBraidWorkingBible.blocked()'))
  page.evaluate('()=>{P.characters.unshift(window.__orphan);delete window.__orphan;}');page.goto(base+'/#/bible/project');page.locator('[data-field="worldSetting"]').wait_for()
  # Actual server revision conflict, never a fake success or silent overwrite.
  page.locator('[data-field="worldSetting"]').click();page.locator('#wb-text').fill('Preserve this unsaved conflict text.')
  changed=json.loads(pf.read_text(encoding='utf-8'));changed['meta']['title']='Signal House · changed in another editor';pf.write_text(json.dumps(changed),encoding='utf-8')
  page.locator('[data-wb="save"]').click();page.locator('#wb-recovery-copy').wait_for();check('Conflict offers copyable preserved draft',page.locator('#wb-recovery-copy').input_value()=='Preserve this unsaved conflict text.')
  check('Conflict never overwrites current storage',json.loads(pf.read_text(encoding='utf-8'))['meta']['world']['setting']!='Preserve this unsaved conflict text.')
  capture(page,'revision-conflict-1440');page.set_viewport_size({'width':390,'height':844});capture(page,'revision-conflict-390')
  page.locator('[data-wb="recover"]').click();check('Conflict can return to preserved edit',page.locator('#wb-text').input_value()=='Preserve this unsaved conflict text.')
  page.on('dialog',lambda d:d.accept());page.reload();page.locator('.wb-document').wait_for();check('Explicit reload clears only in-memory recovery',not page.evaluate('CineBraidWorkingBible.blocked()'))
  # An empty synthetic production has a truthful light on-ramp.
  empty=json.loads(pf.read_text(encoding='utf-8'));empty['meta']['title']='New synthetic production';empty['meta']['world']={'setting':'','include':'','reject':''};empty['meta']['globalStylePrompt']='';empty['meta']['globalNegativePrompt']=''
  for key in ('characters','locations','props','vehicles','audio','shots','scenes'):empty[key]=[]
  empty['productionAuthority']['receipts']=[];pf.write_text(json.dumps(empty),encoding='utf-8');page.reload();page.locator('.wb-onramp').wait_for();capture(page,'empty-project-390');page.set_viewport_size({'width':1440,'height':900});capture(page,'empty-project-1440')
  check('Empty project offers existing next step','Add your first elements' in page.locator('.wb-onramp').inner_text())
  check('Empty project invents no premise or theme fields',page.locator('[data-field="premise"],[data-field="themes"]').count()==0)
  check('No uncaught application errors',not errors);check('No external or unauthorized action',not blocked)
  browser.close()
finally:
 server.terminate()
 try:server.wait(timeout=8)
 except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
 log.close();w.cleanup()
 (OUT/'browser-results.json').write_text(json.dumps({'checks':checks,'errors':errors,'blocked':blocked,'mutations':mutations},indent=2),encoding='utf-8')
print(json.dumps({'passed':len(checks),'captures':str(OUT)}))
