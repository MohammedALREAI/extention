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
      let failureReason = null;
      unavailable.forEach((entry, key) => { if (entry?.expiresAt <= now) unavailable.delete(key); });
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
      // Precision images are batched in pairs rather than sent one at a time: a whole
      // page of single-image calls was slow enough to time out and burned the request
      // budget. The prompt already requires each image to be judged on its own.
      const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));
      const precision = unclaimed.filter(image => image.precision);
      const standard = unclaimed.filter(image => !image.precision);
      const batches = [...chunk(precision, 2), ...chunk(standard, 3)];
      const deferred = new Map();
      unclaimed.forEach(image => {
        let settle;
        const request = new Promise(resolve => { settle = resolve; });
        deferred.set(image.key, settle);
        inflight.set(image.key, request);
      });
      // A refused request is terminal — retrying only burns the rate limit — while a
      // timeout or a server fault is worth exactly one more try.
      function failureFor(status) {
        if (status === 401) return { reason: "policy_access", retryable: false };
        if (status === 402) return { reason: "access_ended", retryable: false };
        if (status === 429) return { reason: "rate_limited", retryable: false };
        if (status === 400) return { reason: "service_unavailable", retryable: false };
        return { reason: "service_unavailable", retryable: true };
      }
      async function attemptBatch(batch) {
        try {
          const response = await globalThis.CFRequestControl.fetchWithDeadline(fetchImpl, endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` }, body: JSON.stringify({ images: batch.map(image => ({ id: image.key, url: image.url, ...(image.url ? {} : { dataUrl: image.dataUrl }), ...(image.context ? { context: image.context } : {}), width: image.width, height: image.height })) }) }, globalThis.CFRequestControl.VISUAL_TIMEOUT_MS);
          if (!response.ok) return { ok: false, ...failureFor(response.status) };
          const detections = await response.json();
          if (!Array.isArray(detections) || !detections.every(item => item && typeof item === "object" && typeof item.id === "string")) {
            return { ok: false, reason: "service_unavailable", retryable: false };
          }
          return { ok: true, detections };
        } catch {
          // A deadline abort or a dropped connection: worth one retry.
          return { ok: false, reason: "service_unavailable", retryable: true };
        }
      }
      async function requestBatch(batch) {
        try {
          let outcome = await attemptBatch(batch);
          if (!outcome.ok && outcome.retryable) {
            onMetric("visualRetries", batch.length);
            outcome = await attemptBatch(batch);
          }
          if (outcome.ok) {
            const answered = new Set();
            outcome.detections.forEach(detection => {
              const id = String(detection?.id ?? "");
              if (!id) return;
              answered.add(id);
              if (detection?.status === "unavailable") unavailable.set(id, { expiresAt: Date.now() + Math.min(ttlMs, 10_000) });
              else cache.set(id, { value: Array.isArray(detection.boxes) ? detection.boxes : [], expiresAt: Date.now() + ttlMs });
            });
            // An image the response never answered for is an incomplete check, so it
            // must stay unavailable rather than being cached as a confident no-match.
            batch.filter(image => !answered.has(image.key)).forEach(image => unavailable.set(image.key, { expiresAt: Date.now() + Math.min(ttlMs, 10_000) }));
          } else {
            failureReason = failureReason || outcome.reason;
            batch.forEach(image => unavailable.set(image.key, { expiresAt: Date.now() + Math.min(ttlMs, 10_000) }));
          }
        } catch {
          failureReason = failureReason || "service_unavailable";
          batch.forEach(image => unavailable.set(image.key, { expiresAt: Date.now() + Math.min(ttlMs, 10_000) }));
        } finally {
          batch.forEach(image => { deferred.get(image.key)?.(); inflight.delete(image.key); });
        }
      }
      const queue = [...batches];
      const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length) {
          const batch = queue.shift();
          if (batch) await requestBatch(batch);
        }
      });
      if (workers.length) await Promise.all(workers);
      const unavailableKeys = new Set(images.filter(image => unavailable.has(image.key)).map(image => image.key));
      const state = unavailableKeys.size === 0 ? "ready" : unavailableKeys.size === images.length ? "unavailable" : "partial";
      return { state, reason: unavailableKeys.size ? (failureReason || "service_unavailable") : null, detections: new Map(images.filter(image => !unavailableKeys.has(image.key)).map(image => [image.key, cache.get(image.key)?.value || []])), unavailableKeys };
    }
    return { locate };
  }
  globalThis.CFVisual = Object.freeze({ createVisualLocalizer });
})();
