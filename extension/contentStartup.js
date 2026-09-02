(() => {
  function whenDocumentRootAvailable(documentRef, start) {
    if (documentRef.documentElement) { start(); return "started"; }
    documentRef.addEventListener("DOMContentLoaded", start, { once: true });
    return "waiting";
  }

  // Reloading or updating the extension tears down its context, but the content
  // script keeps running in tabs that were already open. Every chrome.* call from
  // that orphaned script then fails with "Extension context invalidated" — reading
  // `runtime.id` is the cheapest way to notice, and it can throw rather than return
  // undefined, so it is guarded too.
  function extensionAlive(chromeRef = globalThis.chrome) {
    try { return Boolean(chromeRef?.runtime?.id); } catch { return false; }
  }

  // Chrome's promise-style APIs reject asynchronously once the context is gone, which
  // surfaces as an uncaught rejection in the page console. Swallow both shapes: the
  // caller cannot do anything useful with an extension that no longer exists.
  function safeExtensionCall(operation) {
    if (!extensionAlive()) return false;
    try {
      operation()?.catch?.(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  globalThis.CFContentStartup = Object.freeze({ whenDocumentRootAvailable, extensionAlive, safeExtensionCall });
})();
