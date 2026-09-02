(function () {
  function clearImageMasks(image) {
    image.parentElement?.querySelectorAll?.(":scope > .cf-image-mask-layer").forEach(layer => layer.remove());
    if (image?.dataset) delete image.dataset.cfVisualState;
  }
  function clearImageLayers(image) { image.parentElement?.querySelectorAll?.(":scope > .cf-image-mask-layer").forEach(layer => layer.remove()); }
  function sameVisualState(image, state) { return Boolean(image?.dataset?.cfVisualState === state); }
  function setVisualState(image, state) { if (image?.dataset) image.dataset.cfVisualState = state; }
  // The overlay fades out at its edge instead of ending on a hard rectangle, so it
  // is drawn 14% past the detected box on every side. The feather then falls
  // entirely outside the detection, and the object itself stays fully covered.
  const BOX_MARGIN = 0.14;
  function clampCoordinate(value) { return Math.min(1000, Math.max(0, value)); }
  function percent(value) { return `${Math.round(value * 10) / 100}%`; }
  function boxStyle(box) {
    const marginX = box.width * BOX_MARGIN;
    const marginY = box.height * BOX_MARGIN;
    const left = clampCoordinate(box.x - marginX);
    const top = clampCoordinate(box.y - marginY);
    const right = clampCoordinate(box.x + box.width + marginX);
    const bottom = clampCoordinate(box.y + box.height + marginY);
    return { left: percent(left), top: percent(top), width: percent(right - left), height: percent(bottom - top) };
  }
  // Detection boxes are relative to the image, but the layer is hosted by the
  // image's parent, which often also holds a caption or padding. Size the layer to
  // the image itself, in percentages so it survives a resize.
  function layerGeometry(image, host) {
    const hostRect = host?.getBoundingClientRect?.();
    const imageRect = image?.getBoundingClientRect?.();
    if (!hostRect?.width || !hostRect?.height || !imageRect?.width || !imageRect?.height) return null;
    return {
      left: `${((imageRect.left - hostRect.left) / hostRect.width) * 100}%`,
      top: `${((imageRect.top - hostRect.top) / hostRect.height) * 100}%`,
      width: `${(imageRect.width / hostRect.width) * 100}%`,
      height: `${(imageRect.height / hostRect.height) * 100}%`,
      right: "auto",
      bottom: "auto",
    };
  }
  function createLayer(image, host) {
    const layer = document.createElement("div");
    layer.className = "cf-image-mask-layer";
    const geometry = layerGeometry(image, host);
    if (geometry) Object.assign(layer.style, geometry);
    return layer;
  }
  function feedbackInput(image, context, kind, box) {
    return {
      kind,
      imageUrl: context?.imageUrl || image.currentSrc || image.src,
      labels: context?.labels || [],
      policyRevision: context?.policyRevision || "",
      imageWidth: context?.imageWidth || image.naturalWidth,
      imageHeight: context?.imageHeight || image.naturalHeight,
      engine: context?.engine || "unknown",
      visualOutcome: context?.visualOutcome || "unknown",
      box,
    };
  }
  function bindMissFeedback(image, context) {
    if (!image || image.dataset?.cfFeedbackBound) { if (image) image.__cfFeedbackContext = context; return; }
    image.__cfFeedbackContext = context;
    if (image.dataset) image.dataset.cfFeedbackBound = "1";
    image.addEventListener?.("click", event => {
      if (!event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      globalThis.CFVisualFeedback?.record?.(feedbackInput(image, image.__cfFeedbackContext, "missed_object"));
    }, true);
  }
  function applyBoxes(image, boxes, context) {
    const signature = `boxes:${context?.policyRevision || ""}:${JSON.stringify((boxes || []).map(box => [box.x, box.y, box.width, box.height, box.label]))}`;
    if (sameVisualState(image, signature)) return boxes?.length || 0;
    clearImageLayers(image);
    setVisualState(image, signature);
    if (!boxes?.length || !image.parentElement) return 0;
    bindMissFeedback(image, context);
    const host = image.parentElement;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const layer = createLayer(image, host);
    boxes.forEach(box => {
      const mask = document.createElement("button");
      mask.type = "button"; mask.className = "cf-object-mask"; mask.title = `Filtered ${box.label} — select to reveal`;
      Object.assign(mask.style, boxStyle(box));
      mask.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) globalThis.CFVisualFeedback?.record?.(feedbackInput(image, context, "false_positive", box)); mask.remove(); if (typeof globalThis.dispatchEvent === "function") globalThis.dispatchEvent(new Event("cf:count-change")); });
      layer.appendChild(mask);
    });
    host.appendChild(layer);
    return boxes.length;
  }
  function applyReviewCover(image, reason = "Visual review unavailable") {
    const signature = `review:${reason}`;
    if (sameVisualState(image, signature)) return true;
    clearImageLayers(image);
    setVisualState(image, signature);
    if (!image?.parentElement) return false;
    const host = image.parentElement;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const layer = createLayer(image, host);
    const cover = document.createElement("button");
    cover.type = "button";
    cover.className = "cf-image-review-cover";
    // The reason is a tooltip rather than text painted across the result: the state
    // reads as a plain blur, and the explanation stays available on hover and to a
    // screen reader.
    cover.title = `${reason} — select to show image`;
    cover.setAttribute?.("aria-label", `${reason} — select to show image`);
    cover.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); layer.remove(); if (typeof globalThis.dispatchEvent === "function") globalThis.dispatchEvent(new Event("cf:count-change")); });
    layer.appendChild(cover);
    host.appendChild(layer);
    return true;
  }
  function applyPendingCover(image) {
    const signature = "pending";
    if (sameVisualState(image, signature)) return true;
    clearImageLayers(image);
    setVisualState(image, signature);
    if (!image?.parentElement) return false;
    const host = image.parentElement;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const layer = createLayer(image, host);
    const cover = document.createElement("div");
    cover.className = "cf-image-pending-cover";
    cover.title = "Checking image…";
    layer.appendChild(cover);
    host.appendChild(layer);
    return true;
  }
  globalThis.CFImageMask = Object.freeze({ applyBoxes, applyReviewCover, applyPendingCover, bindMissFeedback, clearImageMasks, boxStyle });
})();
