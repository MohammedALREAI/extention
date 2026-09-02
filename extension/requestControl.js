(function () {
  const SEMANTIC_TIMEOUT_MS = 5_000;
  // Must outlive the server's bounded model route (2 attempts × 8s) or a fallback
  // attempt can never reach the extension.
  const VISUAL_TIMEOUT_MS = 20_000;
  const MIN_SEMANTIC_TEXT_LENGTH = 18;

  function networkAvailable(navigatorRef = globalThis.navigator) {
    return !navigatorRef || navigatorRef.onLine !== false;
  }

  function hasUsableRules(policy) {
    return Array.isArray(policy?.rules) && policy.rules.some(rule => String(rule?.term || "").trim().length >= 2);
  }

  function shouldEvaluateSemantically(candidate, policy) {
    if (!networkAvailable() || !hasUsableRules(policy)) return false;
    return String(candidate?.text || "").trim().length >= MIN_SEMANTIC_TEXT_LENGTH;
  }

  function shouldEvaluateVisually(policy) {
    return networkAvailable() && Boolean(policy?.scope?.images) && hasUsableRules(policy);
  }

  async function fetchWithDeadline(fetchImpl, url, init, timeoutMs) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timeoutId;
    const request = fetchImpl(url, { ...init, ...(controller ? { signal: controller.signal } : {}) });
    const timeout = new Promise((_, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        controller?.abort();
        reject(new Error("Remote evaluation timed out."));
      }, timeoutMs);
    });
    try {
      return await Promise.race([request, timeout]);
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  globalThis.CFRequestControl = Object.freeze({
    MIN_SEMANTIC_TEXT_LENGTH,
    SEMANTIC_TIMEOUT_MS,
    VISUAL_TIMEOUT_MS,
    networkAvailable,
    hasUsableRules,
    shouldEvaluateSemantically,
    shouldEvaluateVisually,
    fetchWithDeadline,
  });
})();
