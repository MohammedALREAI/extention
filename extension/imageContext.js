(() => {
  const MAX_CONTEXT_LENGTH = 180;
  const HEADING_SELECTOR = "h1, h2, h3, h4, [role='heading']";
  // Controls, zero-width characters and bidi overrides: invisible to a reader, but able
  // to reshape how the caption reads once it reaches the prompt.
  const INVISIBLE_TEXT = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;

  function clean(value) {
    return String(value || "").normalize("NFC").replace(INVISIBLE_TEXT, " ").replace(/\s+/g, " ").trim();
  }

  // The caption a reader sees beside an image: its own alt/title, a figure caption, or
  // the heading of whatever block it sits in. It is only ever a hint for the visual
  // check — the server prompt states that pixels decide — so a wrong or hostile alt
  // attribute cannot cause anything to be covered on its own.
  function describeImage(image, card) {
    if (!image) return "";
    const attribute = name => clean(image.getAttribute?.(name));
    const figure = image.closest?.("figure")?.querySelector?.("figcaption")?.textContent;
    const heading = card?.querySelector?.(HEADING_SELECTOR)?.textContent;
    // A video shelf or image pack labels the thumbnail from a sibling, not an ancestor.
    const sibling = image.closest?.("a, [role='listitem']")?.getAttribute?.("aria-label");
    const parts = [attribute("alt"), attribute("title"), attribute("aria-label"), clean(figure), clean(sibling), clean(heading)];
    const seen = new Set();
    const merged = parts.filter(part => {
      if (!part || seen.has(part.toLocaleLowerCase())) return false;
      seen.add(part.toLocaleLowerCase());
      return true;
    }).join(" · ");
    return merged.slice(0, MAX_CONTEXT_LENGTH);
  }

  globalThis.CFImageContext = Object.freeze({ describeImage, clean, MAX_CONTEXT_LENGTH });
})();
