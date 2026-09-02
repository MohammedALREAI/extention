import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await import("./requestControl.js");
  await import("./workScheduler.js");
  await import("./performanceMetrics.js");
  await import("./visibilityScheduler.js");
  await import("./policy.js");
  await import("./engines.js");
  await import("./imageSource.js");
  await import("./contentHelpers.js");
  await import("./contentRuntime.js");
  await import("./contentStartup.js");
  await import("./semanticClient.js");
  await import("./visualClient.js");
  await import("./contentFlow.js");
  await import("./textMask.js");
  await import("./feedback.js");
  await import("./imageMask.js");
  await import("./strictImageFlow.js");
  await import("./imageDecisionPipeline.js");
  await import("./imageFlow.js");
  await import("./contentPipeline.js");
  await import("./badge.js");
  await import("./badgeService.js");
  await import("./contentCount.js");
  await import("./contentCleanup.js");
  await import("./badgeHandlers.js");
});

describe("extension engine registry", () => {
  it("detects supported engines and a generic search fallback", () => {
    expect(globalThis.CFEngines.detectEngine("https://www.google.com/search?q=privacy").id).toBe("google");
    expect(globalThis.CFEngines.detectEngine("https://search.brave.com/search?q=privacy").id).toBe("brave");
    expect(globalThis.CFEngines.detectEngine("https://search.example.test/results?query=privacy").id).toBe("generic");
    expect(globalThis.CFEngines.detectEngine("https://example.test/article")).toBeNull();
  });
});

describe("Google image source selection", () => {
  it("prefers the largest HTTPS srcset candidate over a low-resolution thumbnail", () => {
    const image = {
      currentSrc: "https://thumb.example/cat-320.jpg",
      src: "https://thumb.example/cat-320.jpg",
      getAttribute: name => name === "srcset" ? "https://thumb.example/cat-320.jpg 320w, https://source.example/cat-1600.jpg 1600w" : "",
    };
    expect(globalThis.CFImageSource.bestVisualUrl(image)).toBe("https://source.example/cat-1600.jpg");
  });

  it("keys a real Google thumbnail within the API id bound and stays stable per source", () => {
    const url = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_a_very_long_google_thumbnail_reference_value_that_exceeds_any_id_bound&s";
    const image = { currentSrc: url, src: url, getAttribute: () => "" };
    const source = globalThis.CFImageSource.visualSource(image);
    const key = globalThis.CFImageSource.sourceKey("1787822574723", source, 0);
    expect(source.url).toBe(url);
    expect(key.length).toBeLessThanOrEqual(120);
    expect(globalThis.CFImageSource.sourceKey("1787822574723", source, 4)).toBe(key);
    expect(globalThis.CFImageSource.sourceKey("1787822574723", { url: `${url}#other` }, 0)).not.toBe(key);
  });

  it("sends an inline base64 thumbnail as image data when the page provides no URL", () => {
    const inline = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";
    const source = globalThis.CFImageSource.visualSource({ currentSrc: inline, src: inline, getAttribute: () => "" });
    expect(source).toMatchObject({ url: "", inline, dataUrl: inline });
    expect(globalThis.CFImageSource.sourceKey("rev", source, 2)).toMatch(/^rev:img:[0-9a-f]{8}$/);
  });

  it("re-encodes an oversized inline thumbnail through a canvas before sending it", () => {
    const oversized = `data:image/png;base64,${"A".repeat(globalThis.CFImageSource.MAX_INLINE_LENGTH)}`;
    const drawn = [];
    const documentRef = { createElement: () => ({ getContext: () => ({ drawImage: (_image, ...box) => drawn.push(box) }), toDataURL: () => "data:image/jpeg;base64,SMALL" }) };
    const source = globalThis.CFImageSource.visualSource({ currentSrc: oversized, src: oversized, naturalWidth: 1024, naturalHeight: 768, getAttribute: () => "" }, documentRef);
    expect(source.dataUrl).toBe("data:image/jpeg;base64,SMALL");
    expect(drawn).toEqual([[0, 0, 512, 384]]);
  });

  it("reports no source when the pixels cannot be read back", () => {
    const oversized = `data:image/png;base64,${"A".repeat(globalThis.CFImageSource.MAX_INLINE_LENGTH)}`;
    const documentRef = { createElement: () => ({ getContext: () => ({ drawImage: () => undefined }), toDataURL: () => { throw new Error("tainted canvas"); } }) };
    const source = globalThis.CFImageSource.visualSource({ currentSrc: oversized, src: oversized, naturalWidth: 400, naturalHeight: 400, getAttribute: () => "" }, documentRef);
    expect(source.dataUrl).toBe("");
  });
});

describe("Strict image protection mode", () => {
  it("defaults to Strict and allows Fast only as an explicit policy option", () => {
    expect(globalThis.CFPolicy.defaultPolicy().imageProtectionMode).toBe("strict");
    expect(globalThis.CFPolicy.sanitizePolicy({ imageProtectionMode: "fast" }).imageProtectionMode).toBe("fast");
    expect(globalThis.CFPolicy.sanitizePolicy({ imageProtectionMode: "anything" }).imageProtectionMode).toBe("strict");
  });

  it("pre-covers images only in Strict mode before visual localization", () => {
    const covered = [];
    const images = [{ image: { id: "cat" } }, { image: { id: "dog" } }];
    const imageMask = { applyPendingCover: image => { covered.push(image.id); return true; } };
    expect(globalThis.CFStrictImageFlow.precoverCandidates("strict", images, imageMask)).toBe(2);
    expect(covered).toEqual(["cat", "dog"]);
    covered.length = 0;
    expect(globalThis.CFStrictImageFlow.precoverCandidates("fast", images, imageMask)).toBe(0);
    expect(covered).toEqual([]);
  });

  it("resolves each Strict pending cover into target blur, no overlay, or image-only Review", () => {
    const previousDocument = globalThis.document;
    const previousStyle = globalThis.getComputedStyle;
    const makeHost = () => {
      const layers = [];
      return { style: {}, layers, querySelectorAll: selector => selector === ":scope > .cf-image-mask-layer" ? layers : [], appendChild(layer) { layers.push(layer); layer.parentElement = this; } };
    };
    const element = () => ({ type: "", className: "", title: "", textContent: "", style: {}, dataset: {}, children: [], addEventListener: () => undefined, appendChild(node) { this.children.push(node); node.parentElement = this; }, remove() { const layers = this.parentElement?.layers; if (layers) layers.splice(layers.indexOf(this), 1); } });
    globalThis.document = { createElement: element };
    globalThis.getComputedStyle = () => ({ position: "static" });
    const catHost = makeHost(); const dogHost = makeHost(); const failedHost = makeHost();
    const imageFor = (parentElement, id) => ({ parentElement, dataset: {}, addEventListener: () => undefined, src: `https://example.test/${id}.jpg` });
    const cat = imageFor(catHost, "cat"); const dog = imageFor(dogHost, "dog"); const failed = imageFor(failedHost, "failed");
    const images = [{ key: "cat", image: cat }, { key: "dog", image: dog }, { key: "failed", image: failed }];
    expect(globalThis.CFStrictImageFlow.precoverCandidates("strict", images, globalThis.CFImageMask)).toBe(3);
    expect([catHost, dogHost, failedHost].every(host => host.layers[0].children[0].className === "cf-image-pending-cover")).toBe(true);
    globalThis.CFImageFlow.applyVisualOutcomes({
      images,
      visual: { detections: new Map([["cat", [{ x: 100, y: 150, width: 300, height: 350, label: "cat", confidence: 0.96 }]], ["dog", []]]), unavailableKeys: new Set(["failed"]) },
      feedbackContextFor: () => ({ labels: ["cat"] }),
      imageMask: globalThis.CFImageMask,
    });
    expect(catHost.layers[0].children[0].className).toBe("cf-object-mask");
    expect(dogHost.layers).toHaveLength(0);
    expect(failedHost.layers[0].children[0].className).toBe("cf-image-review-cover");
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousStyle;
  });

  it("uses the shared content pipeline to resolve Strict pending covers and skips them in Fast mode", async () => {
    const previousDocument = globalThis.document;
    const previousStyle = globalThis.getComputedStyle;
    const makeHost = () => { const layers = []; return { style: {}, layers, querySelectorAll: selector => selector === ":scope > .cf-image-mask-layer" ? layers : [], appendChild(layer) { layers.push(layer); layer.parentElement = this; } }; };
    const element = () => ({ type: "", className: "", title: "", textContent: "", style: {}, dataset: {}, children: [], addEventListener: () => undefined, appendChild(node) { this.children.push(node); node.parentElement = this; }, remove() { const layers = this.parentElement?.layers; if (layers) layers.splice(layers.indexOf(this), 1); } });
    globalThis.document = { createElement: element };
    globalThis.getComputedStyle = () => ({ position: "static" });
    const host = makeHost(); const image = { parentElement: host, dataset: {}, addEventListener: () => undefined, src: "https://example.test/cat.jpg" };
    const candidates = [{ key: "cat", image, url: image.src }];
    const visual = { detections: new Map([["cat", [{ x: 120, y: 120, width: 300, height: 300, label: "cat", confidence: 0.95 }]]]), unavailableKeys: new Set() };
    const strict = await globalThis.CFImageDecisionPipeline.precoverAndLocalize({ mode: "strict", images: candidates, imageMask: globalThis.CFImageMask, localize: async () => visual });
    expect(strict.precovered).toBe(1);
    expect(host.layers[0].children[0].className).toBe("cf-image-pending-cover");
    globalThis.CFContentPipeline.processCard({ card: { querySelectorAll: () => [] }, textDecision: { decision: "allow" }, imageCandidates: candidates, visual: strict.visual, feedbackContextFor: () => ({ labels: ["cat"] }), textMask: { maskText: () => 0 }, imageMask: globalThis.CFImageMask, imageFlow: globalThis.CFImageFlow });
    expect(host.layers[0].children[0].className).toBe("cf-object-mask");
    globalThis.CFImageMask.clearImageMasks(image);
    const fast = await globalThis.CFImageDecisionPipeline.precoverAndLocalize({ mode: "fast", images: candidates, imageMask: globalThis.CFImageMask, localize: async () => ({ detections: new Map([["cat", []]]), unavailableKeys: new Set() }) });
    expect(fast.precovered).toBe(0);
    expect(host.layers).toHaveLength(0);
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousStyle;
  });

  it("keeps an identical pending or object-mask layer in place instead of rebuilding the same image DOM", () => {
    const previousDocument = globalThis.document;
    const previousStyle = globalThis.getComputedStyle;
    const layers = [];
    const host = { style: {}, querySelectorAll: () => layers, appendChild(layer) { layers.push(layer); layer.parentElement = this; } };
    const element = () => ({ type: "", className: "", title: "", textContent: "", style: {}, dataset: {}, children: [], addEventListener: () => undefined, appendChild(node) { this.children.push(node); node.parentElement = this; }, remove() { const index = layers.indexOf(this); if (index >= 0) layers.splice(index, 1); } });
    globalThis.document = { createElement: element };
    globalThis.getComputedStyle = () => ({ position: "static" });
    const image = { parentElement: host, dataset: {}, src: "https://example.test/cat.jpg", addEventListener: () => undefined };
    globalThis.CFImageMask.applyPendingCover(image);
    const pendingLayer = layers[0];
    globalThis.CFImageMask.applyPendingCover(image);
    expect(layers[0]).toBe(pendingLayer);
    const boxes = [{ x: 100, y: 120, width: 240, height: 260, label: "cat" }];
    globalThis.CFImageMask.applyBoxes(image, boxes, { policyRevision: "v1" });
    const objectLayer = layers[0];
    globalThis.CFImageMask.applyBoxes(image, boxes, { policyRevision: "v1" });
    expect(layers[0]).toBe(objectLayer);
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousStyle;
  });

  it("waits safely for the document root when document_start runs before the DOM exists", () => {
    let listener; let calls = 0;
    const documentRef = { documentElement: null, addEventListener: (_type, callback) => { listener = callback; } };
    expect(globalThis.CFContentStartup.whenDocumentRootAvailable(documentRef, () => { calls += 1; })).toBe("waiting");
    expect(calls).toBe(0);
    documentRef.documentElement = {};
    listener();
    expect(calls).toBe(1);
  });
});

describe("visual detection feedback", () => {
  it("stores only consented local false-positive and missed-object feedback with query-free image URLs", async () => {
    const previousChrome = globalThis.chrome;
    const storage = {};
    globalThis.chrome = { storage: { local: {
      get: (keys, callback) => { const requested = Array.isArray(keys) ? keys : [keys]; callback(Object.fromEntries(requested.map(key => [key, storage[key]]))); },
      set: (values, callback) => { Object.assign(storage, values); callback?.(); },
    } } };
    await globalThis.CFVisualFeedback.setConsent(false);
    expect((await globalThis.CFVisualFeedback.record({ kind: "missed_object", imageUrl: "https://example.test/cat.jpg?tracking=1", labels: ["cat"] })).stored).toBe(false);
    await globalThis.CFVisualFeedback.setConsent(true);
    expect((await globalThis.CFVisualFeedback.record({ kind: "missed_object", imageUrl: "https://example.test/cat.jpg?tracking=1", labels: ["cat"], policyRevision: "v4", imageWidth: 1280, imageHeight: 720, engine: "google", visualOutcome: "no_match" })).stored).toBe(true);
    const events = await globalThis.CFVisualFeedback.list();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "missed_object", imageUrl: "https://example.test/cat.jpg", labels: ["cat"], policyRevision: "v4", imageWidth: 1280, imageHeight: 720, engine: "google", visualOutcome: "no_match" });
    globalThis.chrome = previousChrome;
  });
});

describe("images the localizer never saw", () => {
  it("leaves an image with no readable source visible instead of covering it", () => {
    const candidates = [
      { key: "remote", image: { id: "remote" }, url: "https://example.test/dog.jpg" },
      { key: "sent-inline", image: { id: "sent-inline" }, url: "", dataUrl: "data:image/jpeg;base64,AAAA" },
      { key: "unreadable", image: { id: "unreadable" }, url: "", dataUrl: "" },
    ];
    const reviews = [];
    const cleared = [];
    const outcome = globalThis.CFImageFlow.applyVisualOutcomes({
      images: candidates,
      visual: { detections: new Map([["remote", []], ["sent-inline", []]]), unavailableKeys: new Set() },
      feedbackContextFor: () => ({ labels: ["dog"] }),
      imageMask: { bindMissFeedback: () => undefined, applyBoxes: (image, boxes) => cleared.push([image.id, boxes.length]), applyReviewCover: (image, reason) => reviews.push([image.id, reason]) },
    });
    expect(outcome).toEqual({ matched: 0, noMatch: 3, failed: 0 });
    expect(reviews).toEqual([]);
    // Every candidate is resolved, so a Strict pending cover never stays on screen.
    expect(cleared).toEqual([["remote", 0], ["sent-inline", 0], ["unreadable", 0]]);
  });
});

describe("visual result matrix", () => {
  it("applies only matched boxes, leaves no-match images untouched, and reserves Review with retry guidance for failures", () => {
    const images = [{ key: "cat", image: { id: "cat" }, url: "https://example.test/cat.jpg" }, { key: "dog", image: { id: "dog" }, url: "https://example.test/dog.jpg" }, { key: "failed", image: { id: "failed" }, url: "https://example.test/failed.jpg" }];
    const calls = { bind: [], boxes: [], reviews: [] };
    const imageMask = {
      bindMissFeedback: (image, context) => calls.bind.push([image.id, context.labels]),
      applyBoxes: (image, boxes) => calls.boxes.push([image.id, boxes]),
      applyReviewCover: (image, reason) => calls.reviews.push([image.id, reason]),
    };
    const visual = { detections: new Map([["cat", [{ x: 200, y: 150, width: 300, height: 350, label: "cat", confidence: 0.95 }]], ["dog", []]]), unavailableKeys: new Set(["failed"]) };
    const result = globalThis.CFImageFlow.applyVisualOutcomes({ images, visual, feedbackContextFor: image => ({ labels: ["cat"], imageUrl: image.url, policyRevision: "v1" }), imageMask });
    expect(result).toEqual({ matched: 1, noMatch: 1, failed: 1 });
    expect(calls.boxes).toEqual([["cat", [expect.objectContaining({ label: "cat" })]], ["dog", []]]);
    expect(calls.reviews).toEqual([["failed", "Visual check unavailable — re-import policy and retry"]]);
    expect(calls.reviews.some(([id]) => id === "dog")).toBe(false);
  });

  it("passes every distinct target box through for a three-cat image", () => {
    const applied = [];
    globalThis.CFImageFlow.applyVisualOutcomes({
      images: [{ key: "three-cats", image: { id: "three-cats" } }],
      visual: { detections: new Map([["three-cats", [
        { x: 60, y: 100, width: 220, height: 290, label: "cat", confidence: 0.97 },
        { x: 390, y: 180, width: 205, height: 280, label: "cat", confidence: 0.94 },
        { x: 700, y: 120, width: 210, height: 300, label: "cat", confidence: 0.96 },
      ]]]), unavailableKeys: new Set() },
      feedbackContextFor: () => ({ labels: ["cat"], engine: "google" }),
      imageMask: { bindMissFeedback: () => undefined, applyBoxes: (_image, boxes) => applied.push(boxes), applyReviewCover: () => undefined },
    });
    expect(applied).toHaveLength(1);
    expect(applied[0]).toHaveLength(3);
  });

  it("labels feedback context with the real visual result for matches, no-matches, and failures", () => {
    const contexts = new Map();
    const imageMask = {
      bindMissFeedback: (image, context) => contexts.set(image.id, context.visualOutcome),
      applyBoxes: () => undefined,
      applyReviewCover: () => undefined,
    };
    globalThis.CFImageFlow.applyVisualOutcomes({
      images: [{ key: "cat", image: { id: "cat" } }, { key: "dog", image: { id: "dog" } }, { key: "failed", image: { id: "failed" } }],
      visual: { detections: new Map([["cat", [{ x: 100, y: 100, width: 300, height: 300, label: "cat", confidence: 0.95 }]], ["dog", []]]), unavailableKeys: new Set(["failed"]) },
      feedbackContextFor: () => ({ labels: ["cat"], engine: "google" }),
      imageMask,
    });
    expect(Object.fromEntries(contexts)).toEqual({ cat: "match", dog: "no_match", failed: "visual_failure" });
  });

  it("renders real targeted blur nodes for matches, no overlay for no-match, and a retry Review cover only for failures", () => {
    const previousDocument = globalThis.document;
    const previousStyle = globalThis.getComputedStyle;
    const makeHost = () => {
      const layers = [];
      return { style: {}, layers, querySelectorAll: selector => selector === ":scope > .cf-image-mask-layer" ? layers : [], appendChild: layer => layers.push(layer) };
    };
    const catHost = makeHost(); const dogHost = makeHost(); const failedHost = makeHost();
    const cat = { parentElement: catHost, dataset: {}, addEventListener: () => undefined, src: "https://example.test/cat.jpg" };
    const dog = { parentElement: dogHost, dataset: {}, addEventListener: () => undefined, src: "https://example.test/dog.jpg" };
    const failed = { parentElement: failedHost, dataset: {}, addEventListener: () => undefined, src: "https://example.test/failed.jpg" };
    globalThis.getComputedStyle = () => ({ position: "static" });
    globalThis.document = { createElement: () => ({ type: "", className: "", title: "", textContent: "", style: {}, children: [], addEventListener: () => undefined, appendChild(node) { this.children.push(node); } }) };
    globalThis.CFImageFlow.applyVisualOutcomes({
      images: [{ key: "cat", image: cat, url: cat.src }, { key: "dog", image: dog, url: dog.src }, { key: "failed", image: failed, url: failed.src }],
      visual: { detections: new Map([["cat", [{ x: 100, y: 200, width: 300, height: 400, label: "cat", confidence: 0.95 }]], ["dog", []]]), unavailableKeys: new Set(["failed"]) },
      feedbackContextFor: () => ({ labels: ["cat"], policyRevision: "v2" }),
      imageMask: globalThis.CFImageMask,
    });
    expect(catHost.layers[0].children.map(node => node.className)).toEqual(["cf-object-mask"]);
    expect(dogHost.layers).toHaveLength(0);
    expect(failedHost.layers[0].children[0]).toMatchObject({ className: "cf-image-review-cover", title: expect.stringContaining("re-import policy and retry") });
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousStyle;
  });

  it("keeps exact text masking and each image outcome isolated within one mixed cat/dog result card", () => {
    const previousDocument = globalThis.document;
    const previousStyle = globalThis.getComputedStyle;
    const previousNodeFilter = globalThis.NodeFilter;
    const layersFor = () => { const layers = []; return { style: {}, layers, querySelectorAll: selector => selector === ":scope > .cf-image-mask-layer" ? layers : [], appendChild: layer => layers.push(layer) }; };
    const catHost = layersFor(); const dogHost = layersFor(); const failedHost = layersFor();
    const mixedCard = { querySelectorAll: selector => selector === ".cf-result-guard" ? [] : [] };
    const textParent = { tagName: "SPAN", closest: () => null };
    let replacedText;
    const textNode = { nodeValue: "A cat and dog together", parentElement: textParent, replaceWith: fragment => { replacedText = fragment; } };
    const element = () => ({ type: "", className: "", title: "", textContent: "", style: {}, dataset: {}, children: [], addEventListener: () => undefined, appendChild(node) { this.children.push(node); } });
    globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
    globalThis.document = {
      createElement: element,
      createDocumentFragment: () => ({ children: [], append(node) { this.children.push(node); } }),
      createTreeWalker: (_root, _show, filter) => ({ currentNode: null, used: false, nextNode() { if (this.used || filter.acceptNode(textNode) !== 1) return false; this.used = true; this.currentNode = textNode; return true; } }),
      createTextNode: value => ({ nodeValue: value }),
    };
    globalThis.getComputedStyle = () => ({ position: "static" });
    expect(globalThis.CFTextMask.maskText(mixedCard, ["cat"])).toBe(1);
    expect(replacedText.children.map(node => node.className || node)).toEqual(["A ", "cf-inline-mask", " and dog together"]);
    const makeImage = (host, src) => ({ parentElement: host, dataset: {}, addEventListener: () => undefined, src, card: mixedCard });
    const cat = makeImage(catHost, "https://example.test/cat.jpg"); const dog = makeImage(dogHost, "https://example.test/dog.jpg"); const failed = makeImage(failedHost, "https://example.test/failed.jpg");
    globalThis.CFImageFlow.applyVisualOutcomes({
      images: [{ key: "cat", image: cat, url: cat.src }, { key: "dog", image: dog, url: dog.src }, { key: "failed", image: failed, url: failed.src }],
      visual: { detections: new Map([["cat", [{ x: 100, y: 200, width: 300, height: 400, label: "cat", confidence: 0.95 }]], ["dog", []]]), unavailableKeys: new Set(["failed"]) },
      feedbackContextFor: () => ({ labels: ["cat"], policyRevision: "mixed" }),
      imageMask: globalThis.CFImageMask,
    });
    expect(catHost.layers[0].children[0].className).toBe("cf-object-mask");
    expect(dogHost.layers).toHaveLength(0);
    expect(failedHost.layers[0].children[0]).toMatchObject({ className: "cf-image-review-cover", title: expect.stringContaining("re-import policy and retry") });
    expect(mixedCard.querySelectorAll(".cf-result-guard")).toHaveLength(0);
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousStyle;
    globalThis.NodeFilter = previousNodeFilter;
  });

  it("runs the real result-card pipeline without any card guard while isolating text, target blur, no-match, and failure Review", () => {
    const previousDocument = globalThis.document;
    const previousStyle = globalThis.getComputedStyle;
    const previousNodeFilter = globalThis.NodeFilter;
    const host = () => { const layers = []; return { style: {}, layers, querySelectorAll: selector => selector === ":scope > .cf-image-mask-layer" ? layers : [], appendChild: layer => layers.push(layer) }; };
    const catHost = host(); const dogHost = host(); const failedHost = host();
    const card = { querySelectorAll: () => [] };
    const textParent = { tagName: "SPAN", closest: () => null };
    let textFragment;
    const textNode = { nodeValue: "cat and dog article", parentElement: textParent, replaceWith: fragment => { textFragment = fragment; } };
    const element = () => ({ type: "", className: "", title: "", textContent: "", style: {}, dataset: {}, children: [], addEventListener: () => undefined, appendChild(node) { this.children.push(node); } });
    globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
    globalThis.document = {
      createElement: element,
      createDocumentFragment: () => ({ children: [], append(node) { this.children.push(node); } }),
      createTreeWalker: (_root, _show, filter) => ({ currentNode: null, consumed: false, nextNode() { if (this.consumed || filter.acceptNode(textNode) !== 1) return false; this.consumed = true; this.currentNode = textNode; return true; } }),
      createTextNode: value => ({ nodeValue: value }),
    };
    globalThis.getComputedStyle = () => ({ position: "static" });
    const imageFor = (parentElement, src) => ({ parentElement, dataset: {}, addEventListener: () => undefined, src });
    const cat = imageFor(catHost, "https://example.test/cat.jpg"); const dog = imageFor(dogHost, "https://example.test/dog.jpg"); const failed = imageFor(failedHost, "https://example.test/failed.jpg");
    const output = globalThis.CFContentPipeline.processCard({
      card,
      textDecision: { decision: "blur", matchedText: "cat" },
      imageCandidates: [{ key: "cat", image: cat, url: cat.src }, { key: "dog", image: dog, url: dog.src }, { key: "failed", image: failed, url: failed.src }],
      visual: { detections: new Map([["cat", [{ x: 100, y: 200, width: 300, height: 400, label: "cat", confidence: 0.95 }]], ["dog", []]]), unavailableKeys: new Set(["failed"]) },
      feedbackContextFor: candidate => ({ imageUrl: candidate.url, labels: ["cat"], policyRevision: "end-to-end" }),
      textMask: globalThis.CFTextMask,
      imageMask: globalThis.CFImageMask,
      imageFlow: globalThis.CFImageFlow,
    });
    expect(output).toEqual({ textMasks: 1, imageResult: { matched: 1, noMatch: 1, failed: 1 } });
    expect(textFragment.children.map(node => node.className || node)).toEqual(["cf-inline-mask", " and dog article"]);
    expect(catHost.layers[0].children[0].className).toBe("cf-object-mask");
    expect(dogHost.layers).toHaveLength(0);
    expect(failedHost.layers[0].children[0]).toMatchObject({ className: "cf-image-review-cover", title: expect.stringContaining("re-import policy and retry") });
    expect(card.querySelectorAll(".cf-result-guard")).toHaveLength(0);
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousStyle;
    globalThis.NodeFilter = previousNodeFilter;
  });
});

describe("extension icon badge", () => {
  it("formats zero, ordinary, and high protection counts for the toolbar badge", () => {
    expect(globalThis.CFBadge.badgeText(0)).toBe("");
    expect(globalThis.CFBadge.badgeText(3)).toBe("3");
    expect(globalThis.CFBadge.badgeText(120)).toBe("99+");
  });

  it("counts all protection shapes visible on the current result page", () => {
    const root = { querySelectorAll: selector => ({ ".cf-inline-mask": [1, 2], ".cf-object-mask": [3], ".cf-image-review-cover": [4], ".cf-result-guard": [5] }[selector] || []) };
    expect(globalThis.CFContentCount.countProtected(root)).toBe(5);
  });

  it("renders a badge for a content-script count and clears it on page reset", () => {
    const calls = [];
    const chromeApi = { action: { setBadgeText: value => calls.push(["text", value]), setBadgeBackgroundColor: value => calls.push(["color", value]), setTitle: value => calls.push(["title", value]) } };
    expect(globalThis.CFBadgeService.setProtectionBadge(chromeApi, 42, 3)).toBe("3");
    expect(calls).toContainEqual(["text", { tabId: 42, text: "3" }]);
    calls.length = 0;
    expect(globalThis.CFBadgeService.setProtectionBadge(chromeApi, 42, 0)).toBe("");
    expect(calls).toContainEqual(["text", { tabId: 42, text: "" }]);
  });

  it("handles page protection counts and tab loading through the service-worker listener", () => {
    let onMessage;
    let onUpdated;
    const chromeApi = { runtime: { onMessage: { addListener: listener => { onMessage = listener; } } }, tabs: { onUpdated: { addListener: listener => { onUpdated = listener; } } } };
    const counts = [];
    globalThis.CFBadgeHandlers.installBadgeHandlers(chromeApi, (tabId, count) => counts.push([tabId, count]));
    onMessage({ type: "CF_PROTECTION_COUNT", count: 4 }, { tab: { id: 9 } });
    onUpdated(9, { status: "loading" });
    expect(counts).toEqual([[9, 4], [9, 0]]);
  });

  it("clears existing masks, image covers, cards, and count when a policy is disabled", () => {
    const cards = [{ dataset: { cfKey: "policy-1" } }, { dataset: { cfKey: "policy-1" } }];
    const images = [{ id: "image-1" }];
    const root = { querySelectorAll: selector => {
      if (selector === "[data-cf-key]") return cards;
      if (selector === "img") return images;
      if (selector.includes(".cf-inline-mask")) return [1, 2, 3];
      return [];
    } };
    const calls = { masks: 0, images: 0, cards: 0 };
    expect(globalThis.CFContentCleanup.clearPageProtections(root, {
      clearMasks: () => { calls.masks += 1; },
      clearImageMasks: () => { calls.images += 1; },
      clearCard: () => { calls.cards += 1; },
    })).toBe(3);
    expect(calls).toEqual({ masks: 1, images: 1, cards: 2 });
    expect(cards.every(card => card.dataset.cfKey === undefined)).toBe(true);
  });
});

describe("multilingual policy matching", () => {
  it("preserves and matches Arabic and Japanese rule text without translation", () => {
    const policy = {
      ...globalThis.CFPolicy.defaultPolicy(),
      rules: [{ term: "قمار", action: "block" }, { term: "ギャンブル", action: "warn" }],
    };
    expect(globalThis.CFPolicy.evaluateText("دليل عن قمار", policy).decision).toBe("block");
    expect(globalThis.CFPolicy.evaluateText("ギャンブル の ニュース", policy).decision).toBe("warn");
  });

  it("leaves a cross-language result for the semantic evaluator instead of a fixed alias dictionary", () => {
    const policy = {
      ...globalThis.CFPolicy.defaultPolicy(),
      rules: [{ term: "كلب", action: "blur" }],
    };
    const result = globalThis.CFPolicy.evaluateText("Cat-and-Dog (2024): two pets escape together", policy);
    expect(result.decision).toBe("allow");
    expect(result.matchedRules).toEqual([]);
  });

  it("recognizes the Google result-card adapter and leaves semantic equivalence to the server", () => {
    const card = {
      nodeType: 1,
      textContent: "Cat-and-Dog (2024) dog movie",
      querySelector: selector => selector === "a[href]" ? { href: "https://imdb.example/cat-and-dog" } : null,
      querySelectorAll: () => [{ textContent: "Cat-and-Dog", href: "https://imdb.example/cat-and-dog" }],
    };
    const documentRef = { querySelectorAll: selector => selector === "div.MjjYud" ? [card] : [] };
    const discovery = globalThis.CFEngines.cardsForDocument(documentRef, "https://www.google.com/search?q=cat+and+dog");
    expect(discovery.engine.id).toBe("google");
    expect(discovery.cards).toEqual([card]);
    expect(globalThis.CFPolicy.evaluateText(globalThis.CFEngines.extractResultText(card), { rules: [{ term: "كلب", action: "blur" }] }).decision).toBe("allow");
  });

  it("extracts a title, visible copy, and destination URL without translating any script", () => {
    const fakeCard = {
      textContent: "دليل حماية للمستخدمين",
      querySelector: () => ({ textContent: "ギャンブル safety guide" }),
      querySelectorAll: () => [{ textContent: "اقرأ", href: "https://example.test/قمار" }],
    };
    expect(globalThis.CFEngines.extractResultText(fakeCard)).toContain("ギャンブル safety guide");
    expect(globalThis.CFEngines.extractResultText(fakeCard)).toContain("https://example.test/قمار");
  });
});

describe("targeted content masking", () => {
  it("masks only the matching word and leaves surrounding cat text visible", () => {
    const segments = globalThis.CFTextMask.splitTextForMask("Cats remain visible, but dog content is hidden.", ["dog"]);
    expect(segments).toEqual([
      { type: "text", value: "Cats remain visible, but " },
      { type: "mask", value: "dog" },
      { type: "text", value: " content is hidden." },
    ]);
  });

  it("maps only the detected dog rectangle to the image overlay, with a feather margin around it", () => {
    // 14% of the box on each side: the soft edge falls outside the detection, so the
    // detected object stays under the fully opaque core.
    expect(globalThis.CFImageMask.boxStyle({ x: 521, y: 252, width: 254, height: 576 })).toEqual({ left: "48.54%", top: "17.14%", width: "32.51%", height: "73.73%" });
    // A detection touching the image edge stays inside the image instead of overflowing it.
    expect(globalThis.CFImageMask.boxStyle({ x: 0, y: 400, width: 300, height: 600 })).toEqual({ left: "0%", top: "31.6%", width: "34.2%", height: "68.4%" });
  });

  it("replaces only the matching word in a mock result text node with a reversible inline mask", () => {
    const previousDocument = globalThis.document;
    const previousNodeFilter = globalThis.NodeFilter;
    const replaced = [];
    const revealed = [];
    let maskNode;
    const textNode = { nodeValue: "Cats remain visible, but dog content is hidden.", parentElement: { tagName: "SPAN", closest: () => null }, replaceWith: value => replaced.push(value) };
    const fragment = { children: [], append(value) { this.children.push(value); } };
    globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
    globalThis.document = {
      createTreeWalker: () => ({ currentNode: textNode, nextNode: (() => { let used = false; return () => used ? false : (used = true); })() }),
      createDocumentFragment: () => fragment,
      createElement: () => {
        maskNode = { className: "", dataset: {}, addEventListener: (_type, handler) => { maskNode.click = handler; }, replaceWith: value => revealed.push(value) };
        return maskNode;
      },
      createTextNode: value => ({ text: value }),
    };
    const root = { querySelectorAll: () => [] };
    expect(globalThis.CFTextMask.maskText(root, ["dog"])).toBe(1);
    expect(replaced).toHaveLength(1);
    expect(fragment.children.map(part => typeof part === "string" ? part : part.text || part.textContent)).toEqual(["Cats remain visible, but ", "dog", " content is hidden."]);
    maskNode.click({ preventDefault: () => undefined, stopPropagation: () => undefined });
    expect(revealed).toEqual([{ text: "dog" }]);
    globalThis.document = previousDocument;
    globalThis.NodeFilter = previousNodeFilter;
  });

  it("applies one overlay for a detected dog box in a mixed-image container", () => {
    const previousDocument = globalThis.document;
    const previousStyle = globalThis.getComputedStyle;
    const layer = { className: "", children: [], appendChild(node) { this.children.push(node); } };
    const host = { style: {}, querySelectorAll: () => [], appendChild: node => { layer.attached = node; } };
    globalThis.getComputedStyle = () => ({ position: "static" });
    globalThis.document = { createElement: tag => tag === "div" ? layer : { type: "", className: "", title: "", style: {}, addEventListener: () => undefined } };
    const image = { parentElement: host };
    expect(globalThis.CFImageMask.applyBoxes(image, [{ x: 521, y: 252, width: 254, height: 576, label: "dog" }])).toBe(1);
    expect(layer.children).toHaveLength(1);
    expect(layer.children[0].style).toMatchObject({ left: "48.54%", top: "17.14%", width: "32.51%", height: "73.73%" });
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousStyle;
  });

  it("covers only the cat region in a mixed Google image result when the policy targets cats", () => {
    const previousDocument = globalThis.document;
    const previousStyle = globalThis.getComputedStyle;
    const layer = { className: "", children: [], appendChild(node) { this.children.push(node); } };
    const host = { style: {}, querySelectorAll: () => [], appendChild: node => { layer.attached = node; } };
    const image = { src: "https://images.example.test/cat-and-dog.jpg", naturalWidth: 640, naturalHeight: 420, parentElement: host };
    const googleCard = { nodeType: 1, textContent: "Cats and dogs together", querySelector: selector => selector === "a[href]" ? { href: "https://example.test/cats-and-dogs" } : null, querySelectorAll: selector => selector === "img[src]" ? [image] : [{ textContent: "Cats and dogs", href: "https://example.test/cats-and-dogs" }] };
    const googleDocument = { querySelectorAll: selector => selector === "div.MjjYud" ? [googleCard] : [] };
    globalThis.getComputedStyle = () => ({ position: "static" });
    globalThis.document = { createElement: tag => tag === "div" ? layer : { type: "", className: "", title: "", style: {}, addEventListener: () => undefined } };
    expect(globalThis.CFEngines.cardsForDocument(googleDocument, "https://www.google.com/search?q=cats").cards).toEqual([googleCard]);
    globalThis.CFImageMask.applyBoxes(image, [{ x: 281, y: 472, width: 274, height: 376, label: "cat" }]);
    expect(layer.children).toHaveLength(1);
    expect(layer.children[0].style).toMatchObject({ left: "24.26%", top: "41.94%", width: "35.07%", height: "48.13%" });
    expect(layer.children.some(mask => mask.style.left === "48.54%")).toBe(false);
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousStyle;
  });

  it("protects the image with a review cover when visual localization is unavailable", () => {
    const previousDocument = globalThis.document;
    const previousStyle = globalThis.getComputedStyle;
    const layer = { className: "", children: [], appendChild(node) { this.children.push(node); } };
    const host = { style: {}, querySelectorAll: () => [], appendChild: node => { layer.attached = node; } };
    globalThis.getComputedStyle = () => ({ position: "static" });
    globalThis.document = { createElement: tag => tag === "div" ? layer : { type: "", className: "", textContent: "", addEventListener: () => undefined } };
    expect(globalThis.CFImageMask.applyReviewCover({ parentElement: host }, "Visual check unavailable — refresh policy")).toBe(true);
    expect(layer.children).toHaveLength(1);
    expect(layer.children[0].className).toBe("cf-image-review-cover");
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousStyle;
  });

  it("distinguishes unavailable visual access from a confident image no-match", async () => {
    const expired = globalThis.CFVisual.createVisualLocalizer(async () => { throw new Error("should not run"); });
    const expiredResult = await expired.locate({ endpoint: "https://example.test", token: "old", expiresAt: Date.now() - 1 }, [{ key: "image-1", url: "https://example.test/dog.jpg" }]);
    expect(expiredResult).toMatchObject({ state: "unavailable", reason: "policy_access" });
    const offline = globalThis.CFVisual.createVisualLocalizer(async () => { throw new Error("offline"); });
    const offlineResult = await offline.locate({ endpoint: "https://example.test", token: "live", expiresAt: Date.now() + 1_000 }, [{ key: "image-1", url: "https://example.test/dog.jpg" }]);
    expect(offlineResult).toMatchObject({ state: "unavailable", reason: "service_unavailable" });
    const noMatch = globalThis.CFVisual.createVisualLocalizer(async (_url, options) => ({ ok: true, json: async () => JSON.parse(options.body).images.map(image => ({ id: image.id, boxes: [] })) }));
    const noMatchResult = await noMatch.locate({ endpoint: "https://example.test", token: "live", expiresAt: Date.now() + 1_000 }, [{ key: "image-1", url: "https://example.test/dog.jpg" }]);
    expect(noMatchResult.state).toBe("ready");
    expect(noMatchResult.detections.get("image-1")).toEqual([]);
  });

  it("treats an image the response never answered for as unavailable, never as a no-match", async () => {
    const localizer = globalThis.CFVisual.createVisualLocalizer(async (_url, options) => {
      const [first] = JSON.parse(options.body).images;
      // A response that answers under a different id — the failure mode a bounded
      // server-side id would reintroduce — must not read as "nothing matched".
      return { ok: true, json: async () => [{ id: `${first.id}-truncated`, boxes: [] }] };
    });
    const result = await localizer.locate({ endpoint: "https://example.test", token: "live", expiresAt: Date.now() + 1_000 }, [{ key: "policy:img:9fa31c07", url: "https://example.test/dog.jpg" }]);
    expect(result.state).toBe("unavailable");
    expect(result.unavailableKeys.has("policy:img:9fa31c07")).toBe(true);
    expect(result.detections.has("policy:img:9fa31c07")).toBe(false);
  });

  it("sends visual candidates in smaller bounded batches with loaded dimensions", async () => {
    const requests = [];
    const localizer = globalThis.CFVisual.createVisualLocalizer(async (_url, options) => {
      requests.push(JSON.parse(options.body).images);
      return { ok: true, json: async () => JSON.parse(options.body).images.map(image => ({ id: image.id, boxes: [] })) };
    });
    const images = Array.from({ length: 8 }, (_, index) => ({ key: `image-${index}`, url: `https://example.test/${index}.jpg`, width: 800, height: 600 }));
    expect((await localizer.locate({ endpoint: "https://example.test", token: "live", expiresAt: Date.now() + 1_000 }, images)).state).toBe("ready");
    expect(requests.map(batch => batch.length)).toEqual([3, 3, 2]);
    expect(requests[0][0]).toMatchObject({ width: 800, height: 600 });
  });

  it("joins concurrent visual localization calls for the same image instead of sending a duplicate request", async () => {
    let release;
    let requests = 0;
    const localizer = globalThis.CFVisual.createVisualLocalizer(() => new Promise(resolve => { requests += 1; release = resolve; }));
    const config = { endpoint: "https://example.test", token: "live", expiresAt: Date.now() + 1_000 };
    const images = [{ key: "shared", url: "https://example.test/cat.jpg", precision: true }];
    const first = localizer.locate(config, images);
    const second = localizer.locate(config, images);
    expect(requests).toBe(1);
    release({ ok: true, json: async () => [{ id: "shared", boxes: [] }] });
    await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ state: "ready" }), expect.objectContaining({ state: "ready" })]);
  });

  it("analyzes precision Google image candidates one at a time", async () => {
    const requests = [];
    const localizer = globalThis.CFVisual.createVisualLocalizer(async (_url, options) => {
      const payload = JSON.parse(options.body);
      requests.push(payload.images);
      return { ok: true, json: async () => payload.images.map(image => ({ id: image.id, boxes: [] })) };
    });
    const images = Array.from({ length: 3 }, (_, index) => ({ key: `google-${index}`, url: `https://images.example/${index}.jpg`, precision: true }));
    expect((await localizer.locate({ endpoint: "https://example.test", token: "live", expiresAt: Date.now() + 1_000 }, images)).state).toBe("ready");
    expect(requests.map(batch => batch.length)).toEqual([1, 1, 1]);
  });

  it("keeps Google precision candidates isolated while retaining small batches for ordinary images", async () => {
    const requests = [];
    const localizer = globalThis.CFVisual.createVisualLocalizer(async (_url, options) => {
      const payload = JSON.parse(options.body);
      requests.push(payload.images);
      return { ok: true, json: async () => payload.images.map(image => ({ id: image.id, boxes: [] })) };
    });
    const images = [{ key: "google", url: "https://images.example/google.jpg", precision: true }, ...Array.from({ length: 4 }, (_, index) => ({ key: `standard-${index}`, url: `https://images.example/${index}.jpg` }))];
    await localizer.locate({ endpoint: "https://example.test", token: "live", expiresAt: Date.now() + 1_000 }, images);
    expect(requests.map(batch => batch.length)).toEqual([1, 3, 1]);
    expect(requests[0][0].id).toBe("google");
  });

  it("turns an image-level visual unavailability response into Review rather than a no-match", async () => {
    const localizer = globalThis.CFVisual.createVisualLocalizer(async (_url, options) => {
      const image = JSON.parse(options.body).images[0];
      return { ok: true, json: async () => [{ id: image.id, status: "unavailable", boxes: [] }] };
    });
    const result = await localizer.locate({ endpoint: "https://example.test", token: "live", expiresAt: Date.now() + 1_000 }, [{ key: "blocked", url: "https://images.example/blocked.jpg", precision: true }]);
    expect(result).toMatchObject({ state: "unavailable", reason: "service_unavailable" });
    expect(result.unavailableKeys).toEqual(new Set(["blocked"]));
  });

  it("retains localized boxes from a successful batch when a different image batch is unavailable", async () => {
    let call = 0;
    const localizer = globalThis.CFVisual.createVisualLocalizer(async (_url, options) => {
      call += 1;
      if (call === 1) throw new Error("network unavailable");
      return { ok: true, json: async () => JSON.parse(options.body).images.map(image => ({ id: image.id, boxes: [{ x: 200, y: 200, width: 300, height: 300, label: "cat", confidence: 0.94 }] })) };
    });
    const images = Array.from({ length: 7 }, (_, index) => ({ key: `image-${index}`, url: `https://example.test/${index}.jpg` }));
    const result = await localizer.locate({ endpoint: "https://example.test", token: "live", expiresAt: Date.now() + 1_000 }, images);
    expect(result.state).toBe("partial");
    expect(result.unavailableKeys.size).toBe(3);
    expect(result.detections.get("image-6")).toHaveLength(1);
  });
});

describe("reversible result-card protection", () => {
  it("keeps blur, block, and warn reversible while allow stays unprotected", () => {
    expect(globalThis.CFContent.decisionPresentation("blur")).toMatchObject({ className: "cf-card-blur", reversible: true });
    expect(globalThis.CFContent.decisionPresentation("block")).toMatchObject({ className: "cf-card-block", reversible: true });
    expect(globalThis.CFContent.decisionPresentation("warn")).toMatchObject({ className: "cf-card-warn", reversible: true });
    expect(globalThis.CFContent.shouldProtect("allow", "rule-1", "")).toBe(false);
    expect(globalThis.CFContent.shouldProtect("block", "rule-1", "rule-1")).toBe(false);
    expect(globalThis.CFContent.shouldProtect("block", "rule-1", "")).toBe(true);
  });

  it("adds a guard to a result card and removes it when the user selects Show result", () => {
    const classes = new Set();
    let guard = null;
    let clickHandler = null;
    const button = {
      addEventListener: (_type, handler) => { clickHandler = handler; },
    };
    const card = {
      dataset: {},
      classList: {
        add: (...items) => items.forEach(item => classes.add(item)),
        remove: (...items) => items.forEach(item => classes.delete(item)),
        contains: item => classes.has(item),
      },
      querySelector: () => guard,
      appendChild: node => { guard = node; },
    };
    const documentRef = {
      createElement: () => ({
        className: "",
        setAttribute: () => undefined,
        innerHTML: "",
        querySelector: () => button,
        remove: () => { guard = null; },
      }),
    };
    const decision = { decision: "block", reason: "Matched “قمار”." };

    expect(globalThis.CFContentRuntime.protectCard(card, decision, "rev-1", documentRef)).toBe(true);
    expect(card.classList.contains("cf-card-protected")).toBe(true);
    expect(card.classList.contains("cf-card-block")).toBe(true);
    expect(guard).not.toBeNull();

    clickHandler({ preventDefault: () => undefined, stopPropagation: () => undefined });
    expect(card.dataset.cfDismissed).toBe("rev-1");
    expect(card.classList.contains("cf-card-protected")).toBe(false);
    expect(guard).toBeNull();
  });
});

describe("semantic Google result flow", () => {
  function mockCard() {
    const classes = new Set();
    let guard = null;
    return {
      card: {
        dataset: {},
        classList: {
          add: (...items) => items.forEach(item => classes.add(item)),
          remove: (...items) => items.forEach(item => classes.delete(item)),
          contains: item => classes.has(item),
        },
        querySelector: () => guard,
        appendChild: node => { guard = node; },
      },
      classes,
      documentRef: {
        createElement: () => ({
          setAttribute: () => undefined,
          querySelector: () => ({ addEventListener: () => undefined }),
          remove: () => { guard = null; },
        }),
      },
    };
  }

  it("keeps only the exact matched phrase from an asynchronous semantic decision", async () => {
    const evaluator = globalThis.CFSemantic.createSemanticEvaluator(async () => ({
      ok: true,
      json: async () => [{ id: "google-dog", decision: "blur", confidence: 0.98, reason: "Semantic dog match.", matchedText: "dog" }],
    }));
    const candidate = { key: "google-dog", text: "Cat-and-Dog (2024)" };
    const semantic = await evaluator.evaluate({ endpoint: "https://example.test/api", token: "signed", expiresAt: Date.now() + 1_000 }, [candidate]);
    expect(globalThis.CFContentFlow.exactSemanticTerms(semantic.decisions.get(candidate.key))).toEqual(["dog"]);
    expect(semantic.available).toBe(true);
  });

  it("discovers a Google result card and sends only the exact semantic phrase to the text-mask callback", async () => {
    const { card, documentRef } = mockCard();
    card.nodeType = 1;
    card.textContent = "Cat-and-Dog (2024) dog movie";
    card.querySelector = selector => selector === "a[href]" ? { href: "https://imdb.example/cat-and-dog" } : null;
    card.querySelectorAll = () => [{ textContent: "Cat-and-Dog", href: "https://imdb.example/cat-and-dog" }];
    const googleDocument = { querySelectorAll: selector => selector === "div.MjjYud" ? [card] : [] };
    const discovery = globalThis.CFEngines.cardsForDocument(googleDocument, "https://www.google.com/search?q=cat+and+dog");
    const evaluator = globalThis.CFSemantic.createSemanticEvaluator(async () => ({
      ok: true,
      json: async () => [{ id: "google-flow", decision: "blur", confidence: 0.98, reason: "Semantic dog match.", matchedText: "dog" }],
    }));
    const applied = [];
    await globalThis.CFContentFlow.applySemanticProtection({
      candidates: [{ card, key: "google-flow", text: globalThis.CFEngines.extractResultText(discovery.cards[0]) }],
      evaluator,
      config: { endpoint: "https://example.test/api", token: "signed", expiresAt: Date.now() + 1_000 },
      protectCard: (_card, decision) => applied.push(decision.matchedTerms),
      documentRef,
    });
    expect(discovery.engine.id).toBe("google");
    expect(applied).toEqual([["dog"]]);
  });

  it("does not create a card cover when semantic evaluation cannot run", async () => {
    const evaluator = globalThis.CFSemantic.createSemanticEvaluator(async () => { throw new Error("offline"); });
    const candidate = { key: "needs-review", text: "Resultados sobre perros" };
    const semantic = await evaluator.evaluate({ endpoint: "https://example.test/api", token: "expired", expiresAt: Date.now() + 1_000 }, [candidate]);
    const calls = [];
    await globalThis.CFContentFlow.applySemanticProtection({ candidates: [candidate], evaluator: { evaluate: async () => semantic }, config: {}, protectCard: (...args) => calls.push(args), documentRef: {} });
    expect(semantic.available).toBe(false);
    expect(calls).toEqual([]);
  });
});
