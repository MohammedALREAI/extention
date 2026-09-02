(() => {
  function textTerms(decision) {
    return globalThis.CFContentFlow.exactSemanticTerms(decision);
  }

  function processCard({ card, textDecision, imageCandidates = [], visual, feedbackContextFor, textMask, imageMask, imageFlow }) {
    const textMasks = textMask.maskText(card, textTerms(textDecision));
    const imageResult = visual && imageCandidates.length
      ? imageFlow.applyVisualOutcomes({ images: imageCandidates, visual, feedbackContextFor, imageMask })
      : { matched: 0, noMatch: 0, failed: 0 };
    // No explanation panel is rendered into the result card: the mask itself, its
    // tooltip, and the badge already say what was filtered, and an extra block
    // pushes the search layout around. `clear` also removes panels an earlier
    // build left on a tab that has not been reloaded yet.
    globalThis.CFDecisionExplanation?.clear?.(card);
    return { textMasks, imageResult };
  }

  globalThis.CFContentPipeline = Object.freeze({ processCard, textTerms });
})();
