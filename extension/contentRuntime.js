(function () {
  function clearCard(card) {
    card.classList.remove("cf-card-protected", "cf-card-blur", "cf-card-block", "cf-card-warn", "cf-card-uncertain");
    card.querySelector(":scope > .cf-result-guard")?.remove();
  }

  function protectCard(card, decision, key, documentRef = document) {
    clearCard(card);
    if (!globalThis.CFContent.shouldProtect(decision.decision, key, card.dataset.cfDismissed)) return false;

    const presentation = globalThis.CFContent.decisionPresentation(decision.decision);
    card.classList.add("cf-card-protected", presentation.className);
    const guard = documentRef.createElement("div");
    guard.className = "cf-result-guard";
    guard.setAttribute("role", "status");
    guard.innerHTML = `<div class="cf-guard-copy"><strong>${presentation.label}</strong><span>${decision.reason}</span></div><button type="button">Show result</button>`;
    guard.querySelector("button").addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      card.dataset.cfDismissed = key;
      clearCard(card);
      if (typeof globalThis.dispatchEvent === "function") globalThis.dispatchEvent(new Event("cf:count-change"));
    });
    card.appendChild(guard);
    return true;
  }

  globalThis.CFContentRuntime = Object.freeze({ clearCard, protectCard });
})();
