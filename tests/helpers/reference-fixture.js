'use strict';
// Coherent in-memory browser fixtures still resolve ownership through the actual
// server owner, over disposable synthetic files. No compatibility reader bypass.
const fs=require('fs'),path=require('path'),{disposableRoot}=require('./disposable-root');
const {resolver}=require('../../src/media/reference-media'),{dirs}=require('../../public/shared-reference-media');
const input=JSON.parse(fs.readFileSync(0,'utf8')),w=disposableRoot('reference-projection');
try{const dir=w.writeProject('fixture',input.project),urls=new Map();
for(const folder of Object.values(dirs))for(const row of input.scan[folder]||[]){if(path.basename(row.name)!==row.name||/[\\/:]/.test(row.name))throw Error('Unsafe synthetic name');if(!row.url||row.available===false||row.missing===true)continue;const file=path.join(dir,folder,row.name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(__dirname,'../fixtures/ev2-6/frame-0.png'),file);urls.set(folder+'/'+row.name,row.url);}
const projection=resolver({projectsRoot:w.projectsRoot,slug:'fixture',project:input.project}).projection();
for(const [list,entities] of Object.entries(projection))for(const rows of Object.values(entities))for(const row of rows)if(row.available)row.url=urls.get(dirs[list]+'/'+row.name)||row.url;
process.stdout.write(JSON.stringify(projection));}finally{w.cleanup();}
