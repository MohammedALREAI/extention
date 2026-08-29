import { describe, expect, it } from "vitest";
import { privacyPolicySections } from "./Privacy";

describe("public privacy notice", () => {
  it("discloses extension inputs, server transfer limits, storage controls, and expiration safeguards", () => {
    expect(privacyPolicySections).toHaveLength(5);
    expect(privacyPolicySections.map(section => section.title)).toEqual([
      "What the extension reads",
      "When data leaves your browser",
      "Storage and control",
      "No sale and no advertising use",
      "Access tokens and safety behavior",
    ]);
    expect(privacyPolicySections.flatMap(section => section.body).join(" ")).toContain("does not read full article pages");
    expect(privacyPolicySections.flatMap(section => section.body).join(" ")).toContain("time-limited access token");
    expect(privacyPolicySections.flatMap(section => section.body).join(" ")).toContain("does not sell user data");
    expect(privacyPolicySections.flatMap(section => section.body).join(" ")).toContain("does not use extension data for advertising");
  });
});
