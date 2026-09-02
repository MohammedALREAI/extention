import { describe, expect, it } from "vitest";
import { createModelRouter, orderedModels, routePrefixes } from "./modelRouter";

const catalog = (...ids: string[]) => ({ data: ids.map(id => ({ id })) as never });

describe("model route configuration", () => {
  it("falls back to the built-in names and lets the environment override them", () => {
    expect(routePrefixes("visual", {} as NodeJS.ProcessEnv)[0]).toBe("gemini-3.1-pro-preview");
    expect(routePrefixes("visual", { CF_MODEL_VISUAL: "gpt-5, gpt-4o" } as NodeJS.ProcessEnv)).toEqual(["gpt-5", "gpt-4o"]);
    // Blank or whitespace-only config must not silently leave the route with no models.
    expect(routePrefixes("visual", { CF_MODEL_VISUAL: "  , ," } as NodeJS.ProcessEnv)[0]).toBe("gemini-3.1-pro-preview");
  });

  it("keeps the configured preference order rather than the catalog order", () => {
    expect(orderedModels([{ id: "gpt-4o" }, { id: "gemini-3-flash-preview-x" }] as never, ["gemini-3-flash", "gpt-4o"]))
      .toEqual(["gemini-3-flash-preview-x", "gpt-4o"]);
  });
});

describe("model router failures", () => {
  it("names the gateway settings when the catalog cannot be read", async () => {
    const router = createModelRouter({ listModels: async () => { throw new Error("connect ECONNREFUSED"); } });
    await expect(router.run("visual", { messages: [] } as never, () => null))
      .rejects.toThrow(/BUILT_IN_FORGE_API_URL/);
  });

  it("says which names were tried and what the provider actually offers", async () => {
    // The failure a provider switch causes: a healthy catalog with different names.
    const router = createModelRouter({ listModels: async () => catalog("gpt-4o", "gpt-4o-mini") });
    await expect(router.run("visual", { messages: [] } as never, () => null))
      .rejects.toThrow(/CF_MODEL_VISUAL.*Available: gpt-4o, gpt-4o-mini/s);
  });

  it("uses the environment override to find a model the provider does have", async () => {
    process.env.CF_MODEL_VISUAL = "gpt-4o";
    try {
      const router = createModelRouter({
        listModels: async () => catalog("gpt-4o", "gpt-4o-mini"),
        invoke: async ({ model }) => ({ id: "1", created: 0, model, choices: [] }) as never,
      });
      const result = await router.run("visual", { messages: [] } as never, () => "ok");
      expect(result).toMatchObject({ model: "gpt-4o", value: "ok" });
    } finally {
      delete process.env.CF_MODEL_VISUAL;
    }
  });
});
