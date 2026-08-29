import { describe, expect, it } from "vitest";
import { toExtensionPolicySnapshot } from "../shared/extensionSnapshot";

describe("extension policy snapshot", () => {
  it("preserves the policy language, Unicode rule terms, scope, and version", () => {
    const snapshot = toExtensionPolicySnapshot({
      id: 24,
      version: 3,
      language: "ar",
      sourcePreference: "لا أريد قمار أو ギャンブル",
      scopeText: true,
      scopeImages: false,
      rules: [{ term: "قمار", action: "block" }, { term: "ギャンブル", action: "warn" }],
    });
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      revision: "app-24-v3",
      locale: "ar",
      scope: { text: true, images: false },
    });
    expect(snapshot.rules.map(rule => rule.term)).toEqual(["قمار", "ギャンブル"]);
  });
});
