import { invokeLLM, listLLMModels, type InvokeParams, type InvokeResult, type ModelInfo } from "./_core/llm";

export type ModelRouteName = "semantic" | "visual" | "developer_moderation";

export type ModelRoute = {
  preferredPrefixes: readonly string[];
  maxAttempts: number;
  timeoutMs: number;
};

export const MODEL_ROUTES: Record<ModelRouteName, ModelRoute> = {
  semantic: { preferredPrefixes: ["claude-haiku-4-5", "gemini-3-flash-preview", "gpt-5-mini"], maxAttempts: 2, timeoutMs: 5_000 },
  visual: { preferredPrefixes: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "claude-sonnet-4-6"], maxAttempts: 2, timeoutMs: 12_000 },
  developer_moderation: { preferredPrefixes: ["gpt-5-mini", "claude-haiku-4-5", "gemini-3-flash-preview"], maxAttempts: 2, timeoutMs: 6_000 },
};

const CATALOG_TTL_MS = 5 * 60 * 1_000;
const CIRCUIT_FAILURE_LIMIT = 2;
const CIRCUIT_COOLDOWN_MS = 60 * 1_000;

type Dependencies = {
  listModels: () => Promise<{ data: ModelInfo[] }>;
  invoke: (params: InvokeParams) => Promise<InvokeResult>;
  now: () => number;
};

type Circuit = { failures: number; openUntil: number };

export function orderedModels(models: ModelInfo[], route: ModelRoute): string[] {
  return route.preferredPrefixes
    .map(prefix => models.find(model => model.id.startsWith(prefix))?.id)
    .filter((model): model is string => Boolean(model));
}

export function createModelRouter(dependencies: Partial<Dependencies> = {}) {
  const deps: Dependencies = {
    listModels: dependencies.listModels || listLLMModels,
    invoke: dependencies.invoke || invokeLLM,
    now: dependencies.now || Date.now,
  };
  const circuits = new Map<string, Circuit>();
  let catalog: { models: ModelInfo[]; expiresAt: number } | null = null;

  async function modelsFor(route: ModelRoute) {
    if (!catalog || catalog.expiresAt <= deps.now()) {
      const response = await deps.listModels();
      catalog = { models: response.data, expiresAt: deps.now() + CATALOG_TTL_MS };
    }
    return orderedModels(catalog.models, route);
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
    let candidates: string[];
    try {
      candidates = await modelsFor(route);
    } catch {
      throw new Error("No model catalog is currently available.");
    }
    const eligible = candidates.filter(model => !isOpen(model)).slice(0, route.maxAttempts);
    if (!eligible.length) throw new Error("No eligible model is currently available.");
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
