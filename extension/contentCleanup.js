(function () {
  function clearPageProtections(root, dependencies = {}) {
    const clearMasks = dependencies.clearMasks || globalThis.CFTextMask.clearMasks;
    const clearImageMasks = dependencies.clearImageMasks || globalThis.CFImageMask.clearImageMasks;
    const clearCard = dependencies.clearCard || globalThis.CFContentRuntime.clearCard;
    const clearExplanations = dependencies.clearExplanations || globalThis.CFDecisionExplanation?.clear || (() => undefined);
    const cards = Array.from(root.querySelectorAll("[data-cf-key]"));
    const images = Array.from(root.querySelectorAll("img"));
    const count = root.querySelectorAll(".cf-inline-mask, .cf-object-mask, .cf-image-review-cover, .cf-result-guard").length;
    clearMasks(root);
    images.forEach(clearImageMasks);
    cards.forEach(card => { clearCard(card); delete card.dataset.cfKey; });
    clearExplanations(root);
    return count;
  }
  globalThis.CFContentCleanup = Object.freeze({ clearPageProtections });
})();
