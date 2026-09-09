import { boolean, index, integer, json, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = pgTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: serial("id").primaryKey(),
  /** OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: pgEnum("role", ["user", "admin"])("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * The entitlement record is the server-side source of truth for access.
 * Plan codes are varchar values so future plan catalog changes do not require
 * altering this core table; Stripe identifiers are reserved for the later
 * payment integration and never include card or payment-sensitive data.
 */
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  planCode: varchar("planCode", { length: 64 }).notNull().default("trial"),
  status: pgEnum("status", ["trial", "active", "expired", "cancelled"])("status").notNull().default("trial"),
  trialStartedAt: timestamp("trialStartedAt").notNull(),
  trialEndsAt: timestamp("trialEndsAt").notNull(),
  currentPeriodStart: timestamp("currentPeriodStart"),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").notNull().default(false),
  cancelledAt: timestamp("cancelledAt"),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, table => [uniqueIndex("subscriptions_user_id_unique").on(table.userId)]);

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

export const policies = pgTable("policies", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  sourcePreference: text("sourcePreference").notNull(),
  language: varchar("language", { length: 8 }).notNull(),
  action: pgEnum("action", ["blur", "block", "warn"])("action").notNull(),
  scopeText: boolean("scopeText").notNull().default(true),
  scopeImages: boolean("scopeImages").notNull().default(true),
  rulesJson: json("rulesJson").$type<Array<{ term: string; action: "blur" | "block" | "warn" }>>().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const checkHistory = pgTable("checkHistory", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  policyId: integer("policyId").references(() => policies.id, { onDelete: "set null" }),
  inputType: pgEnum("inputType", ["text", "image"])("inputType").notNull(),
  inputValue: text("inputValue").notNull(),
  decision: pgEnum("decision", ["allow", "blur", "block", "warn", "uncertain"])("decision").notNull(),
  confidence: integer("confidence").notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  cacheStatus: pgEnum("cacheStatus", ["fresh", "cached"])("cacheStatus").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Policy = typeof policies.$inferSelect;
export type InsertPolicy = typeof policies.$inferInsert;
export type CheckHistory = typeof checkHistory.$inferSelect;

export const developerApiKeys = pgTable("developerApiKeys", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 80 }).notNull(),
  keyPrefix: varchar("keyPrefix", { length: 24 }).notNull(),
  secretHash: varchar("secretHash", { length: 64 }).notNull(),
  scopesJson: json("scopesJson").$type<string[]>().notNull(),
  status: pgEnum("status", ["active", "revoked"])("status").notNull().default("active"),
  rateLimitPerMinute: integer("rateLimitPerMinute").notNull().default(5),
  lastUsedAt: timestamp("lastUsedAt"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, table => [uniqueIndex("developer_api_key_hash_unique").on(table.secretHash), uniqueIndex("developer_api_key_prefix_unique").on(table.keyPrefix)]);

export type DeveloperApiKey = typeof developerApiKeys.$inferSelect;

export const developerApiUsage = pgTable("developerApiUsage", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("apiKeyId").notNull().references(() => developerApiKeys.id, { onDelete: "cascade" }),
  itemCount: integer("itemCount").notNull(),
  matchCount: integer("matchCount").notNull().default(0),
  noMatchCount: integer("noMatchCount").notNull().default(0),
  unavailableCount: integer("unavailableCount").notNull().default(0),
  latencyMs: integer("latencyMs").notNull(),
  httpStatus: integer("httpStatus").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("developer_api_usage_key_created_idx").on(table.apiKeyId, table.createdAt)]);

export type DeveloperApiUsage = typeof developerApiUsage.$inferSelect;

/**
 * An image uploaded through the detection API and kept on local disk.
 * `sha256` is both the row's identity and the stored file's name, so re-uploading the
 * same bytes returns the existing detection instead of paying for a second one.
 */
export const imageUploads = pgTable("imageUploads", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("apiKeyId").notNull().references(() => developerApiKeys.id, { onDelete: "cascade" }),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  mimeType: varchar("mimeType", { length: 40 }).notNull(),
  byteSize: integer("byteSize").notNull(),
  width: integer("width"),
  height: integer("height"),
  subject: varchar("subject", { length: 80 }),
  labelsJson: json("labelsJson").$type<Array<{ label: string; confidence: number; box: { x: number; y: number; width: number; height: number } }>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [uniqueIndex("image_upload_sha256_unique").on(table.sha256)]);

export type ImageUpload = typeof imageUploads.$inferSelect;
