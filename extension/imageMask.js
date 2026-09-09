(function () {
  function clearImageMasks(image) {
    image.parentElement?.querySelectorAll?.(":scope > .cf-image-mask-layer").forEach(layer => layer.remove());
    if (image?.dataset) delete image.dataset.cfVisualState;
  }
  function clearImageLayers(image) { image.parentElement?.querySelectorAll?.(":scope > .cf-image-mask-layer").forEach(layer => layer.remove()); }
  function sameVisualState(image, state) { return Boolean(image?.dataset?.cfVisualState === state); }
  function setVisualState(image, state) { if (image?.dataset) image.dataset.cfVisualState = state; }
  // The overlay fades out at its edge instead of ending on a hard rectangle, so it
  // is drawn past the detected box on every side. The margin adapts to the box area
  // relative to the image: small objects get wider margins so the feather doesn't
  // eat into the detection; large objects use tighter margins to avoid covering
  // unrelated background.
  //
  // Configurable thresholds for future A/B testing.
  const SMALL_RATIO = 0.05;
  const LARGE_RATIO = 0.25;
  const MARGIN_SMALL = 0.18;
  const MARGIN_LARGE = 0.10;
  // Edge threshold: 0.5% of the normalized 1000-unit coordinate space.
  const EDGE_THRESHOLD = 5;
  // A feather thinner than a few rendered pixels reads as a hard edge again, so the
  // margin also has a floor expressed in pixels of the real image.
  const MIN_FEATHER_PX = 6;

  // Boxes arrive in the normalized 1000×1000 space, so the fraction is already
  // relative to the image and needs no pixel dimensions of its own.
  function adaptiveMargin(box) {
    const ratio = (box.width * box.height) / 1_000_000;
    if (ratio < SMALL_RATIO) return MARGIN_SMALL;
    if (ratio > LARGE_RATIO) return MARGIN_LARGE;
    // Linear interpolation between small and large
    return MARGIN_SMALL - ((MARGIN_SMALL - MARGIN_LARGE) * (ratio - SMALL_RATIO) / (LARGE_RATIO - SMALL_RATIO));
  }

  // The real image dimensions do matter for the floor: on a 200px thumbnail a
  // fractional margin around a small box lands below one rendered pixel, so the
  // pixel floor is converted back into normalized units per axis.
  function marginUnits(box, imageWidth, imageHeight) {
    const fraction = adaptiveMargin(box);
    const floorX = imageWidth > 0 ? (MIN_FEATHER_PX / imageWidth) * 1000 : 0;
    const floorY = imageHeight > 0 ? (MIN_FEATHER_PX / imageHeight) * 1000 : 0;
    return { x: Math.max(box.width * fraction, floorX), y: Math.max(box.height * fraction, floorY) };
  }

  function sizeClassForArea(boxArea) {
    // Detection now reaches down to 0.12% of the image, and a 24px blur over a patch
    // that small is just a grey dot: the radius has to come down with it.
    if (boxArea < 12_000) return "tiny";
    if (boxArea < 50_000) return "small";
    if (boxArea > 250_000) return "large";
    return "medium";
  }

  function clampCoordinate(value) { return Math.min(1000, Math.max(0, value)); }
  function percent(value) { return `${Math.round(value * 10) / 100}%`; }

  function boxStyle(box, imageWidth = 0, imageHeight = 0) {
    const { x: marginX, y: marginY } = marginUnits(box, imageWidth, imageHeight);
    const left = clampCoordinate(box.x - marginX);
    const top = clampCoordinate(box.y - marginY);
    const right = clampCoordinate(box.x + box.width + marginX);
    const bottom = clampCoordinate(box.y + box.height + marginY);
    // Detect edges touching the image boundary (0.5% threshold)
    const edges = {
      left: box.x <= EDGE_THRESHOLD,
      top: box.y <= EDGE_THRESHOLD,
      right: box.x + box.width >= 1000 - EDGE_THRESHOLD,
      bottom: box.y + box.height >= 1000 - EDGE_THRESHOLD,
    };
    return {
      left: percent(left), top: percent(top),
      width: percent(right - left), height: percent(bottom - top),
      edges,
    };
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
  function createLayer(image, host, measured) {
    const layer = document.createElement("div");
    layer.className = "cf-image-mask-layer";
    const geometry = measured === undefined ? layerGeometry(image, host) : measured;
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
    if (!boxes?.length) {
      const signature = `boxes:${context?.policyRevision || ""}:[]`;
      if (sameVisualState(image, signature)) return 0;
      clearImageLayers(image);
      setVisualState(image, signature);
      return 0;
    }
    if (!image?.parentElement) return 0;
    const host = image.parentElement;
    // The measured geometry is part of the signature: a reflow that moves the image
    // inside its host would otherwise leave the patch behind, because an unchanged box
    // list makes this look like work already done.
    const geometry = layerGeometry(image, host);
    const signature = `boxes:${context?.policyRevision || ""}:${JSON.stringify(boxes.map(box => [box.x, box.y, box.width, box.height, box.label]))}:${geometry ? Object.values(geometry).join(",") : "auto"}`;
    if (sameVisualState(image, signature)) return boxes.length;
    clearImageLayers(image);
    setVisualState(image, signature);
    bindMissFeedback(image, context);
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const layer = createLayer(image, host, geometry);
    // Overlapping masks are isolated in CSS (.cf-image-mask-layer) so two feathered
    // edges crossing never compound into a darker seam.
    const imageWidth = image.naturalWidth || 0;
    const imageHeight = image.naturalHeight || 0;
    // User-controlled blur intensity (passed via context from policy)
    const intensity = context?.blurIntensity || "auto";
    boxes.forEach(box => {
      const mask = document.createElement("button");
      mask.type = "button"; mask.className = "cf-object-mask"; mask.title = `Filtered ${box.label} — select to reveal`;
      const { edges, ...positioning } = boxStyle(box, imageWidth, imageHeight);
      Object.assign(mask.style, positioning);
      if (mask.dataset) {
        // Size class drives the adaptive blur strength in CSS.
        mask.dataset.cfSize = sizeClassForArea(box.width * box.height);
        // An edge of the box that sits on the image boundary must not be feathered:
        // there is no background there to fade into, only the clipped object.
        if (edges.left) mask.dataset.cfEdgeLeft = "";
        if (edges.top) mask.dataset.cfEdgeTop = "";
        if (edges.right) mask.dataset.cfEdgeRight = "";
        if (edges.bottom) mask.dataset.cfEdgeBottom = "";
        if (intensity !== "auto") mask.dataset.cfIntensity = intensity;
      }
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
  globalThis.CFImageMask = Object.freeze({ applyBoxes, applyReviewCover, applyPendingCover, bindMissFeedback, clearImageMasks, boxStyle, adaptiveMargin, marginUnits, sizeClassForArea });
})();
