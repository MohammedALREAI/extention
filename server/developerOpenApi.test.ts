import { describe, expect, it } from "vitest";
import { developerOpenApi } from "./developerOpenApi";

describe("developer OpenAPI pilot contract", () => {
  it("documents the live moderation path, key auth, bounded request, explicit unavailable state, and safe errors", () => {
    const post = developerOpenApi.paths["/api/v1/moderate/text"].post;
    expect(developerOpenApi.openapi).toBe("3.1.0");
    expect(post.security).toEqual([{ bearerAuth: [] }]);
    expect(post.responses["200"].description).toMatch(/unavailable/i);
    expect(developerOpenApi.components.schemas.ModerationRequest.properties.items.maxItems).toBe(20);
    expect(developerOpenApi.components.schemas.ModerationResult.properties.state.enum).toContain("unavailable");
    expect(post.responses["401"]).toBeDefined();
    expect(post.responses["429"]).toBeDefined();
  });
});
