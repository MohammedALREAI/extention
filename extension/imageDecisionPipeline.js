(() => {
  async function precoverAndLocalize({ mode, images, imageMask, localize }) {
    const precovered = globalThis.CFStrictImageFlow.precoverCandidates(mode, images, imageMask);
    const visual = await localize();
    return { precovered, visual };
  }
  globalThis.CFImageDecisionPipeline = Object.freeze({ precoverAndLocalize });
})();
