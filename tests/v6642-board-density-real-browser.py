#!/usr/bin/env python3
"""Real Chromium check for bounded Production board card sizes. Self-skips when unavailable."""
import os
import pathlib
import shutil
import socket
import subprocess
import time
import re
import json
import urllib.request
import urllib.error

ROOT = pathlib.Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print(f"v{VERSION} board-density browser check skipped: Python Playwright is not installed.")
    raise SystemExit(0)

CHROMIUM = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
if not CHROMIUM:
    print("v6.6.4-studio.4 board-density browser check skipped: Chromium is unavailable.")
    raise SystemExit(0)


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def wait_server(port, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=.3):
                return
        except OSError:
            time.sleep(.15)
    raise RuntimeError("CineBraid server did not start")


port = free_port()
server = subprocess.Popen(
    ["node", "server.js"],
    cwd=ROOT,
    env={**os.environ, "PORT": str(port)},
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
try:
    wait_server(port)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROMIUM, headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.evaluate("""() => {
          const data = new Map();
          const storage = {getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear(),key:i=>[...data.keys()][i]||null,get length(){return data.size;}};
          Object.defineProperty(window, 'localStorage', {value:storage, configurable:true});
          Object.defineProperty(window, 'sessionStorage', {value:storage, configurable:true});
        }""")
        upstream = f"http://127.0.0.1:{port}"
        base = "http://cinebraid-density.test"
        def proxy_local(route):
            request = route.request
            suffix = request.url[len(base):] if request.url.startswith(base) else "/"
            target = upstream + (suffix or "/")
            headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "connection", "content-length", "accept-encoding"}}
            data = request.post_data_buffer if request.method not in {"GET", "HEAD"} else None
            req = urllib.request.Request(target, data=data, headers=headers, method=request.method)
            try:
                with urllib.request.urlopen(req, timeout=30) as response:
                    response_headers = {k: v for k, v in response.headers.items() if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}}
                    route.fulfill(status=response.status, headers=response_headers, body=response.read())
            except urllib.error.HTTPError as error:
                response_headers = {k: v for k, v in error.headers.items() if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}}
                route.fulfill(status=error.code, headers=response_headers, body=error.read())
        page.route(base + "/**", proxy_local)
        with urllib.request.urlopen(upstream + "/", timeout=30) as response:
            index_html = response.read().decode("utf-8")
        index_html = re.sub(r'<link[^>]+href=["\']https?://[^>]+>', '', index_html)
        index_html = index_html.replace("<head>", f'<head><base href="{base}/">', 1)
        page.set_content(index_html, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector("#main", timeout=10000)
        page.wait_for_function("document.body.dataset.renderReady === '1'", timeout=30000)
        page.evaluate("""async () => {
          const shot = (id, title) => ({
            id, scene:'SC-DENSITY', title, desc:'', positioning:'', dur:5,
            status:'UNBUILT', workflowStatus:'DRAFT', characters:[], codes:[], keyframes:[], clips:[],
            creationBrief:{propIds:[], vehicleIds:[], promptBuilds:[], mode:'auto', locationId:'', deliveryIntent:'still'}, audio:{}
          });
          P = {
            meta:{title:'Density test', format:'Short film', version:'6.6.4-studio.4', world:{}, styleBlocks:[]},
            scenes:[{id:'SC-DENSITY', title:'One-shot scene', tier:'B', whatHappens:'A single shot scene.'}],
            shots:[shot('D-01','Only shot')], characters:[], locations:[], props:[], vehicles:[], audio:[], mediaAssets:[], jobs:[], decisions:[], agentRuns:[]
          };
          SCAN={anchors:[],plates:[],props:[],vehicles:[],media:[],shots:{}};
          ACTIVE_PROJECT_SLUG='density-test'; FILTER.action='all'; FILTER.status=''; FILTER.route=''; FILTER.char='';
          localStorage.setItem('cinebraid-shot-board-density','compact'); SHOT_BOARD_DENSITY='compact';
          location.hash='#/shots/board'; await route();
        }""")
        page.wait_for_selector(".shot-row .slate")

        def density_cards():
            return page.locator(".log-strip").filter(has_text="One-shot scene").locator(".slate")

        def card_width():
            return density_cards().first.evaluate("node => node.getBoundingClientRect().width")

        compact = card_width()
        assert 218 <= compact <= 262, f"compact one-shot card stretched to {compact}px"
        assert page.locator(".board-density-buttons button.selected", has_text="Compact").count() == 1

        page.get_by_role("button", name="Standard").click()
        page.wait_for_timeout(150)
        standard = card_width()
        assert 278 <= standard <= 342, f"standard one-shot card measured {standard}px"

        page.get_by_role("button", name="Large").click()
        page.wait_for_timeout(150)
        large = card_width()
        assert 358 <= large <= 462, f"large one-shot card measured {large}px"
        assert large > standard > compact, f"density sizes are not ordered: {compact}, {standard}, {large}"
        assert page.evaluate("localStorage.getItem('cinebraid-shot-board-density')") == "large"

        page.evaluate("""async () => {
          P.shots.push({...P.shots[0], id:'D-02', title:'Second shot'});
          await route();
        }""")
        page.wait_for_timeout(150)
        widths = density_cards().evaluate_all("nodes => nodes.map(node => node.getBoundingClientRect().width)")
        assert len(widths) == 2, f"expected two cards, found {len(widths)}"
        assert all(width <= 462 for width in widths), f"two-shot row stretched cards: {widths}"
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 2, f"board overflowed horizontally by {overflow}px"
        browser.close()
    print(f"v{VERSION} real browser board-density check passed: compact {compact:.0f}px, standard {standard:.0f}px, large {large:.0f}px; one- and two-shot scenes remain bounded.")
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
