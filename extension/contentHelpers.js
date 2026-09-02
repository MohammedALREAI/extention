(function () {
  function decisionPresentation(decision) {
    if (decision === "block") return { className: "cf-card-block", label: "BLOCK", reversible: true };
    if (decision === "warn") return { className: "cf-card-warn", label: "WARN", reversible: true };
    if (decision === "uncertain") return { className: "cf-card-uncertain", label: "REVIEW", reversible: true };
    if (decision === "blur") return { className: "cf-card-blur", label: "BLUR", reversible: true };
    return { className: "", label: "ALLOW", reversible: false };
  }

  function shouldProtect(decision, key, dismissedKey) {
    return decision !== "allow" && key !== dismissedKey;
  }

  // Result ids must survive the API's length bound intact. An id that comes back
  // shortened matches no candidate, and a missing decision reads as "allow" — the
  // same silent failure that made every image look clean.
  function digest(value) {
    let hash = 0x811c9dc5;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  globalThis.CFContent = Object.freeze({ decisionPresentation, shouldProtect, digest });
})();
