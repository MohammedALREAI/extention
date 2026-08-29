(() => {
  function precoverCandidates(mode, images, imageMask) {
    if (mode !== "strict" || !imageMask?.applyPendingCover) return 0;
    return images.reduce((count, candidate) => count + (imageMask.applyPendingCover(candidate.image) ? 1 : 0), 0);
  }
  globalThis.CFStrictImageFlow = Object.freeze({ precoverCandidates });
})();
