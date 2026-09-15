"""Browser tests prove durable media identity and observable behavior,
not incidental filenames or physical storage paths. Only disposable fixtures
are passed here; registry reads and URL resolution never mutate the project.
"""
import json
import pathlib
import subprocess
from urllib.parse import urljoin, urlsplit, urlencode

ROOT = pathlib.Path(__file__).resolve().parents[1]

# Use the production reference resolver. Legacy /assets URLs remain valid, but
# resolve through their exact project-relative registry record, never basename.
RESOLVE = r"""
const fs=require('fs'),path=require('path');
const Assets=require('./src/media/media-asset-service');
const Ref=require('./src/media/reference-media');
const Owners=require('./public/shared-entity-ownership');
const {localFileAffordance}=require('./src/media/local-file-affordance');
const [dir,url,list,id]=process.argv.slice(1),root=path.dirname(dir),slug=path.basename(dir);
const project=JSON.parse(fs.readFileSync(path.join(dir,'project.json'),'utf8'));
const registry=Assets.readAssets(root,slug);
if(registry.readOnly)throw Error('fixture registry unavailable');
let found=Ref.resolveUrl({projectsRoot:root,slug,project,url});
if(!found && url.startsWith('/assets/')) {
  const rel=decodeURIComponent(url.split('?')[0].slice(8));
  const matches=registry.assets.filter(a=>a.storage?.path===rel);
  if(matches.length!==1)throw Error('media URL has no unique durable identity');
  const asset=matches[0],local=localFileAffordance({projectsRoot:root,slug,key:'asset:'+asset.assetId});
  found={available:local.state==='available',assetId:asset.assetId,path:local.path};
}
if(!found?.available)throw Error('requested media does not resolve');
if(list) {
  const rows=registry.assets.filter(a=>a.assetId===found.assetId);
  if(rows.length!==1)throw Error('reference identity not in fixture project');
  const owned=Ref.resolver({projectsRoot:root,slug,project}).listing(list,(project[list]||[]).find(e=>e.id===id));
  if(!owned.some(r=>r.available && r.assetId===found.assetId))throw Error('foreign reference media');
}
console.log(JSON.stringify({assetId:found.assetId}));
"""


def fixture_asset(project_dir, relative):
    """Bind a known fixture file to its independently minted registry identity."""
    project_dir=pathlib.Path(project_dir).resolve()
    target=(project_dir/relative).resolve()
    assert target.is_relative_to(project_dir), 'fixture media outside disposable project'
    registry=json.loads((project_dir/'media-assets.json').read_text(encoding='utf-8'))
    matches=[r for r in registry['assets'] if r.get('storage',{}).get('path')==relative]
    assert len(matches)==1, f'fixture must have one durable asset: {relative}'
    row=matches[0]
    assert row['assetId'].startswith('asset-') and target.is_file(), 'fixture asset unavailable'
    return row['assetId'],target.read_bytes()


def assert_media_response(page, project_dir, url, expected_relative, owner=None):
    expected,expected_bytes=fixture_asset(project_dir,expected_relative)
    absolute=urljoin(page.url,url)
    parsed=urlsplit(absolute); origin=urlsplit(page.url)
    assert (parsed.scheme,parsed.netloc)==(origin.scheme,origin.netloc), 'media request left fixture origin'
    request_path=parsed.path+('?' + parsed.query if parsed.query else '')
    resolved=subprocess.run(['node','-e',RESOLVE,str(pathlib.Path(project_dir).resolve()),request_path,*(owner or ('',''))],
                            cwd=ROOT,check=True,capture_output=True,text=True)
    actual=json.loads(resolved.stdout)['assetId']
    assert actual==expected, f'wrong durable media identity: {actual}, expected {expected}'
    response=page.request.get(absolute)
    assert response.ok, f'media response failed: {response.status}'
    assert response.body()==expected_bytes, 'resolved response is not the expected asset bytes'
    return actual


def assert_media_image(page, project_dir, selector, expected_relative, owner=None):
    image=page.locator(selector).first
    image.wait_for(state='visible')
    image.evaluate("img => img.decode()")
    assert image.evaluate("img => img.complete && img.naturalWidth>0 && img.naturalHeight>0"), 'preview did not decode'
    return assert_media_response(page,project_dir,image.get_attribute('src'),expected_relative,owner)


def assert_reference_rejected(page, project_dir, entity_id, key):
    """A foreign/missing candidate must neither serve bytes nor project as usable."""
    query=urlencode({'project':pathlib.Path(project_dir).name,'list':'characters','id':entity_id,'key':key})
    response=page.request.get(urljoin(page.url,'/api/references/image?'+query))
    assert response.status==404, 'foreign or missing reference served media'
    scan=page.request.get(urljoin(page.url,'/api/scan')).json()
    rows=scan.get('references',{}).get('characters',{}).get(entity_id,[])
    assert not any(r.get('name')==key and r.get('available') for r in rows), 'unavailable reference entered usable projection'
