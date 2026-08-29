(function () {
  let activePolicy = null;
  let queued = false;
  let scanning = false;
  let scanAgain = false;
  const performance = globalThis.CFPerformance.createPerformanceMetrics();
  globalThis.CFPerformance.setActive(performance);
  const semanticEvaluator = globalThis.CFSemantic.createSemanticEvaluator();
  const visualLocalizer = globalThis.CFVisual.createVisualLocalizer(fetch, 10 * 60 * 1000, performance.record);
  const visibility = globalThis.CFVisibility.createVisibilityScheduler({ onEligible: requestScan });

  function reportCount() {
    chrome.runtime.sendMessage({ type: "CF_PROTECTION_COUNT", count: globalThis.CFContentCount.countProtected(document) });
  }

  function resultKey(text) {
    return `${activePolicy.revision}:${text.slice(0, 320)}`;
  }

  async function scan() {
    queued = false;
    if (scanning) { scanAgain = true; performance.record("scansCoalesced"); return; }
    scanning = true;
    performance.record("scansStarted");
    try {
    if (!activePolicy || !activePolicy.enabled || !globalThis.CFEngines || !globalThis.CFPolicy) {
      globalThis.CFContentCleanup.clearPageProtections(document);
      reportCount();
      return;
    }
    const { engine, cards: discoveredCards } = globalThis.CFEngines.cardsForDocument(document, location.href);
    const imageCards = globalThis.CFEngines.imageCardsForDocument(document, location.href).cards;
    const visibleUniverse = Array.from(new Set([...discoveredCards, ...imageCards]));
    visibility.track(visibleUniverse);
    const allCards = visibility.eligible(visibleUniverse);
    performance.record("cardsVisible", allCards.length);
    performance.record("cardsDeferred", visibleUniverse.length - allCards.length);
    const visibleCards = new Set(allCards);
    const cards = discoveredCards.filter(card => visibleCards.has(card));
    const semanticCandidates = [];
    const localDecisions = new Map();
    cards.forEach(card => {
      if (card.closest(".cf-result-guard")) return;
      const text = globalThis.CFEngines.extractResultText(card);
      const key = resultKey(text);
      if (card.dataset.cfKey === key) return;
      card.dataset.cfKey = key;
      const local = globalThis.CFPolicy.evaluateText(text, activePolicy);
      if (local.decision !== "allow") {
        globalThis.CFTextMask.maskText(card, local.matchedRules.map(rule => rule.term));
        localDecisions.set(key, { ...local, source: "local", confidence: 1, matchedText: local.matchedRules.map(rule => rule.term) });
      } else {
        semanticCandidates.push({ card, key, text });
      }
    });
    const remoteSemanticCandidates = semanticCandidates
      .filter(candidate => candidate.card.dataset.cfKey === candidate.key)
      .filter(candidate => globalThis.CFRequestControl.shouldEvaluateSemantically(candidate, activePolicy));
    performance.record("semanticCandidates", remoteSemanticCandidates.length);
    performance.record("semanticBailouts", semanticCandidates.length - remoteSemanticCandidates.length);
    let visualTargets = [];
    let analyzableImages = [];
    if (globalThis.CFRequestControl.shouldEvaluateVisually(activePolicy)) {
      const imageOwners = new Map();
      allCards.forEach(card => Array.from(card.querySelectorAll("img")).forEach(image => {
        if (!imageOwners.has(image)) imageOwners.set(image, card);
      }));
      visualTargets = Array.from(imageOwners.entries()).map(([image, card], index) => {
        if (!image.complete) image.addEventListener("load", requestScan, { once: true });
        const source = globalThis.CFImageSource.visualSource(image);
        return { card, image, key: globalThis.CFImageSource.sourceKey(activePolicy.revision, source, index), url: source.url, inline: source.inline, width: image.naturalWidth, height: image.naturalHeight, precision: engine?.id === "google" };
      }).filter(candidate => candidate.image.naturalWidth >= 80 && candidate.image.naturalHeight >= 80).slice(0, 12);
      analyzableImages = visualTargets.filter(candidate => candidate.url);
      performance.record("visualCandidates", analyzableImages.length);
      performance.record("visualBailouts", visualTargets.length - analyzableImages.length);
    } else if (activePolicy.scope?.images) {
      performance.record("visualBailouts", imageCards.length);
    }
    const work = await globalThis.CFWorkScheduler.runIndependent({
      semanticTask: () => globalThis.CFContentFlow.applySemanticProtection({ candidates: remoteSemanticCandidates, evaluator: semanticEvaluator, config: activePolicy.semantic, documentRef: document }),
      visualTask: () => visualTargets.length ? globalThis.CFImageDecisionPipeline.precoverAndLocalize({ mode: activePolicy.imageProtectionMode, images: visualTargets, imageMask: globalThis.CFImageMask, localize: () => visualLocalizer.locate(activePolicy.semantic, analyzableImages) }) : Promise.resolve(null),
    });
    const semantic = work.semantic;
    const visual = globalThis.CFImageFlow.withUnreadableImages(work.visual?.visual || null, visualTargets, activePolicy.imageProtectionMode);
    allCards.forEach(card => {
      const key = card.dataset.cfKey;
      const textDecision = localDecisions.get(key) || semantic.decisions.get(key) || (semantic.available ? { decision: "allow" } : { decision: "uncertain", source: "offline" });
      globalThis.CFContentPipeline.processCard({
        card,
        textDecision,
        imageCandidates: visualTargets.filter(candidate => candidate.card === card),
        visual,
        feedbackContextFor: candidate => ({ imageUrl: candidate.url, imageWidth: candidate.width, imageHeight: candidate.height, engine: engine?.id || "generic", labels: activePolicy.rules.map(rule => rule.term), policyRevision: activePolicy.revision }),
        textMask: globalThis.CFTextMask,
        imageMask: globalThis.CFImageMask,
        imageFlow: globalThis.CFImageFlow,
      });
    });
    reportCount();
    } finally {
      scanning = false;
      if (scanAgain) { scanAgain = false; requestScan(); }
    }
  }

  function requestScan() {
    if (scanning) { scanAgain = true; performance.record("scansCoalesced"); return; }
    if (queued) return;
    queued = true;
    window.setTimeout(scan, 120);
  }

  async function initialize() {
    if (!globalThis.CFEngines.detectEngine(location.href)) return;
    activePolicy = await globalThis.CFPolicy.loadPolicy();
    window.addEventListener("cf:count-change", reportCount);
    globalThis.CFContentStartup.whenDocumentRootAvailable(document, () => {
      scan();
      new MutationObserver(requestScan).observe(document.documentElement, { childList: true, subtree: true });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.policy) return;
      globalThis.CFContentCleanup.clearPageProtections(document);
      activePolicy = globalThis.CFPolicy.sanitizePolicy(changes.policy.newValue);
      reportCount();
      requestScan();
    });
  }

  initialize();
})();
