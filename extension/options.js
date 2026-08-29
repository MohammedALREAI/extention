const $ = selector => document.querySelector(selector);
const list = $("#ruleList");
const template = $("#ruleTemplate");
let policy = globalThis.CFPolicy.defaultPolicy();

function addRule(rule = { term: "", action: $("#defaultAction").value }) {
  const fragment = template.content.cloneNode(true);
  const row = fragment.querySelector(".rule");
  row.querySelector(".term").value = rule.term || "";
  row.querySelector(".action").value = rule.action || "blur";
  row.querySelector(".remove").addEventListener("click", () => row.remove());
  list.appendChild(fragment);
}

function render(snapshot) {
  policy = globalThis.CFPolicy.sanitizePolicy(snapshot);
  $("#preference").value = policy.sourcePreference;
  $("#defaultAction").value = policy.rules[0]?.action || "blur";
  $("#scopeText").checked = policy.scope.text;
  if ($("#scopeImages")) $("#scopeImages").checked = policy.scope.images !== false;
  $("#imageProtectionMode").value = policy.imageProtectionMode;
  list.innerHTML = "";
  policy.rules.forEach(addRule);
  if (!policy.rules.length) addRule();
}

function collectRules() {
  return Array.from(list.querySelectorAll(".rule")).map(row => ({
    term: row.querySelector(".term").value.normalize("NFC").trim(),
    action: row.querySelector(".action").value,
  })).filter(rule => rule.term.length >= 2);
}

$("#addRule").addEventListener("click", () => addRule());
$("#importPolicy").addEventListener("click", async () => {
  try {
    const imported = JSON.parse($("#importSnapshot").value);
    const snapshot = await globalThis.CFPolicy.savePolicy(imported);
    render(snapshot);
    $("#status").textContent = `Imported ${snapshot.rules.length} rule${snapshot.rules.length === 1 ? "" : "s"} from Content Firewall.`;
  } catch {
    $("#status").textContent = "Import failed. Paste a valid Content Firewall policy snapshot.";
  }
});
$("#save").addEventListener("click", async () => {
  const rules = collectRules();
  if (!rules.length) { $("#status").textContent = "Add at least one term with two characters."; return; }
  const snapshot = await globalThis.CFPolicy.savePolicy({
    ...policy,
    enabled: true,
    locale: navigator.language || "auto",
    sourcePreference: $("#preference").value.trim(),
    scope: { text: $("#scopeText").checked, images: $("#scopeImages") ? $("#scopeImages").checked : true },
    imageProtectionMode: $("#imageProtectionMode").value,
    rules,
  });
  render(snapshot);
  $("#status").textContent = `Saved ${snapshot.rules.length} rule${snapshot.rules.length === 1 ? "" : "s"} across Chrome Sync.`;
});

async function refreshFeedbackStatus() {
  const events = await globalThis.CFVisualFeedback.list();
  $("#feedbackStatus").textContent = events.length ? `${events.length} local feedback example${events.length === 1 ? "" : "s"} ready to export.` : "No local feedback examples yet.";
}
$("#feedbackConsent").addEventListener("change", async event => {
  await globalThis.CFVisualFeedback.setConsent(event.target.checked);
  await refreshFeedbackStatus();
});
$("#exportFeedback").addEventListener("click", async () => {
  const events = await globalThis.CFVisualFeedback.list();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify({ schema: "content-firewall-visual-feedback/v2", exportedAt: new Date().toISOString(), consentRequired: true, uploadedAutomatically: false, events }, null, 2)], { type: "application/json" }));
  link.download = "content-firewall-visual-feedback.json";
  link.click();
  URL.revokeObjectURL(link.href);
  $("#feedbackStatus").textContent = events.length ? "Feedback JSON exported. Review it before sharing for training." : "Nothing to export yet.";
});
$("#clearFeedback").addEventListener("click", async () => {
  await globalThis.CFVisualFeedback.clear();
  await refreshFeedbackStatus();
});

Promise.all([globalThis.CFPolicy.loadPolicy(), globalThis.CFVisualFeedback.list()]).then(async ([snapshot]) => {
  render(snapshot);
  const settings = await new Promise(resolve => chrome.storage.local.get(["cfVisualFeedbackConsent"], resolve));
  $("#feedbackConsent").checked = Boolean(settings.cfVisualFeedbackConsent);
  refreshFeedbackStatus();
});
