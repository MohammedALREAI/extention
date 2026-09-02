(() => {
  const CONSENT_KEY = "cfVisualFeedbackConsent";
  const EVENTS_KEY = "cfVisualFeedbackEvents";
  const MAX_EVENTS = 250;

  function localStorageApi() { return globalThis.chrome?.storage?.local; }
  function get(keys) {
    const storage = localStorageApi();
    if (!storage?.get) return Promise.resolve({});
    return new Promise(resolve => storage.get(keys, value => resolve(value || {})));
  }
  function set(value) {
    const storage = localStorageApi();
    if (!storage?.set) return Promise.resolve();
    return new Promise(resolve => storage.set(value, resolve));
  }
  function safeImageUrl(value) {
    try {
      const url = new URL(String(value));
      // Only a real remote reference is recorded. A data: URL would write the image
      // bytes themselves into exported feedback, which must stay labels-only.
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      url.search = ""; url.hash = "";
      return url.toString().slice(0, 1_500);
    } catch { return ""; }
  }
  function boundedDimension(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number <= 10_000 ? Math.round(number) : null;
  }
  function safeOutcome(value) {
    return ["match", "no_match", "visual_failure"].includes(value) ? value : "unknown";
  }
  async function setConsent(enabled) { await set({ [CONSENT_KEY]: Boolean(enabled) }); return Boolean(enabled); }
  async function list() { const value = await get([EVENTS_KEY]); return Array.isArray(value[EVENTS_KEY]) ? value[EVENTS_KEY] : []; }
  async function clear() { await set({ [EVENTS_KEY]: [] }); }
  async function record(input) {
    const settings = await get([CONSENT_KEY, EVENTS_KEY]);
    if (!settings[CONSENT_KEY]) return { stored: false, reason: "consent_required" };
    const existing = Array.isArray(settings[EVENTS_KEY]) ? settings[EVENTS_KEY] : [];
    const event = {
      kind: input?.kind === "missed_object" ? "missed_object" : "false_positive",
      imageUrl: safeImageUrl(input?.imageUrl),
      labels: Array.isArray(input?.labels) ? input.labels.map(label => String(label).slice(0, 80)).slice(0, 12) : [],
      box: input?.box && typeof input.box === "object" ? { x: Number(input.box.x), y: Number(input.box.y), width: Number(input.box.width), height: Number(input.box.height), label: String(input.box.label || "").slice(0, 80), confidence: Number(input.box.confidence) } : null,
      policyRevision: String(input?.policyRevision || "").slice(0, 120),
      imageWidth: boundedDimension(input?.imageWidth),
      imageHeight: boundedDimension(input?.imageHeight),
      engine: String(input?.engine || "unknown").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "unknown",
      visualOutcome: safeOutcome(input?.visualOutcome),
      createdAt: new Date().toISOString(),
    };
    await set({ [EVENTS_KEY]: [...existing, event].slice(-MAX_EVENTS) });
    return { stored: true, event };
  }
  globalThis.CFVisualFeedback = Object.freeze({ setConsent, list, clear, record });
})();
