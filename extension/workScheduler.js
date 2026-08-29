(function () {
  async function runIndependent({ semanticTask, visualTask }) {
    // Both tasks are started before either is awaited: they analyze independent
    // inputs and must never ask each other to revise a decision.
    const semantic = Promise.resolve().then(semanticTask);
    const visual = Promise.resolve().then(visualTask);
    const [semanticResult, visualResult] = await Promise.all([semantic, visual]);
    return { semantic: semanticResult, visual: visualResult };
  }

  globalThis.CFWorkScheduler = Object.freeze({ runIndependent });
})();
