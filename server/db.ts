import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { checkHistory, developerApiKeys, developerApiUsage, imageUploads, InsertUser, policies, subscriptions, users } from "../drizzle/schema";
import { ENV } from './_core/env';
import type { CheckResult, FirewallRule, InputType, PolicyAction } from "./firewall";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const client = new Pool({ connectionString: process.env.DATABASE_URL! });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getSubscriptionForUser(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  return result[0];
}

export async function ensureTrialSubscriptionForUser(userId: number, trialStartedAt: Date, trialEndsAt: Date) {
  const existing = await getSubscriptionForUser(userId);
  if (existing) return existing;
  const db = await getDb();
  if (!db) return undefined;
  try {
    await db.insert(subscriptions).values({
      userId,
      planCode: "trial",
      status: "trial",
      trialStartedAt,
      trialEndsAt,
    });
  } catch (error) {
    // The unique user constraint makes concurrent first access safe: read the
    // already-created record rather than granting another trial.
    const raced = await getSubscriptionForUser(userId);
    if (raced) return raced;
    throw error;
  }
  return getSubscriptionForUser(userId);
}

export async function updateSubscriptionStatusForUser(userId: number, status: "trial" | "active" | "expired" | "cancelled") {
  const db = await getDb();
  if (!db) return;
  await db.update(subscriptions).set({ status }).where(eq(subscriptions.userId, userId));
}

// Scopes were hardcoded to text moderation, so a key could never carry a scope added
// later — the image route would have rejected every key ever issued.
export const DEFAULT_DEVELOPER_SCOPES = ["moderation:text", "detect:image"];

export async function createDeveloperApiKey(input: { userId: number; label: string; keyPrefix: string; secretHash: string; rateLimitPerMinute: number; scopes?: string[] }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable.");
  const { scopes, ...values } = input;
  const result = await db.insert(developerApiKeys).values({ ...values, scopesJson: scopes?.length ? scopes : DEFAULT_DEVELOPER_SCOPES, status: "active" }).returning({ id: developerApiKeys.id });
  return result[0].id;
}

export async function findImageUploadByHash(sha256: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(imageUploads).where(eq(imageUploads.sha256, sha256)).limit(1);
  return rows[0];
}

export async function recordImageUpload(input: {
  apiKeyId: number;
  sha256: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  subject?: string;
  labels: Array<{ label: string; confidence: number; box: { x: number; y: number; width: number; height: number } }>;
}) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.insert(imageUploads)
    .values({ ...input, labelsJson: input.labels })
    // Same bytes, same row: the unique hash makes a re-upload idempotent rather than
    // an error, and the newer detection replaces the older one.
    .onConflictDoUpdate({ target: imageUploads.sha256, set: { subject: input.subject, labelsJson: input.labels } })
    .returning();
  return rows[0];
}

export async function listDeveloperApiKeysForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: developerApiKeys.id, label: developerApiKeys.label, keyPrefix: developerApiKeys.keyPrefix, scopesJson: developerApiKeys.scopesJson, status: developerApiKeys.status, rateLimitPerMinute: developerApiKeys.rateLimitPerMinute, lastUsedAt: developerApiKeys.lastUsedAt, expiresAt: developerApiKeys.expiresAt, createdAt: developerApiKeys.createdAt }).from(developerApiKeys).where(eq(developerApiKeys.userId, userId)).orderBy(desc(developerApiKeys.createdAt));
}

export async function revokeDeveloperApiKey(input: { id: number; userId: number }) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(developerApiKeys).set({ status: "revoked" }).where(and(eq(developerApiKeys.id, input.id), eq(developerApiKeys.userId, input.userId), eq(developerApiKeys.status, "active"))).returning({ id: developerApiKeys.id });
  return result.length > 0;
}

export async function getActiveDeveloperApiKeyByHash(secretHash: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(developerApiKeys).where(and(eq(developerApiKeys.secretHash, secretHash), eq(developerApiKeys.status, "active"))).limit(1);
  const key = result[0];
  return key && (!key.expiresAt || key.expiresAt > new Date()) ? key : undefined;
}

export async function touchDeveloperApiKey(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(developerApiKeys).set({ lastUsedAt: new Date() }).where(eq(developerApiKeys.id, id));
}

export type DeveloperUsageMetrics = { itemCount: number; matchCount: number; noMatchCount: number; unavailableCount: number; latencyMs: number; httpStatus: number };

export async function recordDeveloperApiUsage(input: DeveloperUsageMetrics & { apiKeyId: number }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(developerApiUsage).values(input);
}

export async function getDeveloperApiUsageSummaryForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    apiKeyId: developerApiKeys.id,
    label: developerApiKeys.label,
    keyPrefix: developerApiKeys.keyPrefix,
    requestCount: sql<number>`count(${developerApiUsage.id})`,
    itemCount: sql<number>`coalesce(sum(${developerApiUsage.itemCount}), 0)`,
    matchCount: sql<number>`coalesce(sum(${developerApiUsage.matchCount}), 0)`,
    noMatchCount: sql<number>`coalesce(sum(${developerApiUsage.noMatchCount}), 0)`,
    unavailableCount: sql<number>`coalesce(sum(${developerApiUsage.unavailableCount}), 0)`,
    avgLatencyMs: sql<number>`coalesce(round(avg(${developerApiUsage.latencyMs})), 0)`,
  }).from(developerApiKeys).leftJoin(developerApiUsage, eq(developerApiUsage.apiKeyId, developerApiKeys.id)).where(eq(developerApiKeys.userId, userId)).groupBy(developerApiKeys.id, developerApiKeys.label, developerApiKeys.keyPrefix).orderBy(desc(developerApiKeys.createdAt));
}

export async function listPoliciesForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(policies).where(eq(policies.userId, userId)).orderBy(desc(policies.updatedAt));
}

export async function getPolicyByIdForUser(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(policies).where(and(eq(policies.id, id), eq(policies.userId, userId))).limit(1);
  return result[0];
}

export async function createPolicyForUser(input: {
  userId: number;
  name: string;
  sourcePreference: string;
  language: string;
  action: PolicyAction;
  scopeText: boolean;
  scopeImages: boolean;
  rules: FirewallRule[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available.");
  const result = await db.insert(policies).values({
    ...input,
    rulesJson: input.rules,
  }).returning({ id: policies.id });
  return result[0].id;
}

export async function updatePolicyForUser(input: {
  id: number;
  userId: number;
  name: string;
  sourcePreference: string;
  language: string;
  action: PolicyAction;
  scopeText: boolean;
  scopeImages: boolean;
  rules: FirewallRule[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available.");
  await db.update(policies).set({
    name: input.name,
    sourcePreference: input.sourcePreference,
    language: input.language,
    action: input.action,
    scopeText: input.scopeText,
    scopeImages: input.scopeImages,
    rulesJson: input.rules,
    version: undefined,
  }).where(and(eq(policies.id, input.id), eq(policies.userId, input.userId)));
  const result = await db.select().from(policies).where(and(eq(policies.id, input.id), eq(policies.userId, input.userId))).limit(1);
  return result[0];
}

export async function recordCheckForUser(input: {
  userId: number;
  policyId?: number;
  inputType: InputType;
  inputValue: string;
  result: CheckResult;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(checkHistory).values({
    userId: input.userId,
    policyId: input.policyId,
    inputType: input.inputType,
    inputValue: input.inputValue.slice(0, 2000),
    decision: input.result.decision,
    confidence: Math.round(input.result.confidence * 100),
    reason: input.result.reason.slice(0, 255),
    cacheStatus: input.result.cacheStatus,
  });
}

export async function listCheckHistoryForUser(userId: number, limit = 8) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(checkHistory).where(eq(checkHistory.userId, userId)).orderBy(desc(checkHistory.createdAt)).limit(limit);
}
