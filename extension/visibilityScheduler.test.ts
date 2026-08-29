import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => { await import("./visibilityScheduler.js"); });

describe("extension visibility scheduling", () => {
  it("defers off-screen work until a card intersects the near viewport and falls back safely without IntersectionObserver", () => {
    let callback: (entries: Array<{ target: object; isIntersecting: boolean }>) => void = () => {};
    const observed: object[] = [];
    class FakeObserver {
      constructor(handler: typeof callback) { callback = handler; }
      observe(element: object) { observed.push(element); }
      unobserve() {}
    }
    let wakeups = 0;
    const scheduler = globalThis.CFVisibility.createVisibilityScheduler({ IntersectionObserverImpl: FakeObserver, onEligible: () => wakeups++ });
    const cards = [{ id: "first" }, { id: "later" }];
    scheduler.track(cards);
    expect(observed).toEqual(cards);
    expect(scheduler.eligible(cards)).toEqual([]);
    callback([{ target: cards[0], isIntersecting: true }]);
    expect(scheduler.eligible(cards)).toEqual([cards[0]]);
    expect(wakeups).toBe(1);
    expect(globalThis.CFVisibility.createVisibilityScheduler({ IntersectionObserverImpl: null }).eligible(cards)).toEqual(cards);
  });
});
