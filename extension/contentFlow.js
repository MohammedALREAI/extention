(function () {
  function exactSemanticTerms(decision) {
    if (!decision || decision.decision === "allow" || decision.decision === "uncertain") return [];
    const terms = Array.isArray(decision.matchedText) ? decision.matchedText : [decision.matchedText];
    return [...new Set(terms.map(term => String(term || "").trim()).filter(Boolean))];
  }

  async function applySemanticProtection({ candidates, evaluator, config, protectCard, documentRef }) {
    const semantic = await evaluator.evaluate(config, candidates);
    candidates.forEach(candidate => {
      const decision = semantic.decisions.get(candidate.key) || (semantic.available
        ? { decision: "allow", reason: "No semantic match." }
        : { decision: "uncertain", reason: "Semantic review is unavailable or needs a current policy import." });
      const matchedTerms = exactSemanticTerms(decision);
      if (matchedTerms.length && typeof protectCard === "function") protectCard(candidate.card, { ...decision, matchedTerms }, candidate.key, documentRef);
    });
    return semantic;
  }

  globalThis.CFContentFlow = Object.freeze({ applySemanticProtection, exactSemanticTerms });
})();
