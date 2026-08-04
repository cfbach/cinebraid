/* CineBraid live Bible — read-only, latest approved canon */
const esc = (t) =>
  String(t ?? "").replace(
    /[&<>\"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const attr = (t) => esc(t).replace(/'/g, "&#39;");
const isVideo = (n) => /\.(mp4|webm|mov)$/i.test(n);
function copyText(t) {
  navigator.clipboard.writeText(t);
}
function block(label, text) {
  if (!text) return "";
  return `<div class="bible-block" data-search="${attr(label + " " + text)}"><div class="bible-block-head"><span>${esc(label)}</span>
    <button class="copy-btn" onclick="copyText(this.closest('.bible-block').querySelector('.bible-block-text').textContent)">COPY</button></div>
    <div class="bible-block-text">${esc(text)}</div></div>`;
}
function strip(media) {
  return `<div class="bible-media-strip">${
    media.length
      ? media
          .slice(0, 4)
          .map(
            (m) =>
              `<a href="${m.url}" target="_blank" title="Open ${attr(m.name)}">${isVideo(m.name) ? `<video muted preload="metadata" src="${m.url}#t=0.1"></video>` : `<img src="${m.url}" alt="">`}<span>${esc(m.name)}</span></a>`,
          )
          .join("")
      : '<div class="bible-media-empty">Approved record has no filed media</div>'
  }</div>`;
}
function emptyState(label, pending) {
  return `<div class="bible-empty"><b>No approved ${esc(label)} yet.</b>${pending ? `<span>${pending} in progress and intentionally hidden from canon.</span>` : ""}</div>`;
}
function section(id, kicker, title, count, body, pending = 0) {
  return `<section id="${id}" class="bible-section" data-section="${id}">
    <div class="bible-section-head"><div><span class="bible-section-kicker">${esc(kicker)}</span><h2>${esc(title)}</h2></div><div class="bible-section-count">${count}</div></div>
    ${pending ? `<div class="bible-pending">${pending} in progress · not approved for use</div>` : ""}
    <div class="bible-section-body">${body}</div>
  </section>`;
}
function entityCard(x, type) {
  const desc = x.notes || x.role || "";
  const states = (x.continuityStates || []).length
    ? `<div class="bible-states"><b>CONTINUITY STATES</b>${x.continuityStates.map((st) => `<div><span>${esc(st.name || st.id || "State")}</span>${st.appliesTo ? `<small>${esc(st.appliesTo)}</small>` : ""}${st.notes ? `<p>${esc(st.notes)}</p>` : ""}${st.approvedFile ? `<code>${esc(st.approvedFile)}</code>` : ""}</div>`).join("")}</div>`
    : "";
  return `<article class="bible-entity-card" data-search="${attr([x.id, x.name, desc, x.block, x.driftNotes, (x.continuityStates || []).map((st) => [st.name, st.appliesTo, st.notes].join(" ")).join(" ")].join(" "))}">
    ${strip(x.media || [])}
    <div class="bible-entity-body"><div class="bible-entity-meta"><span>${esc(type)}</span><code>${esc(x.id)}</code></div>
      <h3>${esc(x.name)}</h3>${desc ? `<p>${esc(desc)}</p>` : ""}
      ${x.block ? block("IDENTITY BLOCK · PASTE VERBATIM", x.block) : ""}
      ${x.driftNotes ? `<div class="bible-note"><b>Continuity / drift</b>${esc(x.driftNotes)}</div>` : ""}
      ${states}
      ${(x.made || []).map((g) => (g.prompt ? block("MADE WITH · " + (g.modelName || "?") + (g.files ? " · " + g.files : ""), g.prompt) : "")).join("")}
    </div></article>`;
}
function shotCard(s) {
  const frames = s.keyframes || [];
  const motions = s.motions || [];
  const frameStrip = frames.length
    ? `<div class="bible-frame-sequence">${frames.map((f) => `<article><header><b>${esc(f.label)}</b><span>${f.required ? "KEYFRAME" : "OPTIONAL"}</span></header>${f.winner ? `<a href="${f.winner.url}" target="_blank">${isVideo(f.winner.name) ? `<video muted preload="metadata" src="${f.winner.url}#t=0.1"></video>` : `<img src="${f.winner.url}" alt="">`}</a>` : '<div class="bible-frame-missing">NO FILE</div>'}<strong>${esc(f.title || "Frame")}</strong>${f.description ? `<p>${esc(f.description)}</p>` : ""}${f.package?.prompt ? block("FRAME PACKAGE · " + (f.package.profileName || f.package.profileId || "GENERAL"), f.package.prompt) : ""}</article>`).join("<i>→</i>")}</div>`
    : "";
  const motionList = motions.length
    ? `<div class="bible-motion-list"><b class="bible-subhead">MOTION PLAN</b>${motions.map((m) => `<article><div class="bible-motion-head"><span>${esc(m.label)}</span><strong>${esc(m.title)}</strong><code>${esc(String(m.kind || "plan").toUpperCase())} · ${esc(m.from || "?")}${m.to ? " → " + esc(m.to) : ""} · ${esc(m.dur)}s</code></div>${m.direction ? `<p>${esc(m.direction)}</p>` : ""}${m.line ? `<small>DIALOGUE · ${esc(m.line)}</small>` : ""}${m.audioNote ? `<small>VOICE NOTE · ${esc(m.audioNote)}</small>` : ""}${m.winner ? `<a class="bible-motion-winner" href="${m.winner.url}" target="_blank">Approved output · ${esc(m.winner.name)}</a>` : ""}${m.package?.prompt ? block("MOTION PACKAGE · " + (m.package.profileName || m.package.profileId || "GENERAL"), m.package.prompt) : ""}</article>`).join("")}</div>`
    : "";
  return `<article class="bible-shot" data-search="${attr([s.id, s.title, s.scene, s.route, s.prompt?.text, s.motionPrompt, frames.map((f) => [f.title, f.description].join(" ")).join(" "), motions.map((m) => [m.title, m.direction, m.kind].join(" ")).join(" ")].join(" "))}">
    <div class="bible-shot-media">${s.winner ? `<a href="${s.winner.url}" target="_blank">${isVideo(s.winner.name) ? `<video muted preload="metadata" src="${s.winner.url}#t=0.1"></video>` : `<img src="${s.winner.url}" alt="">`}<span>APPROVED</span></a>` : '<div class="bible-media-empty">Locked record has no preview</div>'}</div>
    <div class="bible-shot-body"><div class="bible-shot-top"><code>${esc(s.id)}</code><span>${esc(s.scene)}</span><span>${s.dur ? esc(s.dur) + "s" : ""}</span></div>
      <h3>${esc(s.title)}</h3><div class="bible-shot-meta">${esc(s.route || "")}${s.stillModel ? " · STILL " + esc(s.stillModel) : ""}${s.videoModel ? " · VIDEO " + esc(s.videoModel) : ""}</div>
      ${frameStrip}${motionList}
      ${!frames.length && s.prompt ? block((s.prompt.profileName ? "MODEL-READY PROMPT · " + s.prompt.profileName + (s.prompt.profileVersion ? " · " + s.prompt.profileVersion : "") : "APPROVED STILL PROMPT") + (s.prompt.refs.length ? " · ATTACH " + s.prompt.refs.join(", ") : ""), s.prompt.text) : ""}
      ${!motions.length && s.motionPrompt ? block("MOTION PROMPT", s.motionPrompt) : ""}
    </div></article>`;
}
function buildToc(items) {
  document.getElementById("bible-toc").innerHTML = items
    .map(
      (x) =>
        `<a href="#${x.id}"><span>${esc(x.label)}</span><b>${x.count}</b></a>`,
    )
    .join("");
}

function setBibleVisualMode(enabled) {
  document.body.classList.toggle("bible-visual", !!enabled);
  const button = document.getElementById("bible-visual-toggle");
  if (button) {
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.textContent = enabled ? "Editorial mode" : "Visual mode";
  }
  try { localStorage.setItem("cinebraid-bible-visual", enabled ? "1" : "0"); } catch {}
}
function wireBibleMode() {
  let enabled = false;
  try { enabled = localStorage.getItem("cinebraid-bible-visual") === "1"; } catch {}
  setBibleVisualMode(enabled);
  const button = document.getElementById("bible-visual-toggle");
  if (button) button.addEventListener("click", () => setBibleVisualMode(!document.body.classList.contains("bible-visual")));
}

function wireSearch() {
  const input = document.getElementById("bible-search");
  const apply = () => {
    const q = input.value.trim().toLowerCase();
    document
      .querySelectorAll("[data-search]")
      .forEach((el) =>
        el.classList.toggle(
          "search-hidden",
          !!q && !el.dataset.search.toLowerCase().includes(q),
        ),
      );
    document.querySelectorAll(".bible-section").forEach((sec) => {
      const searchable = [...sec.querySelectorAll("[data-search]")];
      sec.classList.toggle(
        "search-hidden",
        !!q &&
          searchable.length &&
          searchable.every((x) => x.classList.contains("search-hidden")),
      );
    });
  };
  input.addEventListener("input", apply);
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "/" &&
      !/input|textarea/i.test(document.activeElement?.tagName || "")
    ) {
      e.preventDefault();
      input.focus();
    }
    if (e.key === "Escape") {
      input.value = "";
      apply();
      input.blur();
    }
  });
}
(async () => {
  const r = await fetch("/api/bible");
  if (!r.ok) {
    document.getElementById("bible").innerHTML =
      '<div class="bible-error">Sign in required — <a href="/login.html">enter passcode</a></div>';
    return;
  }
  const B = await r.json();
  const refreshed = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  document.title = `${B.meta.title} · Project Bible`;
  document.getElementById("bible-project-mini").innerHTML =
    `<b>${esc(B.meta.title)}</b><span>${esc(B.meta.format || "")} ${B.meta.version ? "· " + esc(B.meta.version) : ""}</span>`;
  const toc = [
    { id: "overview", label: "Overview", count: "LIVE" },
    {
      id: "world",
      label: "World & style",
      count: (B.styleBlocks || []).length,
    },
    { id: "characters", label: "Characters", count: B.characters.length },
    { id: "locations", label: "Locations", count: B.locations.length },
    { id: "props", label: "Props", count: B.props.length },
    { id: "vehicles", label: "Vehicles", count: (B.vehicles || []).length },
    { id: "audio", label: "Audio", count: (B.audio || []).length },
    { id: "shots", label: "Locked shots", count: B.shots.length },
    {
      id: "review-standard",
      label: "Review standard",
      count: (B.qcChecklist || []).length,
    },
  ];
  buildToc(toc);
  const worldBody = `${B.world ? `<div class="bible-world-grid">${block("SETTING & ERA", B.world.setting)}${block("INCLUDE", B.world.include)}${block("REJECT ON SIGHT", B.world.reject)}</div>` : ""}
    ${(B.models || []).length ? `<div class="bible-model-grid">${B.models.map((m) => `<article data-search="${attr([m.name, m.type, m.notes].join(" "))}"><code>${esc(m.type)}</code><h3>${esc(m.name)}</h3><p>${esc(m.notes || "")}</p></article>`).join("")}</div>` : ""}
    ${(B.styleBlocks || []).map((b) => block(b.name + (b.stage ? " · STAGE " + b.stage : " · UNIVERSAL"), b.text)).join("")}`;
  const charBody = B.characters.length
    ? `<div class="bible-entity-grid">${B.characters.map((x) => entityCard(x, "CHARACTER")).join("")}</div>`
    : emptyState("characters", B.pending.characters);
  const locBody = B.locations.length
    ? `<div class="bible-entity-grid">${B.locations.map((x) => entityCard(x, "LOCATION")).join("")}</div>`
    : emptyState("locations", B.pending.locations);
  const propBody = B.props.length
    ? `<div class="bible-entity-grid">${B.props.map((x) => entityCard(x, "PROP")).join("")}</div>`
    : emptyState("props", B.pending.props);
  const vehicleBody = (B.vehicles || []).length
    ? `<div class="bible-entity-grid">${B.vehicles.map((x) => entityCard(x, "VEHICLE")).join("")}</div>`
    : emptyState("vehicles", B.pending.vehicles || 0);
  const audioBody = (B.audio || []).length
    ? `<div class="bible-entity-grid">${B.audio.map((x) => `<article class="bible-entity-card" data-search="${attr([x.id, x.name, x.notes].join(" "))}"><div class="bible-entity-body"><div class="bible-entity-meta"><span>AUDIO</span><code>${esc(x.id)}</code></div><h3>${esc(x.name)}</h3><p>${esc(x.notes || "")}</p>${(x.media || []).map((m) => `<div class="bible-audio"><audio controls src="${m.url}"></audio><a href="${m.url}" download="${attr(m.name)}">${esc(m.name)} ↓</a></div>`).join("")}${(x.prompts || []).map((pr) => block("GENERATION PROMPT · " + pr.id, pr.text)).join("")}</div></article>`).join("")}</div>`
    : emptyState("audio assets", B.pending.audio);
  const shotBody = B.shots.length
    ? `<div class="bible-shot-list">${B.shots.map(shotCard).join("")}</div>`
    : emptyState("locked shots", B.pending.shots);
  document.getElementById("bible").innerHTML = `
    <section id="overview" class="bible-overview">
      <div class="bible-live-row"><span class="live-dot"></span><b>LIVE PROJECT BIBLE</b><span>Latest approved canon</span></div>
      <h1>${esc(B.meta.title)}</h1>
      <div class="bible-overview-sub">${esc(B.meta.format || "")} ${B.meta.version ? "· " + esc(B.meta.version) : ""}</div>
      <p class="bible-overview-law">Only approved characters, locations, props, vehicles, audio, prompts, and locked shots appear here. Anything absent from this Bible is not production canon.</p>
      <div class="bible-metrics"><div><b>${B.characters.length + B.locations.length + B.props.length + (B.vehicles || []).length + (B.audio || []).length}</b><span>approved assets</span></div><div><b>${B.shots.length}</b><span>locked shots</span></div><div><b>${B.pending.shots}</b><span>shots in progress</span></div><div><b>${refreshed}</b><span>view refreshed</span></div></div>
    </section>
    ${section("world", "Project language", "World, models & style", (B.styleBlocks || []).length, worldBody)}
    ${section("characters", "Approved canon", "Characters", B.characters.length, charBody, B.pending.characters)}
    ${section("locations", "Approved canon", "Locations", B.locations.length, locBody, B.pending.locations)}
    ${section("props", "Approved canon", "Props", B.props.length, propBody, B.pending.props)}
    ${section("vehicles", "Approved canon", "Vehicles", (B.vehicles || []).length, vehicleBody, B.pending.vehicles || 0)}
    ${section("audio", "Approved canon", "Audio", (B.audio || []).length, audioBody, B.pending.audio || 0)}
    ${section("shots", "Production canon", "Locked shots", B.shots.length, shotBody, B.pending.shots)}
    ${section("review-standard", "Quality control", "What approved means", (B.qcChecklist || []).length, (B.qcChecklist || []).length ? `<ol class="bible-qc">${B.qcChecklist.map((q) => `<li data-search="${attr(q)}">${esc(q)}</li>`).join("")}</ol>` : emptyState("review checks", 0))}
    <footer class="bible-footer">CINEBRAID · FROMBACH STUDIOS</footer>`;
  wireBibleMode();
  wireSearch();
})();
