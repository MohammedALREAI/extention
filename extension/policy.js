(function () {
  const ACTIONS = ["blur", "block", "warn"];
  const PRIORITY = { block: 3, blur: 2, warn: 1 };
  // "auto" lets the mask pick its blur strength from the detected region's size.
  const BLUR_INTENSITIES = ["light", "medium", "strong"];

  function defaultPolicy() {
    return {
      schemaVersion: 1,
      revision: "starter",
      enabled: true,
      locale: "auto",
      sourcePreference: "",
      scope: { text: true, images: true },
      imageProtectionMode: "strict",
      blurIntensity: "auto",
      rules: [],
    };
  }

  function normalize(value) {
    return String(value || "").normalize("NFC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function containsTerm(haystack, alias) {
    if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(alias)) return haystack.includes(alias);
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(alias)}(?=$|[^\\p{L}\\p{N}])`, "u").test(haystack);
  }

  function sanitizePolicy(candidate) {
    const base = defaultPolicy();
    const source = candidate && typeof candidate === "object" ? candidate : {};
    const seenTerms = new Set();
    const rules = Array.isArray(source.rules)
      ? source.rules
          .map(rule => ({
            term: String(rule && rule.term ? rule.term : "").normalize("NFC").trim(),
            action: ACTIONS.includes(rule && rule.action) ? rule.action : "blur",
          }))
          .filter(rule => rule.term.length >= 2)
          // The same term twice would be sent to the model twice and counted twice.
          .filter(rule => {
            const key = rule.term.toLocaleLowerCase();
            if (seenTerms.has(key)) return false;
            seenTerms.add(key);
            return true;
          })
          .slice(0, 20)
      : [];

    return {
      ...base,
      ...source,
      scope: { ...base.scope, ...(source.scope || {}) },
      rules,
      revision: String(source.revision || base.revision),
      locale: String(source.locale || base.locale),
      sourcePreference: String(source.sourcePreference || ""),
      enabled: source.enabled !== false,
      imageProtectionMode: source.imageProtectionMode === "fast" ? "fast" : "strict",
      blurIntensity: BLUR_INTENSITIES.includes(source.blurIntensity) ? source.blurIntensity : "auto",
    };
  }

  function evaluateText(text, policy) {
    const snapshot = sanitizePolicy(policy);
    if (!snapshot.enabled || !snapshot.scope.text) {
      return { decision: "allow", matchedRules: [], reason: "Text checks are disabled in this policy." };
    }

    const haystack = normalize(text);
    const matched = snapshot.rules.map(rule => ({ rule, alias: normalize(rule.term) }))
      .filter(match => containsTerm(haystack, match.alias));
    if (!matched.length) {
      return { decision: "allow", matchedRules: [], reason: "No rule matched this result card." };
    }

    const strongest = matched.reduce((winner, match) => PRIORITY[match.rule.action] > PRIORITY[winner.rule.action] ? match : winner);
    const matchedRules = matched.map(match => match.rule);
    return {
      decision: strongest.rule.action,
      matchedRules,
      reason: `Matched “${strongest.rule.term}”.`,
    };
  }

  function loadPolicy() {
    if (!globalThis.chrome || !chrome.storage || !chrome.storage.sync) return Promise.resolve(defaultPolicy());
    return new Promise(resolve => chrome.storage.sync.get({ policy: defaultPolicy() }, stored => resolve(sanitizePolicy(stored.policy))));
  }

  function savePolicy(policy) {
    const snapshot = sanitizePolicy({ ...policy, revision: String(Date.now()) });
    if (!globalThis.chrome || !chrome.storage || !chrome.storage.sync) return Promise.resolve(snapshot);
    return new Promise(resolve => chrome.storage.sync.set({ policy: snapshot }, () => resolve(snapshot)));
  }

  globalThis.CFPolicy = Object.freeze({ defaultPolicy, evaluateText, loadPolicy, normalize, sanitizePolicy, savePolicy });
})();
