import { describe, expect, it } from "vitest";
import { buildCurlExample, developerCopy } from "./Developer";

describe("developer portal copy", () => {
  it("shows the API endpoint, explicit unavailable state, and Arabic moderation positioning", () => {
    expect(developerCopy.ar.title).toMatch(/إشراف عربي/);
    expect(developerCopy.en.unavailable).toMatch(/never silently allowed/i);
    expect(developerCopy.ar.usage).toMatch(/بيانات وصفية/);
    expect(buildCurlExample("https://api.example.test")).toContain("https://api.example.test/api/v1/moderate/text");
    expect(buildCurlExample("https://api.example.test")).toContain("\"language\":\"ar\"");
  });
});
