const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function wait(url){for(let i=0;i<80;i++){try{const r=await fetch(url);if(r.ok)return;}catch{} await new Promise(r=>setTimeout(r,75));}throw new Error('server did not start');}
async function main(){
  const focused=read('public/focused-workspaces.js');
  const app=read('public/app.js');
  const mutations=read('public/mutations.js');
  const settings=read('public/settings.js');
  const server=read('server.js');
  assert(focused.includes('taskIdForElement'), 'focused tasks need stable task IDs');
  assert(focused.includes('resolveTaskSelection'), 'legacy numeric task selection must migrate');
  assert(focused.includes('window.selectFocusedTask'), 'cross-section task navigation API required');
  assert(!focused.includes('new MutationObserver(schedule).observe(root, { childList: true, subtree: true })'), 'broad workspace MutationObserver must be removed');
  assert(app.includes('cinebraid:route-rendered'), 'route renderer must emit a focused-workspace event');
  assert(mutations.includes('entityDependencyImpact'), 'entity deletion must preview dependencies');
  assert(mutations.includes('deletedTargets'), 'deleted targets must remain traceable');
  assert(settings.includes('restoreProjectBackup'), 'Settings must expose backup restore');
  assert(server.includes('validateProjectForSave'), 'server must validate project saves');
  assert(server.includes('PROJECT_BACKUP_LIMIT = 10'), 'server must retain rotating backups');

  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cinebraid-recovery-'));
  const projects=path.join(temp,'projects');
  const projectDir=path.join(projects,'recovery');
  fs.mkdirSync(projectDir,{recursive:true});
  const initial={meta:{title:'Recovery',schemaVersion:'6.6'},scenes:[{id:'SC-1',title:'Scene'}],shots:[{id:'SC-1-01',scene:'SC-1',title:'Shot',characters:[],codes:[],keyframes:[],clips:[],candidateFiles:[]}],characters:[],locations:[],props:[],vehicles:[],audio:[],mediaAssets:[],jobs:[],agentRuns:[],decisions:[],sessions:[]};
  fs.writeFileSync(path.join(projectDir,'project.json'),JSON.stringify(initial,null,2));
  const config=path.join(temp,'config.json');
  fs.writeFileSync(config,JSON.stringify({activeProject:'recovery',assistant:{provider:'none',visionProvider:'none'},editorPass:'',viewerPass:'',agents:{enabled:false}},null,2));
  const port=await freePort();
  const child=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(port),CINEBRAID_CONFIG_PATH:config,CINEBRAID_PROJECTS_ROOT:projects},stdio:['ignore','pipe','pipe']});
  let stderr=''; child.stderr.on('data',d=>stderr+=d);
  try{
    const base=`http://127.0.0.1:${port}`; await wait(`${base}/api/project`);
    let r=await fetch(`${base}/api/projects/recovery/project`,{method:'PUT',headers:{'content-type':'application/json','if-match':'*'},body:JSON.stringify({meta:{title:'Broken'},scenes:'bad',shots:[]})});
    assert.strictEqual(r.status,422,'invalid project save must be rejected');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(projectDir,'project.json'),'utf8')).meta.title,'Recovery','rejected save must not replace project');
    for(let i=1;i<=12;i++){
      const next=structuredClone(initial); next.meta.title=`Recovery ${i}`;
      r=await fetch(`${base}/api/projects/recovery/project`,{method:'PUT',headers:{'content-type':'application/json','if-match':'*'},body:JSON.stringify(next)});
      assert(r.ok,`validated save ${i} failed`);
    }
    r=await fetch(`${base}/api/projects/recovery/backups`); const list=await r.json();
    assert(r.ok && list.backups.length===10,'rotating backup list must be capped at 10');
    const restoreName=list.backups[list.backups.length-1].name;
    r=await fetch(`${base}/api/projects/recovery/restore`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:restoreName})});
    const restored=await r.json();
    assert(r.ok && restored.restored===restoreName,'backup restore must succeed');
    assert(fs.existsSync(path.join(projectDir,'backups')),'backup directory must exist');
  } finally { child.kill('SIGTERM'); }
  if(stderr && /Error|Exception/.test(stderr)) throw new Error(stderr);
  console.log('Data recovery and focused-state suite passed validated saves, rotating backups, restore, stable task IDs, route events, dependency-aware deletion, and deleted-target history.');
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
