const MAX_TERM_CHIPS = 6;

function chip(text, className) {
  const node = document.createElement("span");
  node.className = `chip ${className}`;
  node.textContent = text;
  node.dir = "auto";
  return node;
}

function renderState(policy) {
  const node = document.querySelector("#state");
  // Three distinct situations that all used to read as the same sentence: switched off,
  // switched on with nothing to look for, and actually working.
  const state = !policy.enabled ? "paused" : policy.rules.length ? "active" : "empty";
  node.dataset.state = state;
  node.textContent = { paused: "PAUSED", active: "ACTIVE", empty: "NO RULES" }[state];
}

function renderTerms(policy) {
  const node = document.querySelector("#terms");
  node.replaceChildren();
  if (!policy.rules.length) {
    node.append(chip("Nothing blocked yet", "chip-empty"));
    return;
  }
  policy.rules.slice(0, MAX_TERM_CHIPS).forEach(rule => node.append(chip(rule.term, "chip-term")));
  const hidden = policy.rules.length - MAX_TERM_CHIPS;
  if (hidden > 0) node.append(chip(`+${hidden} more`, "chip-empty"));
}

function renderScopes(policy) {
  const node = document.querySelector("#scopes");
  const semanticActive = Boolean(policy.semantic?.endpoint) && Number(policy.semantic?.expiresAt) > Date.now();
  node.replaceChildren(
    chip("Text", policy.scope.text ? "chip-on" : "chip-off"),
    chip("Images", policy.scope.images ? "chip-on" : "chip-off"),
    chip("Semantic AI", semanticActive ? "chip-on" : "chip-off"),
  );
  return semanticActive;
}

globalThis.CFPolicy.loadPolicy().then(policy => {
  renderState(policy);
  renderTerms(policy);
  const semanticActive = renderScopes(policy);
  document.querySelector("#summary").textContent = !policy.rules.length
    ? "Add terms in protection rules to start filtering search results."
    : semanticActive
      ? "Rules apply on detected search-result pages."
      : "Import a current web policy to activate semantic multilingual analysis.";
});

// An image whose check could not complete stays visible on the page, so this is the
// only signal that a result went unchecked rather than being found clean.
const VISUAL_FAILURE_ADVICE = {
  policy_access: "Visual checking is not authorized. Copy your policy again in the web app and import it here.",
  access_ended: "Your trial or subscription access has ended, so images were not checked.",
  rate_limited: "Too many checks in one minute. Reload the page in a moment to finish checking it.",
  offline: "No network connection, so images could not be checked.",
  service_unavailable: "The vision service did not answer in time. Reload the page to retry.",
};

chrome.storage?.local?.get?.(["cfVisualStatus"], stored => {
  const node = document.querySelector("#visualStatus");
  const status = stored?.cfVisualStatus;
  const failed = Number(status?.failed) || 0;
  if (!node || !failed) return;
  const advice = VISUAL_FAILURE_ADVICE[status?.reason] || VISUAL_FAILURE_ADVICE.service_unavailable;
  node.textContent = `${failed} image check${failed === 1 ? "" : "s"} could not complete on the last search page, so those images stayed visible. ${advice}`;
  node.hidden = false;
});

document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
