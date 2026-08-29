import type { Express, Request, Response } from "express";
import { getActiveDeveloperApiKeyByHash, recordDeveloperApiUsage, touchDeveloperApiKey } from "./db";
import { hashDeveloperApiKey, readBearerApiKey } from "./developerKeys";
import { moderateDeveloperText, type DeveloperModerationAction, type DeveloperModerationItem, type DeveloperModerationRule } from "./developerModeration";
import { developerOpenApi } from "./developerOpenApi";

const windows = new Map<number, { count: number; resetAt: number }>();
const ACTIONS = new Set<DeveloperModerationAction>(["mask", "review", "block"]);

export function parseDeveloperModerationRequest(body: unknown): { description: string; revision: string; rules: DeveloperModerationRule[]; items: DeveloperModerationItem[] } | undefined {
  const candidate = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const policy = candidate.policy && typeof candidate.policy === "object" ? candidate.policy as Record<string, unknown> : {};
  const rawRules = Array.isArray(policy.rules) ? policy.rules.slice(0, 12) : [];
  const rules = rawRules.map(rule => {
    const item = rule && typeof rule === "object" ? rule as Record<string, unknown> : {};
    return { label: typeof item.label === "string" ? item.label.trim().slice(0, 80) : "", description: typeof item.description === "string" ? item.description.trim().slice(0, 500) : "", action: item.action as DeveloperModerationAction };
  }).filter(rule => rule.label && rule.description && ACTIONS.has(rule.action));
  const rawItems = Array.isArray(candidate.items) ? candidate.items.slice(0, 20) : [];
  const items = rawItems.map(item => {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { id: typeof value.id === "string" ? value.id.trim().slice(0, 80) : "", text: typeof value.text === "string" ? value.text.trim().slice(0, 5000) : "", language: typeof value.language === "string" ? value.language.trim().slice(0, 16) : undefined };
  }).filter(item => item.id && item.text.length >= 2);
  const uniqueIds = new Set(items.map(item => item.id));
  const description = typeof policy.description === "string" ? policy.description.trim().slice(0, 1500) : "";
  const revision = typeof policy.revision === "string" ? policy.revision.trim().slice(0, 100) : "";
  return description && revision && rules.length && items.length && uniqueIds.size === items.length ? { description, revision, rules, items } : undefined;
}

export function allowDeveloperRequest(keyId: number, limit: number) {
  const now = Date.now(); const current = windows.get(keyId);
  if (!current || current.resetAt <= now) { windows.set(keyId, { count: 1, resetAt: now + 60_000 }); return true; }
  if (current.count >= limit) return false;
  current.count += 1; return true;
}

export function usageMetrics(results: Array<{ state: "match" | "no_match" | "unavailable" }>, itemCount: number, latencyMs: number) {
  return {
    itemCount,
    matchCount: results.filter(result => result.state === "match").length,
    noMatchCount: results.filter(result => result.state === "no_match").length,
    unavailableCount: results.filter(result => result.state === "unavailable").length,
    latencyMs: Math.max(0, Math.min(Math.round(latencyMs), 60_000)),
    httpStatus: 200,
  };
}

export function registerDeveloperModerationApi(app: Express) {
  app.get("/api/v1/openapi.json", (_request: Request, response: Response) => {
    response.setHeader("Cache-Control", "public, max-age=300");
    return response.json(developerOpenApi);
  });
  app.post("/api/v1/moderate/text", async (request: Request, response: Response) => {
    const secret = readBearerApiKey(request.header("authorization"));
    if (!secret) return response.status(401).json({ error: { code: "invalid_api_key", message: "A valid Bearer API key is required." } });
    const key = await getActiveDeveloperApiKeyByHash(hashDeveloperApiKey(secret));
    if (!key || !key.scopesJson.includes("moderation:text")) return response.status(401).json({ error: { code: "invalid_api_key", message: "API key is invalid, revoked, expired, or lacks this scope." } });
    if (!allowDeveloperRequest(key.id, key.rateLimitPerMinute)) return response.status(429).json({ error: { code: "rate_limited", message: "Pilot rate limit reached. Retry after one minute." } });
    const input = parseDeveloperModerationRequest(request.body);
    if (!input) return response.status(400).json({ error: { code: "invalid_request", message: "Provide policy revision, description, one or more valid rules, and up to 20 unique text items." } });
    const startedAt = Date.now();
    const results = await moderateDeveloperText(input);
    const metrics = usageMetrics(results, input.items.length, Date.now() - startedAt);
    void Promise.all([touchDeveloperApiKey(key.id), recordDeveloperApiUsage({ apiKeyId: key.id, ...metrics })]).catch(error => console.error("[Developer API usage]", error));
    response.setHeader("Cache-Control", "no-store");
    return response.json({ object: "moderation.batch", policyRevision: input.revision, results });
  });
}
