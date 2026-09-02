(() => {
  const INLINE_IMAGE = /^data:image\//i;
  // Bounds for the inline thumbnail sent to the vision endpoint. Anything larger is
  // re-encoded down first, so a page cannot push an unbounded payload through.
  const MAX_INLINE_LENGTH = 120_000;
  const MAX_SNAPSHOT_LENGTH = 180_000;
  const SNAPSHOT_EDGE = 512;

  function httpsUrl(value) {
    const candidate = String(value || "").trim();
    return /^https:\/\//i.test(candidate) ? candidate : "";
  }

  function srcsetUrls(value) {
    return String(value || "").split(",").map(part => {
      const [url, descriptor = ""] = part.trim().split(/\s+/u);
      const rank = Number.parseFloat(descriptor) || 0;
      return { url: httpsUrl(url), rank };
    }).filter(candidate => candidate.url).sort((a, b) => b.rank - a.rank).map(candidate => candidate.url);
  }

  function bestVisualUrl(image) {
    if (!image) return "";
    const attribute = name => image.getAttribute?.(name) || "";
    const ancestorOriginal = image.closest?.("[data-iurl]")?.getAttribute?.("data-iurl") || "";
    const candidates = [
      httpsUrl(ancestorOriginal),
      httpsUrl(attribute("data-iurl")),
      ...srcsetUrls(attribute("data-srcset")),
      ...srcsetUrls(attribute("srcset")),
      httpsUrl(image.currentSrc),
      httpsUrl(attribute("data-src")),
      httpsUrl(image.src),
    ];
    return candidates.find(Boolean) || "";
  }

  // Google inlines part of an image pack as base64 thumbnails. Those pixels never
  // leave the browser, so they cannot be localized remotely, but they must still be
  // recognized as a real image instead of disappearing from the candidate list.
  function inlineImageUrl(image) {
    if (!image) return "";
    const attribute = name => image.getAttribute?.(name) || "";
    return [image.currentSrc, image.src, attribute("src"), attribute("data-src")]
      .map(value => String(value || "").trim())
      .find(value => INLINE_IMAGE.test(value)) || "";
  }

  // An oversized inline thumbnail is re-encoded through a canvas. Reading pixels back
  // is only possible because a data: image is same-origin; a cross-origin bitmap
  // taints the canvas and throws, which is caught and reported as no source.
  function snapshotDataUrl(image, documentRef) {
    const width = image?.naturalWidth || 0;
    const height = image?.naturalHeight || 0;
    if (!width || !height || typeof documentRef?.createElement !== "function") return "";
    try {
      const scale = Math.min(1, SNAPSHOT_EDGE / Math.max(width, height));
      const canvas = documentRef.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext?.("2d");
      if (!context) return "";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const encoded = canvas.toDataURL("image/jpeg", 0.72);
      return INLINE_IMAGE.test(encoded) && encoded.length <= MAX_SNAPSHOT_LENGTH ? encoded : "";
    } catch {
      return "";
    }
  }

  function computeSource(image, documentRef) {
    const url = bestVisualUrl(image);
    if (url) return { url, inline: "", dataUrl: "", hash: digest(url) };
    const inline = inlineImageUrl(image);
    if (!inline) return { url: "", inline: "", dataUrl: "", hash: "" };
    return { url: "", inline, dataUrl: inline.length <= MAX_INLINE_LENGTH ? inline : snapshotDataUrl(image, documentRef), hash: digest(inline) };
  }

  // Re-encoding on every scan would be wasteful, so the resolved source is kept on
  // the element and reused until its own src changes.
  function visualSource(image, documentRef = globalThis.document) {
    const signature = `${image?.currentSrc || ""}|${image?.src || ""}|${image?.naturalWidth || 0}x${image?.naturalHeight || 0}`;
    if (image?.__cfVisualSource?.signature === signature) return image.__cfVisualSource.value;
    const value = computeSource(image, documentRef);
    if (image) image.__cfVisualSource = { signature, value };
    return value;
  }

  function digest(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  // The localizer API bounds detection ids, and a real Google thumbnail URL is far
  // longer than that bound. An id that does not survive the round trip comes back
  // unmatched and is read as a confident no-match, so key on a short digest instead.
  function sourceKey(revision, source, index = 0) {
    const prefix = `${String(revision || "").slice(0, 24)}:img`;
    const hash = source?.hash || (source?.url ? digest(source.url) : "");
    return hash ? `${prefix}:${hash}` : `${prefix}:local:${index}`;
  }

  globalThis.CFImageSource = Object.freeze({ bestVisualUrl, srcsetUrls, inlineImageUrl, snapshotDataUrl, visualSource, sourceKey, MAX_INLINE_LENGTH });
})();
