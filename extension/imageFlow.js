(() => {
  const UNAVAILABLE_REASON = "Visual check unavailable — re-import policy and retry";
  const UNREADABLE_REASON = "Image source not verifiable — cannot check";

  // An image the localizer never saw is an unfinished check, not a confident
  // no-match. Strict protection covers it; Fast leaves it visible as before.
  function withUnreadableImages(visual, candidates, mode) {
    if (!candidates?.length) return visual;
    const unreadable = candidates.filter(candidate => !candidate.url);
    if (!unreadable.length || mode !== "strict") return visual;
    const unavailableKeys = new Set(visual?.unavailableKeys || []);
    const unreadableKeys = new Set();
    unreadable.forEach(candidate => { unavailableKeys.add(candidate.key); unreadableKeys.add(candidate.key); });
    return { ...(visual || {}), detections: visual?.detections || new Map(), unavailableKeys, unreadableKeys };
  }

  function applyVisualOutcomes({ images, visual, feedbackContextFor, imageMask }) {
    const result = { matched: 0, noMatch: 0, failed: 0 };
    images.forEach(candidate => {
      const baseContext = feedbackContextFor(candidate);
      if (visual.unavailableKeys?.has(candidate.key)) {
        const unreadable = visual.unreadableKeys?.has(candidate.key);
        imageMask.bindMissFeedback(candidate.image, { ...baseContext, visualOutcome: unreadable ? "unreadable_source" : "visual_failure" });
        imageMask.applyReviewCover(candidate.image, unreadable ? UNREADABLE_REASON : UNAVAILABLE_REASON);
        result.failed += 1;
        return;
      }
      const boxes = visual.detections.get(candidate.key) || [];
      const context = { ...baseContext, visualOutcome: boxes.length ? "match" : "no_match" };
      imageMask.bindMissFeedback(candidate.image, context);
      imageMask.applyBoxes(candidate.image, boxes, context);
      if (boxes.length) result.matched += 1;
      else result.noMatch += 1;
    });
    return result;
  }
  globalThis.CFImageFlow = Object.freeze({ applyVisualOutcomes, withUnreadableImages, UNAVAILABLE_REASON, UNREADABLE_REASON });
})();
