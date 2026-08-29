(function () {
  function createVisualLocalizer(fetchImpl = fetch, ttlMs = 10 * 60 * 1000, onMetric = () => {}) {
    const cache = new Map();
    const inflight = new Map();
    const unavailable = new Map();
    async function locate(config, images) {
      if (!globalThis.CFRequestControl.networkAvailable()) return { state: "unavailable", reason: "offline", detections: new Map(), unavailableKeys: new Set(images.map(image => image.key)) };
      const endpoint = config?.visualEndpoint || config?.endpoint?.replace("/semantic-evaluate", "/visual-localize");
      if (!endpoint || !config?.token || Number(config.expiresAt) <= Date.now()) return { state: "unavailable", reason: "policy_access", detections: new Map(), unavailableKeys: new Set(images.map(image => image.key)) };
      const now = Date.now();
      images.forEach(image => { if (unavailable.get(image.key)?.expiresAt <= now) unavailable.delete(image.key); });
      const missing = images.filter(image => (!cache.get(image.key) || cache.get(image.key).expiresAt <= now) && !unavailable.has(image.key));
      onMetric("visualCacheHits", images.length - missing.length);
      const claimed = new Set();
      const unclaimed = missing.filter(image => {
        if (inflight.has(image.key) || claimed.has(image.key)) return false;
        claimed.add(image.key);
        return true;
      });
      onMetric("visualInflightJoins", missing.length - unclaimed.length);
      const precisionBatches = unclaimed.filter(image => image.precision).map(image => [image]);
      const standard = unclaimed.filter(image => !image.precision);
      const batches = [...precisionBatches, ...Array.from({ length: Math.ceil(standard.length / 3) }, (_, index) => standard.slice(index * 3, index * 3 + 3))];
      const deferred = new Map();
      unclaimed.forEach(image => {
        let settle;
        const request = new Promise(resolve => { settle = resolve; });
        deferred.set(image.key, settle);
        inflight.set(image.key, request);
      });
      async function requestBatch(batch) {
        try {
          const response = await globalThis.CFRequestControl.fetchWithDeadline(fetchImpl, endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` }, body: JSON.stringify({ images: batch.map(image => ({ id: image.key, url: image.url, width: image.width, height: image.height })) }) }, globalThis.CFRequestControl.VISUAL_TIMEOUT_MS);
          if (!response.ok) throw new Error("Visual localizer unavailable.");
          const detections = await response.json();
          if (!Array.isArray(detections)) throw new Error("Visual localizer returned an unexpected payload.");
          const answered = new Set();
          detections.forEach(detection => {
            const id = String(detection?.id ?? "");
            answered.add(id);
            if (detection?.status === "unavailable") unavailable.set(id, { expiresAt: Date.now() + Math.min(ttlMs, 10_000) });
            else cache.set(id, { value: detection.boxes || [], expiresAt: Date.now() + ttlMs });
          });
          // An image the response never answered for is an incomplete check, so it
          // must stay unavailable rather than being cached as a confident no-match.
          batch.filter(image => !answered.has(image.key)).forEach(image => unavailable.set(image.key, { expiresAt: Date.now() + Math.min(ttlMs, 10_000) }));
        } catch {
          batch.forEach(image => unavailable.set(image.key, { expiresAt: Date.now() + Math.min(ttlMs, 10_000) }));
        } finally {
          batch.forEach(image => { deferred.get(image.key)?.(); inflight.delete(image.key); });
        }
      }
      const queue = [...batches];
      const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
        while (queue.length) {
          const batch = queue.shift();
          if (batch) await requestBatch(batch);
        }
      });
      if (workers.length) await Promise.all(workers);
      const unavailableKeys = new Set(images.filter(image => unavailable.has(image.key)).map(image => image.key));
      const state = unavailableKeys.size === 0 ? "ready" : unavailableKeys.size === images.length ? "unavailable" : "partial";
      return { state, reason: unavailableKeys.size ? "service_unavailable" : null, detections: new Map(images.filter(image => !unavailableKeys.has(image.key)).map(image => [image.key, cache.get(image.key)?.value || []])), unavailableKeys };
    }
    return { locate };
  }
  globalThis.CFVisual = Object.freeze({ createVisualLocalizer });
})();
