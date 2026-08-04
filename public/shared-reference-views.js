/* Shared reference-view vocabulary for browser and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  const REFERENCE_VIEW_OPTIONS = [
    ["", "View not specified"],
    ["front", "Front"],
    ["front-three-quarter-left", "Front-left three-quarter"],
    ["left-profile", "Left profile"],
    ["rear-three-quarter-left", "Rear-left three-quarter"],
    ["rear", "Rear"],
    ["rear-three-quarter-right", "Rear-right three-quarter"],
    ["right-profile", "Right profile"],
    ["front-three-quarter-right", "Front-right three-quarter"],
    ["top", "Top / overhead"],
    ["underside", "Underside"],
    ["interior", "Interior"],
    ["detail", "Detail view"],
    ["multi-angle", "Multiple angles"],
    ["custom", "Custom / described in notes"],
  ];
  const REFERENCE_KIND_OPTIONS = [
    ["single-angle", "Single angle"],
    ["detail", "Detail / region"],
    ["turnaround", "Turnaround"],
    ["contact-sheet", "Multi-angle contact sheet"],
    ["general", "General appearance reference"],
  ];
  const VIEW_ALIASES = {
    side: "left-profile",
    "3/4": "front-three-quarter-left",
    "three-quarter": "front-three-quarter-left",
    "front-left": "front-three-quarter-left",
    "front-right": "front-three-quarter-right",
    "rear-left": "rear-three-quarter-left",
    "rear-right": "rear-three-quarter-right",
    left: "left-profile",
    right: "right-profile",
    back: "rear",
  };
  function normalizeReferenceView(value) {
    const raw = String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
    if (!raw) return "";
    if (VIEW_ALIASES[raw]) return VIEW_ALIASES[raw];
    if (REFERENCE_VIEW_OPTIONS.some(([key]) => key === raw)) return raw;
    if (/rear|back/.test(raw) && /right/.test(raw)) return "rear-three-quarter-right";
    if (/rear|back/.test(raw) && /left/.test(raw)) return "rear-three-quarter-left";
    if (/front/.test(raw) && /right/.test(raw)) return "front-three-quarter-right";
    if (/front/.test(raw) && /left/.test(raw)) return "front-three-quarter-left";
    if (/rear|back/.test(raw)) return "rear";
    if (/front/.test(raw)) return "front";
    if (/right/.test(raw)) return "right-profile";
    if (/left|side/.test(raw)) return "left-profile";
    if (/under/.test(raw)) return "underside";
    if (/top|overhead/.test(raw)) return "top";
    if (/interior|inside/.test(raw)) return "interior";
    if (/detail|close/.test(raw)) return "detail";
    if (/multi|turnaround|sheet/.test(raw)) return "multi-angle";
    return "custom";
  }
  function referenceViewLabel(value) {
    const normalized = normalizeReferenceView(value);
    return REFERENCE_VIEW_OPTIONS.find(([key]) => key === normalized)?.[1] || String(value || "View not specified");
  }
  function viewAngle(value) {
    const normalized = normalizeReferenceView(value);
    const map = {
      front: 0,
      "front-three-quarter-right": 45,
      "right-profile": 90,
      "rear-three-quarter-right": 135,
      rear: 180,
      "rear-three-quarter-left": 225,
      "left-profile": 270,
      "front-three-quarter-left": 315,
    };
    return Object.prototype.hasOwnProperty.call(map, normalized) ? map[normalized] : null;
  }
  function circularAngleDistance(a, b) {
    const diff = Math.abs(a - b) % 360;
    return Math.min(diff, 360 - diff);
  }
  function inferReferenceViewFromText(value, fallback = "") {
    const text = String(value || "").toLowerCase().replace(/[–—]/g, "-");
    if (!text.trim()) return normalizeReferenceView(fallback);
    const right = /\bright\b|camera[- ]right|screen[- ]right/.test(text);
    const left = /\bleft\b|camera[- ]left|screen[- ]left/.test(text);
    if (/rear[- ]three[- ]quarter|rear\s*3\/4|back[- ]three[- ]quarter|over[- ]the[- ]shoulder|over the shoulder/.test(text))
      return right ? "rear-three-quarter-right" : "rear-three-quarter-left";
    if (/from behind|seen from behind|back to (?:the )?camera|back-facing|facing away|faces away|turned away|walking away|rear view|back view|shown from (?:the )?back|camera sees (?:his|her|their|the) back/.test(text))
      return "rear";
    if (/right profile|profile right|right-side profile|right side view/.test(text)) return "right-profile";
    if (/left profile|profile left|left-side profile|left side view/.test(text)) return "left-profile";
    if (/profile|side-on|side view/.test(text)) return right ? "right-profile" : "left-profile";
    if (/front[- ]three[- ]quarter|front\s*3\/4|three[- ]quarter|3\/4/.test(text))
      return right ? "front-three-quarter-right" : "front-three-quarter-left";
    if (/front-facing|faces (?:the )?camera|facing (?:the )?camera|front view|seen from (?:the )?front/.test(text)) return "front";
    if (/top[- ]down|overhead|bird.?s[- ]eye/.test(text)) return "top";
    if (/underside|from below/.test(text)) return "underside";
    if (/interior|inside view|cockpit/.test(text)) return "interior";
    if (/detail|insert|close[- ]up|extreme close/.test(text)) return "detail";
    return normalizeReferenceView(fallback);
  }
  function referenceViewCompatibility(desired, candidate) {
    const desiredNorm = normalizeReferenceView(desired);
    const candidateNorm = normalizeReferenceView(candidate);
    if (!desiredNorm || !candidateNorm) return "unknown";
    if (desiredNorm === candidateNorm) return "exact";
    const desiredAngle = viewAngle(desiredNorm), candidateAngle = viewAngle(candidateNorm);
    if (desiredAngle == null || candidateAngle == null) return "special";
    const distance = circularAngleDistance(desiredAngle, candidateAngle);
    if (distance <= 45) return "near";
    if (distance >= 135) return "opposite";
    return "adjacent";
  }
  function referenceViewScore(desired, candidate, options = {}) {
    const desiredNorm = normalizeReferenceView(desired);
    const candidateNorm = normalizeReferenceView(candidate);
    const kind = String(options.referenceKind || "");
    const desiredRegion = String(options.desiredRegion || "").toLowerCase();
    const detailRegion = String(options.detailRegion || "").toLowerCase();
    if (!candidateNorm) return kind === "general" ? 18 : 4;
    let score = 0;
    if (desiredNorm && candidateNorm === desiredNorm) score += 100;
    const desiredAngle = viewAngle(desiredNorm), candidateAngle = viewAngle(candidateNorm);
    if (desiredNorm && candidateNorm !== desiredNorm && desiredAngle != null && candidateAngle != null) {
      const steps = circularAngleDistance(desiredAngle, candidateAngle) / 45;
      score += Math.max(0, 72 - steps * 18);
    }
    if (desiredNorm && candidateNorm !== desiredNorm && (desiredAngle == null || candidateAngle == null)) {
      if (candidateNorm === "multi-angle") score += 22;
      else if (candidateNorm === "detail") score += 8;
    }
    if (!desiredNorm && ["front-three-quarter-left", "front-three-quarter-right"].includes(candidateNorm)) score += 35;
    if (kind === "single-angle") score += 14;
    if (kind === "turnaround" || kind === "contact-sheet" || candidateNorm === "multi-angle") score += desiredNorm ? 10 : 24;
    if (kind === "detail" || candidateNorm === "detail") score += desiredRegion && detailRegion && (desiredRegion.includes(detailRegion) || detailRegion.includes(desiredRegion)) ? 90 : 8;
    if (desiredRegion && detailRegion) {
      for (const token of desiredRegion.split(/[^a-z0-9]+/).filter((x) => x.length > 2)) if (detailRegion.includes(token)) score += 12;
    }
    if (options.priority === "primary") score += 8;
    return score;
  }
  return { REFERENCE_VIEW_OPTIONS, REFERENCE_KIND_OPTIONS, normalizeReferenceView, referenceViewLabel, inferReferenceViewFromText, referenceViewCompatibility, referenceViewScore };
});
