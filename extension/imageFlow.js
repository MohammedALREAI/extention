(() => {
  const UNAVAILABLE_REASON = "Visual check unavailable — re-import policy and retry";

  function applyVisualOutcomes({ images, visual, feedbackContextFor, imageMask }) {
    const result = { matched: 0, noMatch: 0, failed: 0 };
    images.forEach(candidate => {
      const baseContext = feedbackContextFor(candidate);
      if (visual.unavailableKeys?.has(candidate.key)) {
        imageMask.bindMissFeedback(candidate.image, { ...baseContext, visualOutcome: "visual_failure" });
        imageMask.applyReviewCover(candidate.image, UNAVAILABLE_REASON);
        result.failed += 1;
        return;
      }
      // An image with no source the localizer could read falls through here and is
      // left visible: no cover is shown for one, by product choice.
      const boxes = visual.detections.get(candidate.key) || [];
      const context = { ...baseContext, visualOutcome: boxes.length ? "match" : "no_match" };
      imageMask.bindMissFeedback(candidate.image, context);
      imageMask.applyBoxes(candidate.image, boxes, context);
      if (boxes.length) result.matched += 1;
      else result.noMatch += 1;
    });
    return result;
  }
  globalThis.CFImageFlow = Object.freeze({ applyVisualOutcomes, UNAVAILABLE_REASON });
})();
