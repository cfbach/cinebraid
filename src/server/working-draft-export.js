/* EV2-7 Working draft: an editor-only readable copy of the SAVED project's creative intent.
   Allowlist of the fields the Working Bible displays. It approves nothing; it carries no
   receipts, prompts, packages, candidates or statuses, and no shot prose beyond the
   per-element "In this production" id · title lines. It is never served on a viewer route:
   server.js reads project.json from disk (never a client buffer) behind req.role==="editor". */
'use strict';
const {entityVisualDescription,shotDependencyRecords,entityNotesProvenance,entityReadableNotes}=require('../../public/shared-entities');
const LISTS=[['characters','Characters','character'],['locations','Locations','location'],['props','Props','prop'],['vehicles','Vehicles','vehicle'],['audio','Audio','audio']];
const arr=v=>Array.isArray(v)?v:[];
const str=v=>typeof v==='string'||(typeof v==='number'&&Number.isFinite(v))?String(v):''; // never "[object Object]"
const PUNCT=/[\\`*_{}\[\]<>#|!~]/g;
const inline=v=>str(v).replace(/\s+/g,' ').trim().replace(PUNCT,'\\$&');
// Text that begins a Markdown line cannot open a list, an ordered list or a setext/thematic rule.
const lineStart=l=>l.replace(/^(\s*)([-+])(?=\s|$)/,'$1\\$2').replace(/^(\s*\d+)([.)])(?=\s|$)/,'$1\\$2').replace(/^(\s*)(=+|-+)\s*$/,'$1\\$2');
// Leading spaces or tabs would open an indented code block after a blank line: indentation is kept as no-break spaces (not Markdown whitespace), blank-looking lines stay blank.
const indent=l=>/^[ \t]*$/.test(l)?'':l.replace(/^[ \t]+/,m=>m.replace(/\t/g,'    ').replace(/ /g,' '));
// Authored prose keeps its line breaks (hard breaks) and cannot become a heading, list, quote, rule, table, code block or HTML.
const prose=v=>{const t=str(v).replace(/\r\n?/g,'\n').trim();if(!t)return '_Not yet written._';
  return t.split('\n').map(l=>lineStart(indent(l).replace(PUNCT,'\\$&'))).join('  \n');};
function workingDraftMarkdown(project,{revision='',exportedAt='',projectSlug=''}={}){
  const P=project&&typeof project==='object'?project:{}, meta=P.meta&&typeof P.meta==='object'?P.meta:{}, world=meta.world&&typeof meta.world==='object'?meta.world:{};
  const out=[`# ${inline(meta.title)||'Untitled project'} — Working draft`,'','**WORKING DRAFT · SAVED SNAPSHOT · NOT APPROVED**','',
    'Exported from the last saved version of this project. Edits that were open or not yet saved are not included. This is creative intent from the Working Bible. It is not the Approved record and it approves nothing.','',
    `- Format: ${inline(meta.format)||'Not set'}`,...(exportedAt?[`- Exported: ${inline(exportedAt)}`]:[]),'',
    '## World & style','','### World / setting','',prose(str(world.setting)||meta.worldSetting),'','### Visual language','',prose(meta.globalStylePrompt),'','### Creative exclusions','',prose(str(meta.globalNegativePrompt)||world.reject),''];
  if(str(world.include).trim())out.push('### Existing world inclusions','',prose(world.include),'','_Existing project text · read only in the Working Bible._','');
  const deps=arr(P.shots).map(s=>[s,shotDependencyRecords(P,s)]); // once, not per entity (large casts)
  const sources=[];let any=false;
  for(const [list,label,type] of LISTS){const rows=arr(P[list]).filter(x=>x&&typeof x==='object');if(!rows.length)continue;any=true;out.push(`## ${label}`,'');
    for(const x of rows){const id=str(x.id),name=inline(x.name)||inline(id)||'Unnamed element';out.push(`### ${name}`,'');if(str(x.role).trim())out.push(`_${inline(x.role)}_`,'');
      const desc=str(x.creationDescription),effective=entityVisualDescription(x,list),notes=str(x.notes),provenance=entityNotesProvenance(notes);
      // When the fallback IS the notes field it is said once, under Creative notes, so imported identifiers stay under Sources & history.
      const notesAreFallback=!!effective&&effective!==desc.trim()&&effective===notes.trim();
      out.push('#### Visual description','',prose(desc),'');
      if(effective&&effective!==desc.trim()&&!notesAreFallback)out.push('#### Existing description fallback','',prose(effective),'','_Other workflows currently read this existing description. A saved visual description takes precedence._','');
      if(list==='characters')out.push('#### Identity','',prose(x.block),'');
      out.push('#### Creative notes','',prose(provenance?entityReadableNotes(notes):notes),'',...(notesAreFallback?['_Other workflows currently read these notes as the visual description. A saved visual description takes precedence._','']:[]));
      const related=id?deps.filter(([,r])=>r.some(d=>d.resolved&&d.type===type&&str(d.entity?.id||d.id)===id)).map(([s])=>s):[];
      out.push('#### In this production','',...(related.length?related.map(s=>`- ${lineStart(inline(s.id))||'Unidentified shot'} · ${inline(s.title)||'Untitled shot'}`):['_No recorded shot links. This does not establish that the element is unused._']),'');
      sources.push(`- ${label} · ${name} · ID ${inline(id)||'not recorded'}${provenance?` · Imported source references: ${inline(provenance)}`:''}`);}}
  if(!any)out.push('## Production elements','','_No production elements recorded yet._','');
  out.push('## Sources & history','',`- Snapshot: saved project file${str(projectSlug).trim()?` · project ${inline(projectSlug)}`:''}${revision?` · revision sha256:${inline(revision)}`:''}`,
    '- Approval receipts, prompts, generation packages and candidate media are not part of this document. Download the Approved record for current receipt-backed targets.',...sources,'');
  return out.join('\n').replace(/\n{3,}/g,'\n\n')+'\n';}
module.exports={workingDraftMarkdown};
