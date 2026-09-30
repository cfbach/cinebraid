"""B1 prompt/request truth through the shipped desktop UI and real save route.

Disposable project, no external network, paid dispatch intercepted. Verifies selected
missing inputs cannot vanish through composer filtering; deliberate exclusion and
rebuild persist; a Frame A edit stays out of the shot synopsis; an adjacent manual
import cannot claim the unsent native request or become approved on its own.
"""
import json, os, pathlib, socket, subprocess, sys, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from browser_runtime import require_browser,launch_chromium,disposable_workspace
sync_playwright=require_browser('B1 integrated desktop journey')
OUT=pathlib.Path(os.environ['CINEBRAID_JOURNEY_OUT']) if os.environ.get('CINEBRAID_JOURNEY_OUT') else None
if OUT: OUT.mkdir(parents=True,exist_ok=True)
w=disposable_workspace('b1-prompt-ui',sample=False,active_project='b1-prompt')
server=None;log=None
try:
 d=w.projects_root/'b1-prompt';d.mkdir()
 p={'meta':{'title':'B1 prompt truth disposable','schemaVersion':'6.7','aspectRatio':'16:9','workflowEmphasis':'manual','aiPolicy':'disabled','promptDefaults':{'imageProfile':'gpt-image-2/t2i'}},'scenes':[{'id':'SC-1','title':'Stage'}],'shots':[{'id':'B1-01','scene':'SC-1','title':'A particular frame','desc':'WHOLE SHOT: a ship sinks beyond the chair.','characters':[],'keyframes':[{'id':'frame-a','label':'A','title':'Opening frame','description':'A red lantern rests beside a window.','required':True,'generationPackages':[]}],'clips':[],'candidateFiles':[],'creationBrief':{'propIds':['PROP-CHAIR'],'disabledInputKeys':[],'frameWorkflows':{}}}],'characters':[],'locations':[],'props':[{'id':'PROP-CHAIR','name':'Approved chair needed','approvedFile':'','continuityStates':[]}],'vehicles':[],'audio':[],'mediaAssets':[],'jobs':[],'decisions':[],'agentRuns':[],'promptBuildsById':{},'promptSnapshotsById':{}}
 p['shots'][0]['creationBrief']['camera']='Tight close-up of the lantern, no wider ship view.'
 p['shots'][0]['creationBrief']['composition']={
  'camera':{'shotSize':'wide','height':'eye-level','angle':'level','lens':'normal','view':'front','layout':'rule-of-thirds','crop':'full-scene','reframe':'preserve-loosely'},
  'elements':[{'id':'lantern-placement','referenceKey':'','label':'red lantern','x':.25,'y':.65,'w':.3,'h':.4,'depth':'foreground','facing':'camera','view':'reference-view','crop':'none','notes':'beside the window'}],
  'mustInclude':'the single red lantern remains beside the window',
  'mustAvoid':'duplicate lanterns or a wide ship vista',
  'baseFrame':{'source':'auto','zoom':1.3,'panX':12,'panY':-7,'rotation':5},
 }
 (d/'project.json').write_text(json.dumps(p),encoding='utf8')
 c=json.loads(w.config_path.read_text());c['generation']={'fal':{'enabled':True,'apiKey':'synthetic-never-sent'}};w.config_path.write_text(json.dumps(c))
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 log=(w.home/'b1-server.log').open('w');server=subprocess.Popen(['node','-r','./tests/helpers/ev2-6-no-network.js','server.js'],cwd=ROOT,env=w.env(port),stdout=log,stderr=log)
 errors=[];paid=[];compiles=[];page=None
 for _ in range(150):
  try:
   with socket.create_connection(('127.0.0.1',port),.2):break
  except OSError:time.sleep(.1)
 else:raise RuntimeError('server failed')
 with sync_playwright() as pw:
  browser=launch_chromium(pw,label='B1 integrated desktop journey')
  page=browser.new_page(viewport={'width':1440,'height':1000},reduced_motion='reduce',service_workers='block')
  page.set_default_timeout(12000)
  page.on('pageerror',lambda e:errors.append(str(e)))
  def route(r):
   if r.request.url.startswith(base):
    if '/api/prompt/compile' in r.request.url: compiles.append(r.request.post_data_json)
    if '/api/generation/fal/jobs' in r.request.url and r.request.method=='POST':paid.append(r.request.post_data_json);return r.fulfill(status=503,json={'error':'Paid dispatch intercepted'})
    return r.continue_()
   return r.abort()
  page.route('**/*',route)
  page.goto(base)
  page.get_by_role('button',name='▦ Shots',exact=True).click()
  page.locator('a[href="#/shot/B1-01"]').first.click()
  page.locator('[data-stage-id="frames"]').click()
  frame=page.locator('[data-frame-id="frame-a"]')
  frame.locator('textarea.guided-primary-brief').fill('A close image of a red lantern beside a window.')
  frame.locator('textarea.guided-primary-brief').press('Tab')
  page.wait_for_function('projectSaveSettled().settled')
  assert json.loads((d/'project.json').read_text())['shots'][0]['desc']==p['shots'][0]['desc'],'Frame edit overwrote whole-shot synopsis'
  page.get_by_role('button',name='Prepare Frame A generation',exact=True).click()
  frame.locator('.frame-prompt-tools').evaluate('(e)=>e.open=true')
  frame.locator('.guided-frame-compile button').filter(has_text='Build prompt').click()
  page.get_by_text('Selected frame inputs need a decision').wait_for()
  assert not json.loads((d/'project.json').read_text())['promptBuildsById'],'Missing input built a prompt'
  page.get_by_role('button',name='Exclude these inputs').click()
  page.wait_for_function('projectSaveSettled().settled')
  assert json.loads((d/'project.json').read_text())['shots'][0]['creationBrief']['disabledInputKeys'],'Exclusion did not persist'
  frame=page.locator('[data-frame-id="frame-a"]')
  frame.locator('.frame-prompt-tools').evaluate('(e)=>e.open=true')
  frame.locator('.guided-frame-compile button').filter(has_text='Build prompt').click()
  frame.get_by_text('PREPARED PROMPT').wait_for(timeout=25000)
  page.wait_for_function('projectSaveSettled().settled')
  saved=json.loads((d/'project.json').read_text());assert saved['promptBuildsById'],'No build after deliberate exclusion'
  built=next(iter(saved['promptBuildsById'].values()))
  assert 'WHOLE SHOT:' not in built['prompt'], 'Frame prompt inherited the shot synopsis'
  assert 'Frame setup: wide' not in built['prompt'], 'Untouched shot camera overrode frame direction'
  assert 'Base-frame adjustment' not in built['prompt'], 'Shot base-frame camera transform overrode frame direction'
  assert 'Tight close-up of the lantern' in built['prompt'], 'Frame camera did not reach compiled prompt'
  assert 'single red lantern remains beside the window' in built['prompt'], 'Authored mustInclude was dropped'
  assert 'duplicate lanterns or a wide ship vista' in built['prompt'], 'Authored mustAvoid was dropped'
  assert 'red lantern' in built['prompt'] and 'foreground' in built['prompt'], 'Authored element placement was dropped'
  assert 'Frame setup: wide' not in built['prompt'] and 'Wide shot' not in built['prompt'], 'Shot camera contradicted frame override'
  assert compiles[-1]['composition']['camera']=={}, 'Frame request retained conflicting shot camera fields'
  snapshot=saved['promptSnapshotsById'][built['compositionSnapshotId']]['value']
  assert snapshot['camera']=={} and snapshot['mustInclude']==p['shots'][0]['creationBrief']['composition']['mustInclude'], 'Stored build lost the frame-specific non-camera composition snapshot'
  assert snapshot['baseFrame']['zoom']==1 and snapshot['baseFrame']['panX']==0 and snapshot['baseFrame']['rotation']==0, 'Frame snapshot retained conflicting base camera transforms'
  assert saved['shots'][0]['creationBrief']['composition']['camera']['shotSize']=='wide', 'Frame override mutated the stored shot plan'
  assert saved['shots'][0]['creationBrief']['composition']['baseFrame']['zoom']==1.3, 'Frame override mutated authored base-frame geometry'
  if OUT: page.screenshot(path=str(OUT/'b1-desktop-after-rebuild.png'),full_page=True)
  assert not saved.get('productionAuthority',{}).get('receipts',[]),'Prompt build approved artwork'
  frame.locator('.fal-generate-btn').click()
  page.wait_for_function('window._falFrameRequest?.planFingerprint')
  assert page.evaluate('window._falFrameRequest.dispatch.bindings.length')==0,'Excluded input entered paid preview'
  assert not paid,'Opening request review submitted a paid job'
  # Hold plan responses in the page and release them in a controlled order: no sleeps or provider calls.
  page.evaluate("""() => {
    window.__b1PlanTemplate = { ...window._falFrameRequest };
    window.__b1OriginalFetch = window.fetch;
    window.__b1HeldPlans = [];
    window.fetch = (input, options) => {
      const plan = String(input).includes('/api/generation/fal/image/plan');
      const body = plan ? JSON.parse(options.body) : null;
      return plan && !Object.hasOwn(body, 'prompt')
        ? new Promise(resolve => window.__b1HeldPlans.push({ body, resolve }))
        : window.__b1OriginalFetch(input, options);
    };
  }""")
  page.evaluate("""() => { document.getElementById('fal-frame-count').value='3'; refreshFalFramePlan(); }""")
  page.wait_for_function('window.__b1HeldPlans.length===1')
  assert page.locator('#fal-frame-submit').is_disabled(), 'Paid submit remained available while preview was stale'
  page.locator('#fal-frame-prompt-editor').fill('New authored wording during the count preview')
  page.evaluate("""() => {
    const held=window.__b1HeldPlans.shift();
    held.resolve({ok:true,json:async()=>({...window.__b1PlanTemplate,compiledPrompt:'Compiled for three options',
      outputCount:held.body.outputCount,planFingerprint:'b1-count-three'})});
  }""")
  page.wait_for_function("window._falFrameRequest?.planFingerprint==='b1-count-three'")
  assert page.locator('#fal-frame-prompt-editor').input_value()=='New authored wording during the count preview', 'Late preview overwrote newer authored text'
  assert page.evaluate('window._falFrameRequest.prompt')=='New authored wording during the count preview', 'Submitted text diverged from editor'
  assert page.evaluate('window._falFrameRequest.outputCount')==3, 'Preview settings did not follow chosen count'
  page.locator('#fal-frame-edit-coverage:not([hidden])').wait_for()
  page.evaluate("""() => { document.getElementById('fal-frame-quality').value='low'; refreshFalFramePlan(); }""")
  page.wait_for_function('window.__b1HeldPlans.length===1')
  assert page.locator('#fal-frame-edit-coverage').is_hidden() and not page.locator('#fal-frame-edit-coverage').inner_html(), 'Old coverage remained visible for pending settings'
  page.get_by_role('button',name='Reset compiled prompt').click()
  assert page.locator('#fal-frame-prompt-editor').input_value()=='Compiled for three options', 'Reset did not clear authored text while pending'
  page.evaluate("""() => {
    const held=window.__b1HeldPlans.shift();
    held.resolve({ok:true,json:async()=>({...window.__b1PlanTemplate,compiledPrompt:'Compiled for low quality',
      outputCount:held.body.outputCount,quality:held.body.quality,planFingerprint:'b1-quality-low'})});
  }""")
  page.wait_for_function("window._falFrameRequest?.planFingerprint==='b1-quality-low'")
  assert page.locator('#fal-frame-prompt-editor').input_value()=='Compiled for low quality', 'Late preview undid Reset to the current compiled request'
  assert page.evaluate('window._falFrameRequest.prompt')=='Compiled for low quality' and page.evaluate('window._falFrameRequest.quality')=='low', 'Reset left prompt or settings stale'
  page.evaluate("""() => { document.getElementById('fal-frame-count').value='2'; window.__b1OlderRefresh=refreshFalFramePlan(); }""")
  page.wait_for_function('window.__b1HeldPlans.length===1')
  page.evaluate("""() => { document.getElementById('fal-frame-count').value='4'; window.__b1NewerRefresh=refreshFalFramePlan(); }""")
  page.wait_for_function('window.__b1HeldPlans.length===2')
  page.evaluate("""() => {
    const held=window.__b1HeldPlans.pop();
    held.resolve({ok:true,json:async()=>({...window.__b1PlanTemplate,compiledPrompt:'Compiled for four options',
      outputCount:held.body.outputCount,planFingerprint:'b1-count-four'})});
  }""")
  page.wait_for_function("window._falFrameRequest?.planFingerprint==='b1-count-four'")
  page.evaluate("""() => {
    const held=window.__b1HeldPlans.pop();
    held.resolve({ok:true,json:async()=>({...window.__b1PlanTemplate,compiledPrompt:'STALE two-option wording',
      outputCount:held.body.outputCount,planFingerprint:'stale-b1-count-two'})});
  }""")
  page.evaluate('() => Promise.all([window.__b1OlderRefresh,window.__b1NewerRefresh])')
  assert page.evaluate('window._falFrameRequest.planFingerprint')=='b1-count-four' and page.evaluate('window._falFrameRequest.outputCount')==4, 'Older response replaced the newest request settings or fingerprint'
  assert page.locator('#fal-frame-prompt-editor').input_value()=='Compiled for four options', 'Older response replaced the newest compiled prompt'
  page.evaluate('window.fetch=window.__b1OriginalFetch')
  assert not paid, 'Preview refresh unexpectedly dispatched a paid job'
  page.evaluate('closeModal()')
  with page.expect_file_chooser() as choice:page.get_by_role('button',name='Import Frame A',exact=True).click()
  choice.value.set_files(str(ROOT/'projects/cinebraid-sample/shots/SAMPLE-03/takes/SAMPLE-03-OPEN.png'))
  page.wait_for_function('P.shots[0].candidateFiles?.length===1')
  page.wait_for_function('projectSaveSettled().settled')
  page.reload();page.wait_for_function('projectSaveSettled().settled')
  saved=json.loads((d/'project.json').read_text());rows=saved['shots'][0]['candidateFiles'];assert len(rows)==1,rows
  row=rows[0];assert row.get('importedSource')=='local-file' and not row.get('sourceBuildId') and not row.get('sourcePackageId'),row
  assert row.get('decision')=='unreviewed',row
  assert not saved.get('productionAuthority',{}).get('receipts',[]),'External import approved itself'
  page.set_viewport_size({'width':390,'height':844})
  frame=page.locator('[data-frame-id="frame-a"]')
  frame.locator('.frame-prompt-tools').evaluate('(e)=>e.open=true')
  assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2'),'390 px overflow'
  if OUT: page.screenshot(path=str(OUT/'b1-mobile-after-import.png'),full_page=True)
  assert not paid,paid
  assert not errors,errors
  print('B1 desktop browser: frame edit preserved synopsis; missing selected reference blocked build; exclusion persisted; rebuild succeeded; adjacent import remained external, unapproved; reload preserved data; 0 paid calls.')
  browser.close()
finally:
 try:
  if server is not None: server.terminate();server.wait(timeout=10)
 finally:
  if log is not None: log.close()
  w.cleanup()
