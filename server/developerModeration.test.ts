import { describe, expect, it } from "vitest";
import { developerModerationPrompt, parseDeveloperModerationReply, unavailableResults } from "./developerModeration";

const rules = [{ label: "harassment", description: "إهانة أو تهديد موجّه لشخص", action: "review" as const }];

describe("Arabic developer moderation contract", () => {
  it("explicitly keeps MSA, dialect, and mixed-script content in the customer-rule evaluation scope", () => {
    const prompt = developerModerationPrompt({ description: "قواعد مجتمع عربية", rules, items: [{ id: "jordanian", text: "إنت غبي", language: "ar" }] });
    expect(prompt).toMatch(/MSA, common dialectal Arabic, code-switching/i);
    expect(prompt).toContain("إنت غبي");
    expect(prompt).toContain("harassment");
  });

  it("accepts customer-controlled labels and preserves a genuine unavailable state", () => {
    const parsed = parseDeveloperModerationReply({ results: [{ id: "dialect", state: "match", action: "review", labels: ["harassment"], confidence: 0.91, reason: "Clear directed insult." }] }, ["dialect"], rules);
    expect(parsed[0]).toMatchObject({ state: "match", action: "review", labels: ["harassment"] });
    expect(unavailableResults([{ id: "dialect", text: "شو هالحكي" }])[0]).toMatchObject({ state: "unavailable", action: null, confidence: 0 });
  });
});
