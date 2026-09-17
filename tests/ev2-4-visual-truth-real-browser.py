#!/usr/bin/env python3
"""EV2-4 bounded visual-truth correction proof. Disposable synthetic fixtures only."""
import ast,json,os,pathlib,socket,struct,subprocess,sys,tempfile,time,urllib.request,zlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from browser_runtime import disposable_workspace,require_browser,launch_chromium,canon_receipts
source=(ROOT/'tests/ev2-3-media-real-browser.py').read_text(encoding='utf-8-sig')
functions=[n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name in ('free_port','png','iso','build_fixture')]
exec(compile(ast.Module(body=functions,type_ignores=[]),'<synthetic builders>','exec'))
OUT=pathlib.Path(os.environ.get('EV2_ACCEPTANCE_DIR') or tempfile.mkdtemp(prefix='cinebraid-bible-qa-'));OUT.mkdir(parents=True,exist_ok=True)
w=disposable_workspace('ev2-4-visual-truth',sample=False,active_project='o5-media-qa');slug=build_fixture(w.projects_root)
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

checks=[];errors=[];blocked=[];mutations=[];asks=[];held=[]
save_mode='ok';ask_mode='ok';available=False

def check(name,value):
 checks.append({'check':name,'passed':bool(value)})
 if not value:
  print(page.evaluate("()=>({badge:document.querySelector('.wb-intent')?.textContent,global:document.querySelector('#save-state')?.textContent,save:projectSaveSettled(),draft:CineBraidWorkingBible.blocked()})"))
  capture(page,'failure-diagnostic')
 assert value,name

def capture(page,name):page.screenshot(path=str(OUT/(name+'.png')),full_page=False)

def capability(page,ready):
 global available
 available=ready
 page.evaluate("ready=>{AGENT_STATUS.capabilities={...AGENT_STATUS.capabilities,text:{ready,provider:ready?'synthetic':'none',model:ready?'Synthetic advisory fixture':'',message:ready?'':'No assistant is configured.',action:'Choose an assistant in Settings.'}};CineBraidCreatorSurfaces.paint();}",ready)

try:
 for _ in range(160):
  try:urllib.request.urlopen(base+'/api/project',timeout=1);break
  except Exception:time.sleep(.15)
 with require_browser('EV2-4 visual truth correction')() as pw:
  browser=launch_chromium(pw,headless=True);context=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
  def guard(r):
   url=r.request.url
   if url.startswith(('data:','blob:')):return r.continue_()
   if not url.startswith(base+'/'):
    if 'fonts.google' in url:return r.fulfill(status=200,body='')
    blocked.append(url);return r.abort()
   if url==base+'/api/agents/status':
    response=r.fetch();data=response.json();data.setdefault('capabilities',{})['text']={'ready':available,'provider':'synthetic' if available else 'none','model':'Synthetic advisory fixture' if available else '', 'message':'' if available else 'No assistant is configured.'}
    return r.fulfill(response=response,json=data)
   if url==base+'/api/project/ask':
    asks.append(r.request.post_data)
    if ask_mode=='hold':held.append(r);return
    return r.fulfill(status=200,json={'answer':'Suggested creative intent: Kai speaks only when the machinery falls silent. Review this wording before saving it.'})
   if r.request.method not in ('GET','HEAD'):
    mutations.append({'url':url.replace(base,''),'method':r.request.method})
    if url.split('?')[0] not in (base+'/api/project',base+'/api/projects/'+slug+'/project',base+'/api/local-file/resolve',base+'/api/shots/SH010/folder'):
     blocked.append(url);return r.abort()
    if r.request.method=='PUT' and save_mode=='fail':return r.fulfill(status=503,json={'error':'Synthetic save failure'})
   r.continue_()
  context.route('**/*',guard)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base+'/#/bible/project');page.locator('.wb-document h2').wait_for();page.wait_for_timeout(400);page.wait_for_function('projectSaveSettled().settled && !saveTimer')
  baseline=page.evaluate('JSON.stringify(P.productionAuthority)')
  check('Settled overview has saved creative-intent badge',page.locator('.wb-intent').inner_text()=='Creative intent · saved in this project')
  check('Settled global status is Saved',page.locator('#save-state').inner_text().strip()=='Saved')
  check('Folio header separates the Working Bible from the Approved record',page.locator('.wb-heading h1').inner_text()=='Working Bible' and 'not the Approved record' in page.locator('.wb-heading-note').inner_text() and page.locator('.wb-folio').count()==1)
  for width,height in ((1280,720),(1440,900),(1920,1080),(390,844)):
   page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(100);capture(page,f'overview-saved-{width}')
   check(f'Overview fits viewport {width}',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  page.locator('[data-wb="read"]').click();capture(page,'overview-foundation-390')
  page.set_viewport_size({'width':1440,'height':900});page.locator('.wb-heading').scroll_into_view_if_needed()
  count_before=len(mutations);page.locator('[data-field="worldSetting"]').click();page.locator('#wb-text').fill('An isolated relay station during its final night. A synthetic draft.')
  check('Opening a draft immediately changes global saved presentation',page.locator('#save-state').inner_text().strip()=='Unsaved Bible edit')
  check('Open draft has unsaved foundation badge',page.locator('.wb-intent').inner_text()=='Creative intent · changes not yet saved')
  check('Typing a draft sends no writes',len(mutations)==count_before)
  page.evaluate("()=>setSaveState('saved','Saved')")
  check('Background saved callback cannot conceal draft',page.locator('#save-state').inner_text().strip()=='Unsaved Bible edit')
  capture(page,'overview-unsaved-1440')
  page.locator('a[href="#/shots"]').last.click();page.locator('[data-media-return]').wait_for()
  check('Unsaved presentation follows draft outside Bible',page.locator('#save-state').inner_text().strip()=='Unsaved Bible edit')
  page.locator('[data-media-return]').click();page.locator('#wb-text').wait_for();page.locator('[data-wb="discard"]').click()
  check('Discard restores saved status and saved badge',page.locator('#save-state').inner_text().strip()=='Saved' and page.locator('.wb-intent').inner_text()=='Creative intent · saved in this project')
  page.locator('[data-field="worldSetting"]').click();page.locator('#wb-text').fill('An isolated coastal relay station during its final night of operation.')
  save_mode='fail';page.locator('[data-wb="save"]').click();page.locator('#wb-save-status[role="alert"]').wait_for()
  check('Failure status is not masked by draft presentation',page.locator('#save-state').get_attribute('data-state')=='error' and 'not yet saved' in page.locator('.wb-intent').inner_text())
  check('Failed text remains recoverable',page.locator('#wb-text').input_value().endswith('night of operation.'))
  capture(page,'overview-save-failure-1440')
  save_mode='ok';page.locator('[data-wb="save"]').click();page.wait_for_function('!CineBraidWorkingBible.blocked()&&projectSaveSettled().settled')
  check('Acknowledged retry updates both displays without reload',page.locator('#save-state').inner_text().strip()=='Saved' and page.locator('.wb-intent').inner_text()=='Creative intent · saved in this project')
  check('Retry uses existing project writer',json.loads(pf.read_text(encoding='utf-8'))['meta']['world']['setting'].endswith('night of operation.'))
  check('Creative save leaves receipt ledger unchanged',page.evaluate('JSON.stringify(P.productionAuthority)')==baseline)
  page.locator('#toast').wait_for(state='hidden')
  page.locator('#wb-search').fill('Kai');page.locator('.wb-rows>a').click();page.locator('.wb-document>h2').wait_for();page.locator('[data-wb="braidy"]').click()
  capability(page,False);page.locator('[data-braidy-role="unavailable"]').wait_for()
  check('Unavailable assistant has disabled Ask',not page.locator('.cb-braidy-send').is_enabled())
  count_before=len(asks);answer=page.evaluate("()=>CineBraidBraidy.ask('Must not request an unavailable assistant')")
  check('Unavailable direct request is refused before fetch',answer is None and len(asks)==count_before)
  page.locator('#cb-braidy-input').fill('Keep my question until an assistant is available.');page.locator('#cb-braidy-input').press('Enter')
  check('Unavailable keyboard submit preserves the question',len(asks)==count_before and page.locator('#cb-braidy-input').input_value().startswith('Keep my question'))
  check('Unavailable rail has no generated suggestion',page.locator('[data-braidy-role="braidy"]').count()==0)
  capture(page,'braidy-unavailable-1440')
  capability(page,True);before_suggestion=page.evaluate('JSON.stringify(P)');writes_before=len(mutations)
  page.locator('#cb-braidy-input').fill('Suggest one line of creative intent for this character.');page.locator('.cb-braidy-send').click();page.locator('[data-braidy-role="braidy"]').wait_for()
  check('Available assistant returns one deliberate synthetic advisory',len(asks)==count_before+1 and 'Kai speaks' in page.locator('[data-braidy-role="braidy"]').inner_text())
  check('Advisory does not coexist with unavailable claim','no assistant to think with' not in page.locator('.cb-braidy').inner_text() and page.locator('[data-braidy-role="unavailable"]').count()==0)
  check('Suggestion changes no project data or receipts',page.evaluate('JSON.stringify(P)')==before_suggestion and len(mutations)==writes_before)
  check('Suggestion remains bound to the Bible character',page.evaluate('CineBraidBraidy.handoff().target.id')=='characters:KAI')
  capture(page,'braidy-advisory-1440')
  page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(150);capture(page,'braidy-advisory-390');check('Braidy fits mobile viewport',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));page.set_viewport_size({'width':1440,'height':900})
  capability(page,False)
  check('Losing availability hides past responses beside unavailable label',page.locator('[data-braidy-role="braidy"]').count()==0 and page.locator('[data-braidy-role="unavailable"]').count()==1)
  capability(page,True);page.evaluate('CineBraidBraidy.reset()');ask_mode='hold'
  page.evaluate("()=>{window.__pendingSuggestion=CineBraidBraidy.ask('Delayed synthetic suggestion');}");page.wait_for_function("document.querySelector('[data-braidy-role=pending]')!==null")
  capability(page,False)
  check('Unavailable assistant does not retain a thinking pose',not page.evaluate('CineBraidBraidy.presentationTokens().pending'))
  for r in held:r.fulfill(status=200,json={'answer':'This late suggestion must not appear.'})
  held.clear();page.evaluate('()=>window.__pendingSuggestion')
  check('Availability lost in flight discards late advisory',page.evaluate('CineBraidBraidy.lastAnswer()')=='' and page.locator('[data-braidy-role="braidy"]').count()==0)
  viewer=context.new_page();viewer.on('pageerror',lambda e:errors.append(str(e)));viewer.goto(base+'/bible.html');viewer.locator('.record-target').first.wait_for()
  headings=viewer.locator('.record-section h2').all_text_contents()
  check('Approved-record headings contain readable names only','Kai' in headings and 'Hull bay' in headings and 'Kai KAI' not in headings and 'Hull bay HULL' not in headings)
  check('Approved-record identifiers remain separately labelled','ID · KAI' in viewer.locator('.record-id').all_text_contents() and 'ID · HULL' in viewer.locator('.record-id').all_text_contents())
  check('Viewer still omits editor prose and supporting action','Kai measures' not in viewer.locator('body').inner_text() and viewer.locator('a[href*="supporting"]').count()==0)
  check('Viewer offers no working draft and labels each record kind',viewer.locator('a[href*="working-draft"]').count()==0 and 'Character' in viewer.locator('.record-kind').all_text_contents())
  check('Approval source is folded beneath each approved plate',viewer.locator('.record-target .record-source').count()==viewer.locator('.record-target').count() and viewer.locator('.record-source[open]').count()==0)
  viewer.locator('#record-search').fill('KAI');check('Separate ID remains searchable',viewer.locator('.record-section:visible h2').all_text_contents()==['Kai']);viewer.locator('#record-search').fill('')
  capture(viewer,'approved-record-1440');viewer.locator('#record-search').fill('HULL');capture(viewer,'approved-record-location-1440');viewer.locator('#record-search').fill('');viewer.set_viewport_size({'width':390,'height':844});capture(viewer,'approved-record-390');check('Approved record fits mobile viewport',viewer.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  check('No uncaught application errors',not errors);check('No external or unauthorized action',not blocked)
  browser.close()
finally:
 server.terminate()
 try:server.wait(timeout=8)
 except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
 log.close();w.cleanup()
 (OUT/'browser-results.json').write_text(json.dumps({'checks':checks,'errors':errors,'blocked':blocked,'mutations':mutations,'syntheticAssistantRequests':len(asks)},indent=2),encoding='utf-8')
print(json.dumps({'passed':len(checks),'captures':str(OUT)}))
