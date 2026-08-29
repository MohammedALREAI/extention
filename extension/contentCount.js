(function () {
  function countProtected(root = document) {
    const selectors = [".cf-inline-mask", ".cf-object-mask", ".cf-image-review-cover", ".cf-result-guard"];
    return selectors.reduce((total, selector) => total + root.querySelectorAll(selector).length, 0);
  }
  globalThis.CFContentCount = Object.freeze({ countProtected });
})();
