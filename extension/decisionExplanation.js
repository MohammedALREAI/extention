(function () {
  function confidenceBand(confidence) {
    const value = Number(confidence);
    if (!Number.isFinite(value)) return "not scored";
    if (value >= 0.9) return "high confidence";
    if (value >= 0.72) return "confirmed";
    return "limited confidence";
  }

  function describeText(decision) {
    if (!decision || decision.decision === "allow" || decision.decision === "uncertain") return null;
    const matched = Array.isArray(decision.matchedText) ? decision.matchedText.join(", ") : String(decision.matchedText || "").trim();
    return `Text filtered by your policy · ${decision.source === "local" ? "local exact rule" : "semantic check"} · ${confidenceBand(decision.confidence)}${matched ? ` · matched: ${matched}` : ""}`;
  }

  function describeImages(imageResult) {
    if (!imageResult) return [];
    const items = [];
    if (imageResult.matched) items.push(`${imageResult.matched} image object${imageResult.matched === 1 ? "" : "s"} filtered by your policy · confirmed`);
    if (imageResult.failed) items.push(`${imageResult.failed} image check unavailable · kept in Review until you choose to reveal it`);
    return items;
  }

  function clear(card) {
    card?.querySelectorAll?.(":scope > .cf-decision-explanation").forEach(node => node.remove());
  }

  function apply(card, { textDecision, imageResult }) {
    if (!card || !globalThis.document || typeof card.appendChild !== "function") return false;
    const messages = [describeText(textDecision), ...describeImages(imageResult)].filter(Boolean);
    clear(card);
    if (!messages.length) return false;
    const container = document.createElement("details");
    container.className = "cf-decision-explanation";
    const summary = document.createElement("summary");
    summary.textContent = "Why was this filtered?";
    const copy = document.createElement("div");
    copy.className = "cf-decision-explanation-copy";
    copy.textContent = messages.join(" · ");
    container.appendChild(summary);
    container.appendChild(copy);
    card.appendChild(container);
    return true;
  }

  globalThis.CFDecisionExplanation = Object.freeze({ apply, clear, confidenceBand, describeText, describeImages });
})();
