#!/usr/bin/env python3
"""Real Chromium check for the Shot Board's fixed card size. Self-skips when unavailable.

EV2-7 B2.3 retired the board's Compact / Standard / Large control, which this suite used to
click through. What it measures now, in a real layout, at 390, 1280, 1440 and 1920:

  * columns: one card per row at 390, three at 1280 and 1440, four at 1920, whatever card
    size an older build left in storage; desktop cards stay a readable 280-360px;
  * whole titles: every card's title is the shot's full title and is never clamped;
  * media: the preview is contained (object-fit: contain, nothing cropped) in a well that
    stays inside its card, 16:9 for a 16:9 production, bounded for a vertical one, and about
    145px deep on a phone; a vertical source is fitted, not cut;
  * no horizontal overflow, reading type (title 18px, action 16px, reason 14px, secondary
    12px) and 44px targets;
  * paging: one pager, none for a single page; turning a page moves focus to the new page's
    first scene heading and scrolls it into view;
  * returning from a shot, by browser Back and by the Shots rail button, keeps the page and
    puts the opened card back where it was, focused.

The loaded project is the disposable sample, extended in memory with a second scene of
cloned shots; nothing is saved and no provider is called.
"""
import os
import pathlib
import shutil
import socket
import subprocess
import time
import json

ROOT = pathlib.Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
from browser_runtime import require_browser, launch_chromium, disposable_workspace

LABEL = f"v{VERSION} shot board layout browser check"
sync_playwright = require_browser(LABEL)


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
# Its own writable projects root and config, outside the checkout, seeded from the
# tracked sample. This suite used to inherit whatever the application defaulted to;
# see disposable_workspace() in browser_runtime.py for why that is no longer allowed.
workspace = disposable_workspace("board-density")
server = subprocess.Popen(
    ["node", "server.js"],
    cwd=ROOT,
    env=workspace.env(port),
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
try:
    wait_server(port)
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        # A fresh context is a fresh browser profile, so storage starts empty. The app is loaded
        # from its own origin, as a filmmaker loads it: a card's #/shot/<id> link is then the
        # same-document navigation it is in production, and browser Back returns to the board.
        # Nothing leaves this machine.
        context = browser.new_context(viewport={"width": 1600, "height": 1000})
        upstream = f"http://127.0.0.1:{port}"
        offsite = []

        def local_only(route):
            url = route.request.url
            if url.startswith(upstream) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            offsite.append(url)
            return route.abort("failed")

        context.route("**/*", local_only)
        page = context.new_page()
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(upstream + "/#/shots/board", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector("#main", timeout=10000)
        page.wait_for_function("document.body.dataset.renderReady === '1' && typeof P !== 'undefined' && !!P && (P.shots || []).length > 0", timeout=30000)

        # The sample (three shots in one scene) plus, in memory, a second scene of four clones
        # listed FIRST: page one holds four cards in one scene row (enough for four columns)
        # and one sample shot, page two the other two sample shots. One clone has a vertical
        # source, one has the longest title, one has no media at all.
        LONG_TITLE = ("The long slow push-in along the rain-streaked platform edge as the last tram pulls away "
                      "and the signal lamps change from amber to red one after another")
        VERTICAL = ("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22540%22 height=%22960%22%3E"
                    "%3Crect width=%22540%22 height=%22960%22 fill=%22%23c8844a%22/%3E%3C/svg%3E")
        page.evaluate("""async ({ longTitle, vertical }) => {
          const template = P.shots.find((shot) => shot.id === 'SAMPLE-01');
          const arrival = (SCAN.shots['SAMPLE-01'] || {}).takes || [];
          P.scenes = [{ id: 'SC-BOARD', title: 'Second platform', tier: 'B', whatHappens: 'Four more shots.', howItFeels: 'Busy.' }, ...P.scenes];
          const clone = (id, title, take) => {
            const shot = JSON.parse(JSON.stringify(template));
            Object.assign(shot, { id, scene: 'SC-BOARD', title, workflowStatus: 'IN PROGRESS', status: 'BUILT' });
            shot.keyframes = (shot.keyframes || []).map((frame) => ({ ...frame, winner: take ? take.name : '' }));
            P.shots.unshift(shot);
            SCAN.shots[id] = { takes: take ? [take] : [], locked: [] };
          };
          clone('BOARD-07', 'Lamps along the viaduct', arrival[0]);
          clone('BOARD-06', 'No image yet on this one', null);
          clone('BOARD-05', 'Mara at the vertical window', { name: 'BOARD-05-VERTICAL.png', url: vertical });
          clone('BOARD-04', longTitle, arrival[0]);
          FILTER.action = 'all'; FILTER.status = ''; FILTER.route = ''; FILTER.char = '';
          location.hash = '#/shots/board'; await route();
        }""", {"longTitle": LONG_TITLE, "vertical": VERTICAL})
        page.wait_for_selector("#main .shot-board .slate")

        def settle():
            page.wait_for_function("document.body.dataset.renderReady === '1'", timeout=30000)
            page.wait_for_function("""() => [...document.querySelectorAll('#main .slate-thumb img')].every((img) => img.complete)""", timeout=30000)
            page.wait_for_timeout(120)

        def rerender(script=""):
            page.evaluate("async () => { " + script + " ; await route(); }")
            settle()

        MEASURE = """() => {
          const main = document.getElementById('main');
          const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
          const rows = [...main.querySelectorAll('.shot-board .log-strip .shot-row')];
          const widest = rows.slice().sort((a, b) => b.children.length - a.children.length)[0];
          const columns = widest ? new Set([...widest.children].map((card) => Math.round(card.getBoundingClientRect().left))).size : 0;
          const cards = [...main.querySelectorAll('.shot-board .slate')].map((card) => {
            const title = card.querySelector('.slate-title'), well = card.querySelector('.slate-thumb'), img = well.querySelector('img');
            const titleStyle = getComputedStyle(title);
            const shot = P.shots.find((row) => row.id === card.dataset.shotId);
            let media = null;
            if (img) {
              const frame = box(img), scale = Math.min(frame.width / img.naturalWidth, frame.height / img.naturalHeight);
              media = { img: frame, fit: getComputedStyle(img).objectFit, natural: [img.naturalWidth, img.naturalHeight], content: [img.naturalWidth * scale, img.naturalHeight * scale] };
            }
            const size = (selector) => [...card.querySelectorAll(selector)].map((el) => parseFloat(getComputedStyle(el).fontSize));
            return {
              id: card.dataset.shotId, box: box(card), links: card.querySelectorAll('a').length,
              title: { text: title.textContent, expected: shot ? shot.title : null, scroll: title.scrollHeight, client: title.clientHeight,
                clamp: titleStyle.getPropertyValue('-webkit-line-clamp'), overflow: titleStyle.textOverflow, whiteSpace: titleStyle.whiteSpace, size: parseFloat(titleStyle.fontSize) },
              next: size('.slate-next'), reason: size('.slate-reason'), secondary: size('.slate-id,.slate-state,.dur-chip,.slate-context,.slate-open,.slate-enlarge,.slate-empty'),
              well: box(well), media,
            };
          });
          const targets = [...main.querySelectorAll('.shot-board :is(a[href],button,select,summary)')]
            .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
            .map((el) => ({ label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40), height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width }));
          return { columns, cards, targets, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        }"""

        EXPECTED_COLUMNS = {390: 1, 1280: 3, 1440: 3, 1920: 4}
        findings = []
        for width, columns in EXPECTED_COLUMNS.items():
            page.set_viewport_size({"width": width, "height": 900})
            for density in ("compact", "comfortable", "large"):
                rerender(f"localStorage.setItem('cinebraid-shot-board-density','{density}'); SHOT_BOARD_DENSITY='{density}'")
                seen = page.evaluate(MEASURE)
                where = f"{width}px with a stored '{density}' card size"
                assert seen["columns"] == columns, f"{where}: expected {columns} card columns, measured {seen['columns']}"
                assert seen["overflow"] <= 1, f"{where}: the page overflows horizontally by {seen['overflow']}px"
                assert len(seen["cards"]) == 5, f"{where}: expected the first page of five cards, found {len(seen['cards'])}"
                for card in seen["cards"]:
                    label = f"{where}, {card['id']}"
                    assert card["box"]["left"] >= -0.5 and card["box"]["right"] <= width + 0.5, f"{label}: the card leaves the viewport: {card['box']}"
                    if width > 760:
                        assert 280 <= card["box"]["width"] <= 361, f"{label}: a desktop card must read at 280-360px, measured {card['box']['width']:.1f}px"
                    else:
                        assert card["box"]["width"] >= width - 40, f"{label}: a phone card fills its row, measured {card['box']['width']:.1f}px"
                    assert card["links"] == 1, f"{label}: a card is one link, found {card['links']}"
                    title = card["title"]
                    assert title["text"] == title["expected"], f"{label}: the card must show the whole title, got {title['text']!r}"
                    assert title["scroll"] <= title["client"] + 1 and title["clamp"] in ("", "none") and title["overflow"] != "ellipsis" and title["whiteSpace"] in ("normal", "pre-wrap"), f"{label}: the title is clamped or cut: {title}"
                    assert title["size"] >= 18 and all(size >= 16 for size in card["next"]) and all(size >= 14 for size in card["reason"]), f"{label}: reading type below 18/16/14px: {title['size']}, {card['next']}, {card['reason']}"
                    assert all(size >= 12 for size in card["secondary"]), f"{label}: secondary text below 12px: {card['secondary']}"
                    well = card["well"]
                    assert well["left"] >= card["box"]["left"] - 0.5 and well["right"] <= card["box"]["right"] + 0.5, f"{label}: the media well leaves its card: {well} in {card['box']}"
                    if width <= 760:
                        assert well["height"] <= 146, f"{label}: the phone media well should be about 145px deep, measured {well['height']:.1f}px"
                    else:
                        assert abs(well["height"] - well["width"] * 9 / 16) <= 1.5, f"{label}: a 16:9 production's well must be 16:9, measured {well['width']:.1f}x{well['height']:.1f}"
                    media = card["media"]
                    if media:
                        assert media["fit"] == "contain", f"{label}: the preview must be contained, not cropped: object-fit {media['fit']}"
                        assert media["img"]["left"] >= well["left"] - 0.5 and media["img"]["right"] <= well["right"] + 0.5 and media["img"]["top"] >= well["top"] - 0.5 and media["img"]["bottom"] <= well["bottom"] + 0.5, f"{label}: the preview leaves its well"
                        assert media["content"][0] <= media["img"]["width"] + 0.5 and media["content"][1] <= media["img"]["height"] + 0.5, f"{label}: the fitted source exceeds its box: {media}"
                        if media["natural"][1] > media["natural"][0]:
                            assert abs(media["content"][1] - media["img"]["height"]) <= 1, f"{label}: a vertical source must be fitted to the well's full height: {media}"
                small = [target for target in seen["targets"] if target["height"] < 43.5]
                assert not small, f"{where}: interactive targets below 44px: {small[:6]}"
            findings.append(f"{width}px: {columns} column(s) at every stored card size, whole titles, contained media, no overflow")

        # A vertical production: the well follows the format and stays bounded.
        for width, cap in ((1440, 287.5), (390, 146)):
            page.set_viewport_size({"width": width, "height": 900})
            rerender("P.meta.aspectRatio = '9:16'")
            wells = page.evaluate("() => [...document.querySelectorAll('#main .shot-board .slate-thumb')].map((well) => { const r = well.getBoundingClientRect(); return [r.width, r.height]; })")
            assert wells and all(height <= cap for _, height in wells), f"{width}px 9:16 production: a well exceeds its {cap}px bound: {wells}"
            if width > 760:
                assert all(height > w * 9 / 16 + 10 for w, height in wells), f"{width}px 9:16 production: the well must take the vertical format, not stay 16:9: {wells}"
        rerender("P.meta.aspectRatio = '16:9'")
        findings.append("9:16 production: wells take the format and stay within 287px (145px on a phone)")

        # One pager, none for a single page.
        page.set_viewport_size({"width": 1440, "height": 800})
        rerender()
        assert page.locator("#main .board-pager").count() == 1, "a board with a second page must show one pager"
        rerender("FILTER.status = 'APPROVED'")
        assert page.locator("#main .shot-board .slate").count() <= 5 and page.locator("#main .board-pager").count() == 0, "a single page of shots must show no pager"
        rerender("FILTER.status = ''")

        def turn_page():
            page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
            page.locator("#main .board-pager button", has_text="Next").click()
            page.wait_for_function("() => document.activeElement && document.activeElement.classList.contains('log-heading')", timeout=10000)
            return page.evaluate("""() => {
              const heading = document.activeElement, first = document.querySelector('#main .shot-board .slate');
              const header = document.getElementById('topbar').getBoundingClientRect().bottom;
              return { heading: heading.textContent.trim(), firstHeading: document.querySelector('#main .shot-board .log-heading').textContent.trim(),
                top: heading.getBoundingClientRect().top, header, cardTop: first.getBoundingClientRect().top, height: innerHeight,
                range: document.getElementById('shot-board-range').textContent };
            }""")

        for width, height in ((1440, 800), (390, 844)):
            page.set_viewport_size({"width": width, "height": height})
            page.evaluate("() => setShotBoardPage(0)")
            settle()
            turned = turn_page()
            assert turned["heading"] == turned["firstHeading"], f"{width}px: paging must focus the new page's first scene heading: {turned}"
            assert turned["header"] - 1 <= turned["top"] <= turned["height"] / 2, f"{width}px: that heading must be scrolled into view below the header: {turned}"
            assert turned["cardTop"] < turned["height"], f"{width}px: and the first card must be in view: {turned}"
            assert "6–7 shown" in turned["range"], f"{width}px: the range must follow the page: {turned['range']}"
        findings.append("paging focuses the new page's first scene heading and scrolls it and the first card into view")

        # Returning from a shot keeps the page and the card's place, by Back and by the Shots rail button.
        def open_card_and_return(width, height, back):
            page.set_viewport_size({"width": width, "height": height})
            settle()
            link = page.locator("#main .shot-board .slate-link").last
            link.scroll_into_view_if_needed()
            page.evaluate("() => window.scrollBy(0, -Math.round(innerHeight / 3))")
            before = page.evaluate("""() => { const links = document.querySelectorAll('#main .shot-board .slate-link'), link = links[links.length - 1];
              return { id: link.closest('[data-shot-id]').dataset.shotId, top: link.getBoundingClientRect().top, scroll: scrollY, range: document.getElementById('shot-board-range').textContent }; }""")
            assert before["scroll"] > 40, f"{width}px: precondition: the board must be scrolled before opening a shot, or a restored scroll proves nothing: {before}"
            assert "6–7 shown" in before["range"], f"{width}px: precondition: the shot is opened from page two: {before['range']}"
            page.locator(f"#main .slate[data-shot-id=\"{before['id']}\"] .slate-title").click()
            page.wait_for_function("(id) => location.hash === '#/shot/' + id && document.body.dataset.renderReady === '1'", arg=before["id"], timeout=30000)
            page.wait_for_timeout(300)
            back()
            page.wait_for_function("(id) => document.activeElement && document.activeElement.classList.contains('slate-link') && document.activeElement.closest('[data-shot-id]').dataset.shotId === id", arg=before["id"], timeout=15000)
            after = page.evaluate("""(id) => { const link = document.querySelector('#main .slate[data-shot-id="' + id + '"] .slate-link');
              return { top: link.getBoundingClientRect().top, scroll: scrollY, range: document.getElementById('shot-board-range').textContent, hash: location.hash }; }""", before["id"])
            assert after["range"] == before["range"], f"{width}px: returning from {before['id']} must keep the board page, not page one: {before['range']} -> {after['range']}"
            assert abs(after["top"] - before["top"]) <= 2, f"{width}px: returning from {before['id']} must put its card back where it was: {before} -> {after}"
            return before, after

        before, _ = open_card_and_return(390, 844, lambda: page.go_back())
        findings.append(f"browser Back from {before['id']} keeps page two ({before['range']}) and the card's place")
        before, _ = open_card_and_return(1440, 560, lambda: page.locator('#nav .nav-btn[data-view="shots"]').click())
        findings.append(f"the Shots rail button from {before['id']} keeps the page ({before['range']}) and the card's place")

        assert not page_errors, f"the board raised uncaught errors: {page_errors}"
        browser.close()
    print(f"v{VERSION} real browser shot board check passed: " + "; ".join(findings) + ".")
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
    workspace.cleanup()
