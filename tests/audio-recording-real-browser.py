#!/usr/bin/env python3
"""Manual audio intake/review against a real isolated server and physical files."""
import hashlib, json, os, pathlib, shutil, socket, struct, subprocess, tempfile, time, urllib.request, wave
from browser_runtime import require_browser, launch_chromium, disposable_workspace
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path(os.environ.get('CINEBRAID_AUDIO_SCREENSHOTS') or tempfile.mkdtemp(prefix='cinebraid-audio-captures-'))
OUT.mkdir(parents=True, exist_ok=True)
SLUG = 'audio-journey'
workspace = disposable_workspace('audio-recording', sample=False, active_project=SLUG)
project_dir = workspace.projects_root / SLUG
shutil.copytree(ROOT/'projects/cinebraid-sample', project_dir)
project_file = project_dir/'project.json'
p = json.loads(project_file.read_text(encoding='utf-8'))
p['audio'] = [{'id': id, 'name': name, 'prefix': id, 'candidateFiles': [], 'continuityStates': [{'id':'state-default','name':'Default','isDefault':True}]} for id,name in [('AUDIO-A','Doorstep ambience'),('AUDIO-B','Other recording')]]
project_file.write_text(json.dumps(p),encoding='utf-8')
uploads = workspace.home/'uploads'; uploads.mkdir()
def wav(file, samples=16000):
    with wave.open(str(file),'wb') as stream:
        stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(16000)
        stream.writeframes(b''.join(struct.pack('<h',500 if i%100<50 else -500) for i in range(samples)))
wav(uploads/'ambience.wav');wav(uploads/'alternative.wav',24000)
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
base=f'http://127.0.0.1:{port}'
log=open(OUT/'server.log','w',encoding='utf-8')
server=subprocess.Popen(['node','server.js'],cwd=ROOT,env=workspace.env(port),stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
checks=[];errors=[];blocked=[]
def check(name, value):
    checks.append({'check':name,'passed':bool(value)})
    if not value:raise AssertionError(name)
def disk():return json.loads(project_file.read_text(encoding='utf-8'))
def audio():return disk()['audio'][0]
def receipts():return [r for r in disk().get('productionAuthority',{}).get('receipts',[]) if r.get('list')=='audio']
try:
    for _ in range(80):
        try:urllib.request.urlopen(base+'/api/project',timeout=1);break
        except Exception:time.sleep(.2)
    with require_browser('Audio recording journey')() as pw:
        browser=launch_chromium(pw,label='Audio recording journey')
        context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
        page=context.new_page();page.set_default_timeout(12000)
        page.on('pageerror',lambda e:errors.append(str(e)))
        def guard(route):
            if route.request.method=='POST' and any(s in route.request.url for s in ['/api/generation/','/api/agents/','/api/automation/']):
                blocked.append(route.request.url);route.abort()
            else:route.continue_()
        context.route('**/api/**',guard)
        def capture(name):
            page.locator('#toast').wait_for(state='hidden')
            page.evaluate('window.scrollTo(0,0)')
            for width,height,mode in [(1440,1000,'desktop'),(390,844,'mobile')]:
                page.set_viewport_size({'width':width,'height':height})
                page.screenshot(path=str(OUT/(name+'-'+mode+'.png')),full_page=True)
                check(name+' '+mode+' no horizontal page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            page.set_viewport_size({'width':1440,'height':1000})
        def open_audio():
            page.goto(base+'/#/sound/AUDIO-A',wait_until='networkidle')
            page.wait_for_selector('#entity-file',state='attached')
        def upload(file):
            expected = len(audio()['candidateFiles']) + 1
            page.locator('#entity-file').set_input_files(str(file))
            page.locator('#in-submit').click()
            page.wait_for_function('n=>document.querySelectorAll(".audio-candidate").length===n && projectSaveSettled().settled',arg=expected)
        open_audio()
        check('native file picker accepts recordings', 'audio/*' in page.locator('#entity-file').get_attribute('accept'))
        # Cancel is a non-write, including the bytes.
        page.locator('#entity-file').set_input_files(str(uploads/'ambience.wav'))
        check('audio upload has no image/sheet choice',page.locator('#in-structure').count()==0)
        capture('01-audio-intake')
        page.get_by_role('button',name='Cancel',exact=True).click()
        check('cancel leaves no candidate or approval',not audio()['candidateFiles'] and not receipts())
        # A replayed bad file list is refused before any upload.
        page.locator('#entity-file').set_input_files(str(ROOT/'tests/fixtures/ev2-6/frame-0.png'))
        page.locator('#in-submit').click()
        check('image upload to audio visibly refuses',page.get_by_text('Choose audio recordings',exact=False).count()>0)
        check('bad file uploads no media',not audio()['candidateFiles'] and not list((project_dir/'audio').glob('*')))
        page.get_by_role('button',name='Cancel',exact=True).click()
        upload(uploads/'ambience.wav')
        check('saved row declares audio without image metadata',audio()['candidateFiles'][0].get('mediaKind')=='audio' and 'coverageJobType' not in audio()['candidateFiles'][0])
        check('import never approves',not receipts())
        page.locator('.audio-candidate audio').evaluate('async e=>{await e.play()}');page.wait_for_timeout(350)
        check('real recording plays',page.locator('.audio-candidate audio').evaluate('e=>e.readyState>=2 && e.currentTime>0 && e.duration===1'))
        page.locator('.audio-candidate audio').evaluate('e=>e.pause()')
        name=audio()['candidateFiles'][0]['stored']
        page.evaluate('name=>approveEntityFile("audio","AUDIO-B",name)',name)
        check('wrong audio target cannot open approval',page.locator('#entity-approve-confirm').count()==0 and not receipts())
        page.get_by_role('button',name='Review recording…',exact=True).click()
        page.wait_for_function('()=>!document.getElementById("entity-approve-confirm").disabled')
        check('approval shows an audio player, no broken image',page.locator('#entity-approval-preview audio').count()==1 and page.locator('#entity-approval-preview img').count()==0)
        capture('02-audio-approval')
        # Change only the physical test file after identity was prepared.
        target=project_dir/'audio'/name
        original=target.read_bytes();stat=target.stat()
        changed=bytearray(original);changed[100]^=1;target.write_bytes(changed)
        os.utime(target,ns=(stat.st_atime_ns,stat.st_mtime_ns))
        page.locator('#entity-approve-confirm').click();page.wait_for_timeout(800)
        check('same-size replacement with preserved mtime does not gain approval',not receipts())
        capture('03-replaced-recording-refusal')
        # New, separate upload after a refused stale decision.
        page.get_by_role('button',name='LEAVE UNAPPROVED',exact=True).click()
        page.wait_for_selector('#entity-file',state='attached')
        page.wait_for_function('()=>!approvalSubmissionPending()')
        upload(uploads/'alternative.wav')
        page.get_by_role('button',name='Review recording…',exact=True).last.click()
        page.wait_for_function('()=>!document.getElementById("entity-approve-confirm").disabled')
        page.locator('#entity-approve-confirm').click();page.wait_for_function('()=>!approvalSubmissionPending()')
        page.wait_for_selector('[data-audio-standing="approved"]')
        check('human approval persists exact audio identity',len(receipts())==1 and bool(receipts()[0].get('assetId')) and receipts()[0]['value']==audio()['candidateFiles'][-1]['stored'])
        ledger=json.loads((project_dir/'media-assets.json').read_text(encoding='utf-8'))
        asset=next(a for a in ledger['assets'] if a['assetId']==receipts()[0]['assetId'])
        check('receipt points to the selected physical recording and SHA-256',asset['storage']['path']=='audio/'+receipts()[0]['value'] and asset['contentHash']=='sha256:'+hashlib.sha256((uploads/'alternative.wav').read_bytes()).hexdigest())
        page.reload(wait_until='networkidle')
        check('reload retains one approved recording and the other candidate',page.locator('[data-audio-standing="approved"]').count()==1 and page.locator('[data-audio-standing="candidate"]').count()==1)
        capture('04-audio-approved')
        # A decision already saved is evidence about the original bytes only.
        original_receipts=receipts()
        approved_name=original_receipts[0]['value']
        approved_url=page.locator('[data-audio-standing="approved"] audio').get_attribute('src')
        approved_response=context.request.get(base+approved_url,headers={'Range':'bytes=0-99'})
        check('approved identity URL serves exact requested range',approved_response.status==206 and approved_response.body()==(uploads/'alternative.wav').read_bytes()[:100])
        check('approved URL refuses wrong project',context.request.get(base+approved_url.replace('project='+SLUG,'project=wrong-project')).status==404)
        approved_path=project_dir/'audio'/approved_name
        original_stat=approved_path.stat();replacement=bytearray(approved_path.read_bytes());replacement[100]^=1
        approved_path.write_bytes(replacement)
        os.utime(approved_path,ns=(original_stat.st_atime_ns,original_stat.st_mtime_ns))
        # Use the app's normal scan/load; no direct verification/repair endpoint.
        page.locator('#rescan').click()
        page.get_by_text('Local folders synced',exact=True).wait_for()
        page.reload(wait_until='networkidle')
        capture('05-approved-recording-replaced')
        observation={'cards':page.locator('.audio-candidates').inner_text(),'approvedCards':page.locator('[data-audio-standing="approved"]').count(),'players':page.locator('.audio-candidates audio').count(),'receiptsUnchanged':receipts()==original_receipts}
        response=context.request.get(base+approved_url)
        observation['oldPlayerUrlStatus']=response.status
        observation['oldPlayerServedReplacement']=response.ok and hashlib.sha256(response.body()).digest()==hashlib.sha256(replacement).digest()
        page.goto(base+'/#/bible',wait_until='networkidle')
        page.locator('#wb-export-menu summary').click()
        with page.expect_download() as download:page.locator('#wb-export-approved').click()
        download.value.save_as(str(OUT/'post-replacement-approved-record.md'))
        export=(OUT/'post-replacement-approved-record.md').read_text(encoding='utf-8')
        audio_section=export.split('## Doorstep ambience')[1].split('\n## ')[0]
        observation['exportAudioSection']=audio_section
        (OUT/'post-replacement-observation.json').write_text(json.dumps(observation,indent=2),encoding='utf-8')
        check('post-approval replacement is not presented as approved',observation['approvedCards']==0)
        check('replaced recording card withholds its player',observation['players']==1 and 'Playback is withheld' in observation['cards'])
        check('old approved player URL cannot serve replacement bytes',not observation['oldPlayerServedReplacement'] and response.status>=400)
        check('original receipt remains unchanged as historical evidence',observation['receiptsUnchanged'])
        check('approved export preserves receipt but reports original media unavailable','Available locally' not in audio_section and 'Unavailable' in audio_section and original_receipts[0]['id'] in audio_section)
        page.goto(base+'/bible.html',wait_until='networkidle')
        record=page.locator('#record-audio-AUDIO-A')
        check('viewer preserves history without an audio player',record.locator('audio').count()==0 and 'original recording unavailable' in record.inner_text())
        capture('06-replaced-approved-record')
        for method,headers in [('HEAD',{}),('GET',{'Range':'bytes=0-99'})]:
            check('stale approved audio '+method+' '+str(headers)+' refuses replacement',context.request.fetch(base+approved_url,method=method,headers=headers).status==404)
        check('no provider requests',not blocked)
        check('no browser errors',not errors)
        browser.close()
finally:
    server.terminate()
    try:server.wait(timeout=10)
    except subprocess.TimeoutExpired:server.kill();server.wait()
    log.close()
    (OUT/'results.json').write_text(json.dumps({'checks':checks,'browserErrors':errors,'blockedProviderRequests':blocked},indent=2),encoding='utf-8')
    workspace.cleanup()
print(f'Audio recording browser: {len(checks)} checks passed. Captures: {OUT}')

