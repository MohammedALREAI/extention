import { invokeLLM, listLLMModels, type InvokeParams, type InvokeResult, type ModelInfo } from "./_core/llm";

export type ModelRouteName = "semantic" | "visual" | "developer_moderation";

export type ModelRoute = {
  preferredPrefixes: readonly string[];
  maxAttempts: number;
  timeoutMs: number;
};

export const MODEL_ROUTES: Record<ModelRouteName, ModelRoute> = {
  semantic: { preferredPrefixes: ["claude-haiku-4-5", "gemini-3-flash-preview", "gpt-5-mini", "gpt-4o-mini"], maxAttempts: 2, timeoutMs: 5_000 },
  // Three attempts at 6s must all fit inside the extension's own deadline
  // (CFRequestControl.VISUAL_TIMEOUT_MS = 20s). Two was not enough: a gateway that
  // routes the first two names to one unhealthy provider sank the whole route even
  // though working models sat further down the ladder. Raise this only alongside a
  // matching change to that deadline, or the client aborts before the last answer.
  // The trailing names are fallbacks, not preferences: only attempts that actually run
  // cost anything, so listing more simply widens what a broken provider falls back to.
  visual: { preferredPrefixes: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "claude-sonnet-4-6", "gpt-4o", "gpt-5"], maxAttempts: 3, timeoutMs: 6_000 },
  developer_moderation: { preferredPrefixes: ["gpt-5-mini", "claude-haiku-4-5", "gemini-3-flash-preview", "gpt-4o-mini"], maxAttempts: 2, timeoutMs: 6_000 },
};

// Model names are provider-specific, so hardcoding them ties the whole app to one
// gateway: point it at a different provider and every route fails with "no eligible
// model" for a reason nothing explains. These let the names be configured per route
// without touching code; the defaults above apply when unset.
export const MODEL_ROUTE_ENV_VARS: Record<ModelRouteName, string> = {
  semantic: "CF_MODEL_SEMANTIC",
  visual: "CF_MODEL_VISUAL",
  developer_moderation: "CF_MODEL_MODERATION",
};

export function routePrefixes(routeName: ModelRouteName, env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = String(env[MODEL_ROUTE_ENV_VARS[routeName]] ?? "").split(",").map(value => value.trim()).filter(Boolean);
  return configured.length ? configured : [...MODEL_ROUTES[routeName].preferredPrefixes];
}

const CATALOG_TTL_MS = 5 * 60 * 1_000;
const CIRCUIT_FAILURE_LIMIT = 2;
const CIRCUIT_COOLDOWN_MS = 60 * 1_000;

type Dependencies = {
  listModels: () => Promise<{ data: ModelInfo[] }>;
  invoke: (params: InvokeParams) => Promise<InvokeResult>;
  now: () => number;
};

type Circuit = { failures: number; openUntil: number };

// Some gateways namespace their catalog by vendor ("qwen/qwen2.5-vl-72b-instruct"),
// so a plain startsWith on the family name would match nothing there. The name after
// the last slash is checked too, which keeps a prefix meaningful on both shapes.
function matchesPrefix(id: string, prefix: string) {
  return id.startsWith(prefix) || id.slice(id.lastIndexOf("/") + 1).startsWith(prefix);
}

export function orderedModels(models: ModelInfo[], prefixes: readonly string[]): string[] {
  const ordered: string[] = [];
  prefixes.forEach(prefix => {
    const match = models.find(model => matchesPrefix(model.id, prefix))?.id;
    // Two prefixes can resolve to the same model; the route needs two distinct
    // attempts, not the same one retried.
    if (match && !ordered.includes(match)) ordered.push(match);
  });
  return ordered;
}

export function createModelRouter(dependencies: Partial<Dependencies> = {}) {
  const deps: Dependencies = {
    listModels: dependencies.listModels || listLLMModels,
    invoke: dependencies.invoke || invokeLLM,
    now: dependencies.now || Date.now,
  };
  const circuits = new Map<string, Circuit>();
  let catalog: { models: ModelInfo[]; expiresAt: number } | null = null;

  async function catalogModels() {
    if (!catalog || catalog.expiresAt <= deps.now()) {
      const response = await deps.listModels();
      catalog = { models: response.data, expiresAt: deps.now() + CATALOG_TTL_MS };
    }
    return catalog.models;
  }

  async function modelsFor(routeName: ModelRouteName) {
    return orderedModels(await catalogModels(), routePrefixes(routeName));
  }

  function isOpen(model: string) {
    return (circuits.get(model)?.openUntil || 0) > deps.now();
  }

  function recordSuccess(model: string) {
    circuits.delete(model);
  }

  function recordFailure(model: string) {
    const previous = circuits.get(model) || { failures: 0, openUntil: 0 };
    const failures = previous.failures + 1;
    circuits.set(model, { failures, openUntil: failures >= CIRCUIT_FAILURE_LIMIT ? deps.now() + CIRCUIT_COOLDOWN_MS : 0 });
  }

  async function run<T>(routeName: ModelRouteName, request: Omit<InvokeParams, "model" | "maxRetries" | "timeoutMs">, parse: (response: InvokeResult) => T): Promise<{ value: T; model: string; attempts: number }> {
    const route = MODEL_ROUTES[routeName];
    const prefixes = routePrefixes(routeName);
    let models: ModelInfo[];
    try {
      models = await catalogModels();
    } catch {
      // The most common cause by far is unset or wrong gateway configuration, so the
      // message names what to check instead of leaving a dead end.
      throw new Error("No model catalog is currently available. Check BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY.");
    }
    const candidates = orderedModels(models, prefixes);
    if (!candidates.length) {
      // Distinct from a cooldown: the provider simply has nothing by these names.
      const available = models.slice(0, 10).map(model => model.id).join(", ") || "none";
      throw new Error(
        `No model matches route "${routeName}". Looked for ids starting with: ${prefixes.join(", ")}. ` +
        `Set ${MODEL_ROUTE_ENV_VARS[routeName]} to names your provider offers. Available: ${available}`,
      );
    }
    const eligible = candidates.filter(model => !isOpen(model)).slice(0, route.maxAttempts);
    if (!eligible.length) throw new Error(`Every model for route "${routeName}" is in cooldown after repeated failures.`);
    let lastError: unknown;
    for (let index = 0; index < eligible.length; index += 1) {
      const model = eligible[index];
      try {
        const response = await deps.invoke({ ...request, model, maxRetries: 0, timeoutMs: route.timeoutMs });
        const value = parse(response);
        recordSuccess(model);
        return { value, model, attempts: index + 1 };
      } catch (error) {
        lastError = error;
        recordFailure(model);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Model route failed after its bounded attempts.");
  }

  return { run, modelsFor, isOpen };
}

export const modelRouter = createModelRouter();
