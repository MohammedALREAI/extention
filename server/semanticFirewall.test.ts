import { describe, expect, it } from "vitest";
import { parseSemanticReply, semanticPrompt } from "./semanticFirewall";

describe("semantic search evaluation contract", () => {
  it("passes the original Spanish policy and Russian result text to the model without a fixed-language dictionary", () => {
    const prompt = semanticPrompt({
      sourcePreference: "No quiero ver perros",
      rules: [{ term: "perros", action: "blur" }],
      results: [{ id: "ru-1", text: "Новая история о собаке и её семье" }],
    });
    expect(prompt).toContain("No quiero ver perros");
    expect(prompt).toContain("perros");
    expect(prompt).toContain("собаке");
    expect(prompt).toContain("do not use a fixed translation dictionary");
  });

  it("validates a structured semantic decision for a cross-language match", () => {
    const result = parseSemanticReply(JSON.stringify({
      evaluations: [{ id: "ru-1", decision: "blur", confidence: 0.94, reason: "The Russian result is about dogs, matching the Spanish rule." }],
    }));
    expect(result).toEqual([expect.objectContaining({ id: "ru-1", decision: "blur", source: "semantic" })]);
  });
});
