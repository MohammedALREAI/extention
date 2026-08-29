(function () {
  const forbiddenParents = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "BUTTON"]);

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function clearMasks(root) {
    root.querySelectorAll?.(".cf-inline-mask").forEach(mask => mask.replaceWith(document.createTextNode(mask.dataset.cfOriginal || mask.textContent || "")));
  }

  function splitTextForMask(value, terms) {
    const normalized = [...new Set((terms || []).map(term => String(term || "").trim()).filter(term => term.length >= 2))].sort((a, b) => b.length - a.length);
    if (!normalized.length) return [{ type: "text", value: String(value || "") }];
    const matcher = new RegExp(normalized.map(escapeRegExp).join("|"), "giu");
    const output = [];
    let index = 0;
    let match;
    while ((match = matcher.exec(String(value || "")))) {
      if (match.index > index) output.push({ type: "text", value: value.slice(index, match.index) });
      output.push({ type: "mask", value: match[0] });
      index = match.index + match[0].length;
    }
    if (index < String(value || "").length || !output.length) output.push({ type: "text", value: String(value || "").slice(index) });
    return output;
  }

  function maskText(root, terms) {
    if (!root || !globalThis.document || !Array.isArray(terms)) return 0;
    const normalized = [...new Set(terms.map(term => String(term || "").trim()).filter(term => term.length >= 2))].sort((a, b) => b.length - a.length);
    if (!normalized.length) return 0;
    clearMasks(root);
    const matcher = new RegExp(normalized.map(escapeRegExp).join("|"), "giu");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || forbiddenParents.has(parent.tagName) || parent.closest(".cf-result-guard, .cf-inline-mask")) return NodeFilter.FILTER_REJECT;
        matcher.lastIndex = 0;
        return matcher.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let count = 0;
    nodes.forEach(node => {
      const value = node.nodeValue || "";
      const segments = splitTextForMask(value, normalized);
      if (!segments.some(segment => segment.type === "mask")) return;
      const fragment = document.createDocumentFragment();
      segments.forEach(segment => {
        if (segment.type === "text") { fragment.append(segment.value); return; }
        const mask = document.createElement("span");
        mask.className = "cf-inline-mask";
        mask.dataset.cfOriginal = segment.value;
        mask.textContent = segment.value;
        mask.title = "Filtered content — select to reveal";
        mask.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          mask.replaceWith(document.createTextNode(segment.value));
          if (typeof globalThis.dispatchEvent === "function") globalThis.dispatchEvent(new Event("cf:count-change"));
        });
        fragment.append(mask);
        count += 1;
      });
      node.replaceWith(fragment);
    });
    return count;
  }

  globalThis.CFTextMask = Object.freeze({ clearMasks, maskText, splitTextForMask });
})();
