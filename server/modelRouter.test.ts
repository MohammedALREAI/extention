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

  it("matches a family name inside a vendor-namespaced catalog", () => {
    // OpenRouter-style ids: a plain startsWith on "qwen2.5-vl" would find nothing.
    const catalogue = [{ id: "qwen/qwen2.5-vl-72b-instruct" }, { id: "google/gemini-2.5-pro" }] as never;
    expect(orderedModels(catalogue, ["qwen2.5-vl"])).toEqual(["qwen/qwen2.5-vl-72b-instruct"]);
    expect(orderedModels(catalogue, ["gemini-2.5"])).toEqual(["google/gemini-2.5-pro"]);
    expect(orderedModels(catalogue, ["qwen/qwen2.5"])).toEqual(["qwen/qwen2.5-vl-72b-instruct"]);
  });

  it("never offers the same model twice when two prefixes resolve to it", () => {
    expect(orderedModels([{ id: "qwen/qwen3-vl-plus" }] as never, ["qwen3-vl", "qwen3", "qwen"]))
      .toEqual(["qwen/qwen3-vl-plus"]);
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
    const router = createModelRouter({ listModels: async () => catalog("llama-3-70b", "mistral-large") });
    await expect(router.run("visual", { messages: [] } as never, () => null))
      .rejects.toThrow(/CF_MODEL_VISUAL.*Available: llama-3-70b, mistral-large/s);
  });

  it("finds a vision model on an OpenAI-only catalog with no configuration", async () => {
    // The defaults list GPT names after the Gemini and Claude ones, so a provider
    // carrying only OpenAI models still resolves without anyone setting a variable.
    const router = createModelRouter({
      listModels: async () => catalog("gpt-4o", "gpt-4o-mini"),
      invoke: async ({ model }) => ({ id: "1", created: 0, model, choices: [] }) as never,
    });
    expect(await router.run("visual", { messages: [] } as never, () => "ok")).toMatchObject({ model: "gpt-4o" });
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
