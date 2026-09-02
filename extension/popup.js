globalThis.CFPolicy.loadPolicy().then(policy => {
  const semantic = policy.semantic?.endpoint && Number(policy.semantic?.expiresAt) > Date.now() ? " Semantic multilingual analysis is active." : " Import a current web policy to activate semantic multilingual analysis.";
  const summary = policy.rules.length ? `${policy.rules.length} active rule${policy.rules.length === 1 ? "" : "s"}. Rules apply only on detected search-result pages.${semantic}` : "No rules saved yet. Add multilingual terms in protection settings.";
  document.querySelector("#summary").textContent = summary;
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
