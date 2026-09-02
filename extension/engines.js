(function () {
  const REGISTRY = [
    { id: "google", hosts: [/^(.+\.)?google\./i], cardSelectors: ["div[data-hveid]:has(h3)", "a[href]:has(h3)", "div.MjjYud", "div.g"], imageCardSelectors: ["a[href*='imgurl=']", "div[data-ri]", "div.isv-r"], imageRegions: ["#center_col", "#search", "#rhs", "#rcnt", "div[role='main']", "div[role='complementary']"] },
    { id: "bing", hosts: [/^www\.bing\.com$/i], cardSelectors: ["li.b_algo"] },
    { id: "duckduckgo", hosts: [/^(html\.)?duckduckgo\.com$/i], cardSelectors: ["article[data-testid='result']", "div.result"] },
    { id: "brave", hosts: [/^search\.brave\.com$/i], cardSelectors: ["div[data-type='web']", "div.snippet"] },
    { id: "yahoo", hosts: [/^search\.yahoo\.com$/i], cardSelectors: ["#web ol.searchCenterMiddle > li", "div#web li"] },
    { id: "ecosia", hosts: [/^(www\.)?ecosia\.org$/i], cardSelectors: ["article"] },
  ];

  // Banner and footer regions are included: a filtered object does not stop mattering
  // because it sits in a page header rather than a result.
  const DEFAULT_IMAGE_REGIONS = ["div[role='main']", "main", "#results", "#search", "div[role='banner']", "header", "div[role='contentinfo']", "footer"];

  function urlObject(value) {
    try { return new URL(value); } catch { return new URL("https://invalid.local/"); }
  }

  function isLikelySearchUrl(value) {
    const url = urlObject(value);
    const terms = ["q", "query", "p", "text", "search", "keyword"];
    return terms.some(term => url.searchParams.has(term)) || /search|results|find/i.test(url.pathname);
  }

  function detectEngine(value) {
    const url = urlObject(value);
    const engine = REGISTRY.find(entry => entry.hosts.some(pattern => pattern.test(url.hostname)));
    return engine || (isLikelySearchUrl(value) ? { id: "generic", hosts: [], cardSelectors: ["article", "li", "[role='main'] > div"] } : null);
  }

  function unique(elements) {
    return Array.from(new Set(elements)).filter(element => element && element.nodeType === 1);
  }

  function cardsForDocument(documentRef, pageUrl) {
    const engine = detectEngine(pageUrl);
    if (!engine) return { engine: null, cards: [] };
    const cards = unique(engine.cardSelectors.flatMap(selector => Array.from(documentRef.querySelectorAll(selector))));
    const meaningful = cards.filter(card => card.querySelector("a[href]") && card.textContent && card.textContent.trim().length > 16);
    return { engine, cards: meaningful };
  }

  function extractResultText(card) {
    const title = card.querySelector("h1, h2, h3, [role='heading']")?.textContent || "";
    const links = Array.from(card.querySelectorAll("a[href]")).map(link => `${link.textContent || ""} ${link.href || ""}`).join(" ");
    const allText = card.textContent || "";
    return `${title} ${allText} ${links}`.normalize("NFC").replace(/\s+/gu, " ").trim();
  }

  // Result images are not only inside text result cards: a knowledge panel, a video
  // shelf or an image pack carries its own images. These regions bound the sweep that
  // catches them, so protection is not limited to the cards the text pipeline found.
  // The ARIA roles are listed alongside the ids on purpose — Google's side panel
  // ("نتائج تكميلية" / complementary results) keeps role="complementary" across the
  // markup renames that its container id does not survive.
  function imageRegionsForDocument(documentRef, pageUrl) {
    const engine = detectEngine(pageUrl);
    if (!engine) return { engine: null, regions: [] };
    const selectors = engine.imageRegions || DEFAULT_IMAGE_REGIONS;
    return { engine, regions: unique(selectors.flatMap(selector => Array.from(documentRef.querySelectorAll(selector)))) };
  }

  function imageCardsForDocument(documentRef, pageUrl) {
    const engine = detectEngine(pageUrl);
    if (!engine?.imageCardSelectors) return { engine, cards: [] };
    return { engine, cards: unique(engine.imageCardSelectors.flatMap(selector => Array.from(documentRef.querySelectorAll(selector)))) };
  }

  globalThis.CFEngines = Object.freeze({ REGISTRY, cardsForDocument, imageCardsForDocument, imageRegionsForDocument, detectEngine, extractResultText, isLikelySearchUrl });
})();
