(function () {
  const names = ["scansStarted", "scansCoalesced", "cardsVisible", "cardsDeferred", "semanticCandidates", "semanticBailouts", "visualCandidates", "visualBailouts", "visualCacheHits", "visualInflightJoins", "visualRetries", "visualDeferred"];
  let activeMetrics = null;
  function createPerformanceMetrics() {
    const values = Object.fromEntries(names.map(name => [name, 0]));
    return Object.freeze({
      record(name, amount = 1) { if (Object.hasOwn(values, name) && Number.isFinite(amount)) values[name] += Math.max(0, amount); },
      snapshot() { return Object.freeze({ ...values }); },
      reset() { names.forEach(name => { values[name] = 0; }); },
    });
  }
  globalThis.CFPerformance = Object.freeze({ createPerformanceMetrics, setActive: metrics => { activeMetrics = metrics; }, snapshot: () => activeMetrics?.snapshot() || Object.freeze({}) });
})();
