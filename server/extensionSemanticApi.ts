import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { getPolicyByIdForUser, getUserById } from "./db";
import { ENV } from "./_core/env";
import { evaluateSemantically } from "./semanticFirewall";
import { localizeVisualMatches } from "./visualLocalization";
import { getSubscriptionSummaryForUser } from "./subscriptionService";

type ExtensionClaims = { policyId: number; userId: number; exp: number };
export const MAX_IMAGE_ID_LENGTH = 120;
// A search page may embed a result thumbnail inline instead of linking it. Such a
// thumbnail is accepted as bounded base64 so it can be localized, and like every
// other image it is passed to the model and never stored.
export const MAX_INLINE_IMAGE_LENGTH = 200_000;
const INLINE_IMAGE = /^data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/i;
const windowMs = 60_000;
const requests = new Map<string, { count: number; resetAt: number }>();

function b64(value: string) {
  return Buffer.from(value).toString("base64url");
}

function signature(payload: string) {
  return createHmac("sha256", ENV.cookieSecret).update(payload).digest("base64url");
}

export function createExtensionAccessToken(policyId: number, userId: number) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  const payload = b64(JSON.stringify({ policyId, userId, exp }));
  return { token: `${payload}.${signature(payload)}`, expiresAt: exp * 1000 };
}

export function verifyExtensionAccessToken(token: string): ExtensionClaims | undefined {
  const [payload, provided] = token.split(".");
  if (!payload || !provided || !ENV.cookieSecret) return undefined;
  const expected = signature(payload);
  if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ExtensionClaims;
    if (!Number.isInteger(claims.policyId) || !Number.isInteger(claims.userId) || claims.exp * 1000 <= Date.now()) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

export function isAllowedExtensionOrigin(origin: string | undefined) {
  return !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}

function allowCors(request: Request, response: Response) {
  const origin = request.header("origin");
  if (!isAllowedExtensionOrigin(origin)) return false;
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  return true;
}

function allowRequest(token: string) {
  const now = Date.now();
  const current = requests.get(token);
  if (!current || current.resetAt <= now) {
    requests.set(token, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= 40) return false;
  current.count += 1;
  return true;
}

export function normalizeVisualRequestImages(submitted: unknown[]) {
  return submitted.map(item => {
    const candidate = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const width = Number(candidate.width);
    const height = Number(candidate.height);
    const url = typeof candidate.url === "string" ? candidate.url.trim().slice(0, 2000) : "";
    const dataUrl = typeof candidate.dataUrl === "string" ? candidate.dataUrl.trim() : "";
    const inline = dataUrl.length <= MAX_INLINE_IMAGE_LENGTH && INLINE_IMAGE.test(dataUrl) ? dataUrl : "";
    return {
      // Never shorten an id. The extension matches detections back to images by
      // id, so a truncated id returns unmatched and reads as a confident no-match.
      id: typeof candidate.id === "string" ? candidate.id.trim() : "",
      url: /^https:\/\//i.test(url) ? url : inline,
      width: Number.isFinite(width) && width > 0 && width <= 10_000 ? Math.round(width) : undefined,
      height: Number.isFinite(height) && height > 0 && height <= 10_000 ? Math.round(height) : undefined,
    };
  }).filter(image => image.id && image.id.length <= MAX_IMAGE_ID_LENGTH && image.url);
}

export function registerExtensionSemanticApi(app: Express) {
  app.options("/api/extension/semantic-evaluate", (request, response) => {
    if (!allowCors(request, response)) return response.sendStatus(403);
    response.sendStatus(204);
  });
  app.options("/api/extension/visual-localize", (request, response) => {
    if (!allowCors(request, response)) return response.sendStatus(403);
    response.sendStatus(204);
  });

  app.post("/api/extension/semantic-evaluate", async (request: Request, response: Response) => {
    if (!allowCors(request, response)) return response.status(403).json({ error: "Extension origin required." });
    const token = request.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const claims = verifyExtensionAccessToken(token);
    if (!claims) return response.status(401).json({ error: "Invalid extension access token." });
    const user = await getUserById(claims.userId);
    if (!user) return response.status(401).json({ error: "Subscription account was not found." });
    const subscription = await getSubscriptionSummaryForUser(user);
    if (!subscription.hasAccess) return response.status(402).json({ error: "Trial or subscription access has ended." });
    if (!allowRequest(token)) return response.status(429).json({ error: "Too many semantic evaluations. Retry shortly." });
    const submitted: unknown[] = Array.isArray(request.body?.results) ? request.body.results.slice(0, 12) : [];
    const results = submitted.map(item => {
      const candidate = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        id: typeof candidate.id === "string" ? candidate.id.slice(0, 80) : "",
        text: typeof candidate.text === "string" ? candidate.text.trim().slice(0, 3500) : "",
      };
    }).filter(item => item.id && item.text.length >= 3);
    if (!results.length) return response.status(400).json({ error: "At least one result text is required." });
    try {
      const policy = await getPolicyByIdForUser(claims.policyId, claims.userId);
      if (!policy) return response.status(404).json({ error: "Policy not found." });
      const result = await evaluateSemantically({
        sourcePreference: policy.sourcePreference,
        rules: policy.rulesJson,
        results,
      });
      return response.json(result);
    } catch (error) {
      console.error("[Extension semantic evaluation]", error);
      return response.status(502).json({ error: "Semantic evaluation was unavailable." });
    }
  });

  app.post("/api/extension/visual-localize", async (request: Request, response: Response) => {
    if (!allowCors(request, response)) return response.status(403).json({ error: "Extension origin required." });
    const token = request.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const claims = verifyExtensionAccessToken(token);
    if (!claims) return response.status(401).json({ error: "Invalid extension access token." });
    const user = await getUserById(claims.userId);
    if (!user) return response.status(401).json({ error: "Subscription account was not found." });
    const subscription = await getSubscriptionSummaryForUser(user);
    if (!subscription.hasAccess) return response.status(402).json({ error: "Trial or subscription access has ended." });
    if (!allowRequest(token)) return response.status(429).json({ error: "Too many visual checks. Retry shortly." });
    const submitted: unknown[] = Array.isArray(request.body?.images) ? request.body.images.slice(0, 6) : [];
    const images = normalizeVisualRequestImages(submitted);
    if (!images.length) return response.status(400).json({ error: "At least one HTTPS image URL or inline image is required." });
    try {
      const policy = await getPolicyByIdForUser(claims.policyId, claims.userId);
      if (!policy) return response.status(404).json({ error: "Policy not found." });
      return response.json(await localizeVisualMatches({ sourcePreference: policy.sourcePreference, rules: policy.rulesJson, images }));
    } catch (error) {
      console.error("[Extension visual localization]", error);
      return response.status(502).json({ error: "Visual localization was unavailable." });
    }
  });
}
