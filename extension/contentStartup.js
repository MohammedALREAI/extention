(() => {
  function whenDocumentRootAvailable(documentRef, start) {
    if (documentRef.documentElement) { start(); return "started"; }
    documentRef.addEventListener("DOMContentLoaded", start, { once: true });
    return "waiting";
  }
  globalThis.CFContentStartup = Object.freeze({ whenDocumentRootAvailable });
})();
