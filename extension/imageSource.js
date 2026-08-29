(() => {
  const INLINE_IMAGE = /^data:image\//i;

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

  function visualSource(image) {
    const url = bestVisualUrl(image);
    return { url, inline: url ? "" : inlineImageUrl(image) };
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
    return source?.url ? `${prefix}:${digest(source.url)}` : `${prefix}:local:${index}`;
  }

  globalThis.CFImageSource = Object.freeze({ bestVisualUrl, srcsetUrls, inlineImageUrl, visualSource, sourceKey });
})();
