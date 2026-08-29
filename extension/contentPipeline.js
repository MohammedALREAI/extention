(() => {
  function textTerms(decision) {
    return globalThis.CFContentFlow.exactSemanticTerms(decision);
  }

  function processCard({ card, textDecision, imageCandidates = [], visual, feedbackContextFor, textMask, imageMask, imageFlow }) {
    const textMasks = textMask.maskText(card, textTerms(textDecision));
    const imageResult = visual && imageCandidates.length
      ? imageFlow.applyVisualOutcomes({ images: imageCandidates, visual, feedbackContextFor, imageMask })
      : { matched: 0, noMatch: 0, failed: 0 };
    globalThis.CFDecisionExplanation?.apply(card, { textDecision: textMasks ? textDecision : null, imageResult });
    return { textMasks, imageResult };
  }

  globalThis.CFContentPipeline = Object.freeze({ processCard, textTerms });
})();
