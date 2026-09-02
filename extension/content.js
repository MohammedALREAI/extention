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

  const MAX_VISUAL_CANDIDATES = 16;
  // Google's video thumbnails are about 168×94 and knowledge-panel collage tiles are
  // smaller than 80 on one axis, so an 80px floor skipped exactly the images a reader
  // sees most of.
  const MIN_VISUAL_IMAGE_EDGE = 64;
  let observer = null;
  let orphaned = false;
  let lastUrl = location.href;

  // The extension was reloaded or updated underneath this tab. Nothing here can talk
  // to it any more, so stop observing the page rather than throwing on every scan.
  function shutdown() {
    orphaned = true;
    observer?.disconnect();
    observer = null;
  }

  function reportCount() {
    globalThis.CFContentStartup.safeExtensionCall(() => chrome.runtime.sendMessage({ type: "CF_PROTECTION_COUNT", count: globalThis.CFContentCount.countProtected(document) }));
  }

  // An image whose check could not complete is left visible rather than covered, so
  // the only place that can report it is the toolbar popup. Without this the failure
  // would be indistinguishable from "nothing matched".
  function reportVisualStatus(failed, checked, reason) {
    globalThis.CFContentStartup.safeExtensionCall(() => chrome.storage?.local?.set?.({ cfVisualStatus: { failed, checked, reason: reason || null, at: Date.now() } }));
  }

  // Keyed on a digest, not the text: the semantic API bounds result ids at 80
  // characters, and a raw result key is far longer than that. A truncated id came
  // back unmatched, leaving the card with no decision — which reads as "allow".
  function resultKey(text) {
    return `${activePolicy.revision}:txt:${globalThis.CFContent.digest(String(text || "").slice(0, 3200))}`;
  }

  async function scan() {
    queued = false;
    if (orphaned) return;
    if (!globalThis.CFContentStartup.extensionAlive()) { shutdown(); return; }
    if (scanning) { scanAgain = true; performance.record("scansCoalesced"); return; }
    // A single-page app can change route without reloading, which would otherwise keep
    // the decisions taken for the previous page.
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      globalThis.CFContentCleanup.clearPageProtections(document);
      if (!globalThis.CFEngines.detectEngine(location.href)) { reportCount(); return; }
    }
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
      // A knowledge panel, video shelf or image pack is not a text result card, so its
      // images never reached this list. They are swept in with no owning card.
      globalThis.CFEngines.imageRegionsForDocument(document, location.href).regions.forEach(region =>
        Array.from(region.querySelectorAll("img")).forEach(image => { if (!imageOwners.has(image)) imageOwners.set(image, null); }));
      const sized = Array.from(imageOwners.entries()).map(([image, card]) => {
        if (!image.complete) image.addEventListener("load", requestScan, { once: true });
        const source = globalThis.CFImageSource.visualSource(image);
        return { card, image, source, url: source.url, dataUrl: source.dataUrl, context: globalThis.CFImageContext.describeImage(image, card), width: image.naturalWidth, height: image.naturalHeight, precision: engine?.id === "google" };
      }).filter(candidate => candidate.width >= MIN_VISUAL_IMAGE_EDGE && candidate.height >= MIN_VISUAL_IMAGE_EDGE);
      // Off-screen images must not spend the page's check budget. The scheduler's
      // callback re-runs the scan as they scroll into view, so the rest of a long page
      // is covered progressively rather than never.
      visibility.track(sized.map(candidate => candidate.image));
      const onScreen = new Set(visibility.eligible(sized.map(candidate => candidate.image)));
      performance.record("visualDeferred", sized.length - onScreen.size);
      visualTargets = sized.filter(candidate => onScreen.has(candidate.image))
        // The page can hold more images than one check budget covers, so the largest —
        // the ones a reader actually looks at — are protected first.
        .sort((a, b) => (b.width * b.height) - (a.width * a.height))
        .slice(0, MAX_VISUAL_CANDIDATES)
        .map((candidate, index) => ({ ...candidate, key: globalThis.CFImageSource.sourceKey(activePolicy.revision, candidate.source, index) }));
      analyzableImages = visualTargets.filter(candidate => candidate.url || candidate.dataUrl);
      performance.record("visualCandidates", analyzableImages.length);
      performance.record("visualBailouts", visualTargets.length - analyzableImages.length);
    } else if (activePolicy.scope?.images) {
      performance.record("visualBailouts", imageCards.length);
    }
    const work = await globalThis.CFWorkScheduler.runIndependent({
      semanticTask: () => globalThis.CFContentFlow.applySemanticProtection({ candidates: remoteSemanticCandidates, evaluator: semanticEvaluator, config: activePolicy.semantic, documentRef: document }),
      visualTask: () => visualTargets.length ? globalThis.CFImageDecisionPipeline.precoverAndLocalize({ mode: activePolicy.imageProtectionMode, images: visualTargets, imageMask: globalThis.CFImageMask, localize: () => visualLocalizer.locate(activePolicy.semantic, analyzableImages) }) : Promise.resolve(null),
    });
    const semantic = work.semantic || { decisions: new Map(), available: false };
    const visual = work.visual?.visual || null;
    const feedbackContextFor = candidate => ({ imageUrl: candidate.url, imageWidth: candidate.width, imageHeight: candidate.height, engine: engine?.id || "generic", labels: activePolicy.rules.map(rule => rule.term), policyRevision: activePolicy.revision, blurIntensity: activePolicy.blurIntensity });
    let incompleteChecks = 0;
    allCards.forEach(card => {
      const key = card.dataset.cfKey;
      const textDecision = localDecisions.get(key) || semantic.decisions.get(key) || (semantic.available ? { decision: "allow" } : { decision: "uncertain", source: "offline" });
      const outcome = globalThis.CFContentPipeline.processCard({
        card,
        textDecision,
        imageCandidates: visualTargets.filter(candidate => candidate.card === card),
        visual,
        feedbackContextFor,
        textMask: globalThis.CFTextMask,
        imageMask: globalThis.CFImageMask,
        imageFlow: globalThis.CFImageFlow,
      });
      incompleteChecks += outcome.imageResult.failed;
    });
    // Images swept from a knowledge panel or video shelf have no owning card, so their
    // outcomes are applied here rather than being dropped.
    const looseImages = visualTargets.filter(candidate => !visibleCards.has(candidate.card));
    if (visual && looseImages.length) {
      incompleteChecks += globalThis.CFImageFlow.applyVisualOutcomes({ images: looseImages, visual, feedbackContextFor, imageMask: globalThis.CFImageMask }).failed;
    }
    reportVisualStatus(incompleteChecks, visualTargets.length, visual?.reason);
    reportCount();
    } finally {
      scanning = false;
      if (scanAgain) { scanAgain = false; requestScan(); }
    }
  }

  function requestScan() {
    if (orphaned) return;
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
      observer = new MutationObserver(requestScan);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
    // A reflow can move an image inside its host, leaving its patch behind. Rescanning
    // re-measures the overlay geometry against the new layout.
    window.addEventListener("resize", requestScan, { passive: true });
    window.addEventListener("popstate", requestScan);
    globalThis.CFContentStartup.safeExtensionCall(() => chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.policy) return;
      globalThis.CFContentCleanup.clearPageProtections(document);
      activePolicy = globalThis.CFPolicy.sanitizePolicy(changes.policy.newValue);
      reportCount();
      requestScan();
    }));
  }

  initialize();
})();
