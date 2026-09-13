(function () {
  function createSemanticEvaluator(fetchImpl = fetch, ttlMs = 10 * 60 * 1000) {
    const cache = new Map();
    const inflight = new Map();

    async function evaluate(config, candidates, ruleTerms = []) {
      if (!globalThis.CFRequestControl.networkAvailable()) return { available: false, reason: "offline", decisions: new Map() };
      if (!config?.endpoint || !config?.token || Number(config.expiresAt) <= Date.now()) {
        return { available: false, decisions: new Map() };
      }
      const now = Date.now();
      const missing = candidates.filter(candidate => {
        const entry = cache.get(candidate.key);
        return !entry || entry.expiresAt <= now;
      });
      if (missing.length) {
        const requestKey = missing.map(candidate => candidate.key).join("|");
        if (!inflight.has(requestKey)) {
          inflight.set(requestKey, globalThis.CFRequestControl.fetchWithDeadline(fetchImpl, config.endpoint, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
            body: JSON.stringify({
              rules: ruleTerms,
              results: missing.map(candidate => ({ id: candidate.key, text: candidate.text })),
            }),
          }, globalThis.CFRequestControl.SEMANTIC_TIMEOUT_MS).then(async response => {
            if (!response.ok) throw new Error(`Semantic endpoint returned ${response.status}.`);
            const payload = await response.json();
            return Array.isArray(payload) ? payload : Array.isArray(payload.evaluations) ? payload.evaluations : [];
          }).then(evaluations => {
            evaluations.forEach(evaluation => cache.set(evaluation.id, { value: evaluation, expiresAt: Date.now() + ttlMs }));
          }).finally(() => inflight.delete(requestKey)));
        }
        try {
          await inflight.get(requestKey);
        } catch {
          return { available: false, decisions: new Map() };
        }
      }
      return {
        available: true,
        decisions: new Map(candidates.map(candidate => [candidate.key, cache.get(candidate.key)?.value]).filter(([, decision]) => Boolean(decision))),
      };
    }

    return { evaluate };
  }

  globalThis.CFSemantic = Object.freeze({ createSemanticEvaluator });
})();
