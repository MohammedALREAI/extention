import { describe, expect, it, beforeEach } from "vitest";
import { evaluateCheck, parsePreference, resetDecisionCache } from "./firewall";

describe("preference parsing", () => {
  it("extracts Arabic terms and an inferred block action", () => {
    const result = parsePreference("لا أريد مشاهدة عنف أو قمار");
    expect(result.language).toBe("ar");
    expect(result.action).toBe("block");
    expect(result.rules.map(rule => rule.term)).toEqual(["عنف", "قمار"]);
  });

  it("extracts English rules with an editable override", () => {
    const result = parsePreference("Please hide graphic violence and gambling", "warn");
    expect(result.language).toBe("en");
    expect(result.action).toBe("warn");
    expect(result.rules.map(rule => rule.term)).toEqual(["graphic violence", "gambling"]);
  });
});

describe("rule evaluation", () => {
  beforeEach(() => resetDecisionCache());

  const base = {
    rules: [{ term: "gambling", action: "block" as const }],
    scope: { text: true, images: true },
  };

  it("returns a matching protection decision for text", () => {
    const result = evaluateCheck({ ...base, inputType: "text", value: "A gambling offer is available now." });
    expect(result.decision).toBe("block");
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.matchedTerms).toEqual(["gambling"]);
  });

  it("marks unmatched image URLs as uncertain instead of safe", () => {
    const result = evaluateCheck({ ...base, inputType: "image", value: "https://cdn.example.com/photo.jpg" });
    expect(result.decision).toBe("uncertain");
    expect(result.uncertain).toBe(true);
  });

  it("labels repeated tests as cached", () => {
    const input = { ...base, inputType: "text" as const, value: "gambling news" };
    expect(evaluateCheck(input).cacheStatus).toBe("fresh");
    expect(evaluateCheck(input).cacheStatus).toBe("cached");
  });
});
