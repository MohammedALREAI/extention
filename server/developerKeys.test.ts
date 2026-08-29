import { describe, expect, it } from "vitest";
import { createDeveloperApiSecret, hashDeveloperApiKey, readBearerApiKey } from "./developerKeys";

describe("developer API secrets", () => {
  it("creates a cfk secret and stores only a deterministic hash for lookup", () => {
    const created = createDeveloperApiSecret();
    expect(created.secret).toMatch(/^cfk_/);
    expect(created.keyPrefix).toBe(created.secret.slice(0, 16));
    expect(created.secretHash).toBe(hashDeveloperApiKey(created.secret));
    expect(created.secretHash).not.toContain(created.secret);
  });

  it("accepts only bounded Bearer developer keys", () => {
    expect(readBearerApiKey("Bearer cfk_valid_key")).toBe("cfk_valid_key");
    expect(readBearerApiKey("Bearer extension-token")).toBeUndefined();
    expect(readBearerApiKey(undefined)).toBeUndefined();
  });
});
