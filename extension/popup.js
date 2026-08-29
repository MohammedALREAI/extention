globalThis.CFPolicy.loadPolicy().then(policy => {
  const semantic = policy.semantic?.endpoint && Number(policy.semantic?.expiresAt) > Date.now() ? " Semantic multilingual analysis is active." : " Import a current web policy to activate semantic multilingual analysis.";
  const summary = policy.rules.length ? `${policy.rules.length} active rule${policy.rules.length === 1 ? "" : "s"}. Rules apply only on detected search-result pages.${semantic}` : "No rules saved yet. Add multilingual terms in protection settings.";
  document.querySelector("#summary").textContent = summary;
});
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
