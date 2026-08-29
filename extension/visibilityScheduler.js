(function () {
  function createVisibilityScheduler({ IntersectionObserverImpl = globalThis.IntersectionObserver, onEligible = () => {} } = {}) {
    if (!IntersectionObserverImpl) return Object.freeze({ track: () => {}, eligible: elements => elements, isFallback: true });
    const visible = new WeakSet();
    const observed = new WeakSet();
    const observer = new IntersectionObserverImpl(entries => {
      let changed = false;
      entries.forEach(entry => {
        if (entry.isIntersecting && !visible.has(entry.target)) { visible.add(entry.target); observer.unobserve?.(entry.target); changed = true; }
      });
      if (changed) onEligible();
    }, { rootMargin: "320px 0px" });
    return Object.freeze({
      track(elements) { elements.forEach(element => { if (element && !visible.has(element) && !observed.has(element)) { observed.add(element); observer.observe(element); } }); },
      eligible(elements) { return elements.filter(element => visible.has(element)); },
      isFallback: false,
    });
  }
  globalThis.CFVisibility = Object.freeze({ createVisibilityScheduler });
})();
