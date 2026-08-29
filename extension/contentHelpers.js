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

  globalThis.CFContent = Object.freeze({ decisionPresentation, shouldProtect });
})();
