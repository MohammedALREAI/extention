import { boolean, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  planCode: varchar("planCode", { length: 64 }).notNull().default("trial"),
  status: mysqlEnum("status", ["trial", "active", "expired", "cancelled"]).notNull().default("trial"),
  trialStartedAt: timestamp("trialStartedAt").notNull(),
  trialEndsAt: timestamp("trialEndsAt").notNull(),
  currentPeriodStart: timestamp("currentPeriodStart"),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").notNull().default(false),
  cancelledAt: timestamp("cancelledAt"),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("subscriptions_user_id_unique").on(table.userId)]);

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

export const policies = mysqlTable("policies", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  sourcePreference: text("sourcePreference").notNull(),
  language: varchar("language", { length: 8 }).notNull(),
  action: mysqlEnum("action", ["blur", "block", "warn"]).notNull(),
  scopeText: boolean("scopeText").notNull().default(true),
  scopeImages: boolean("scopeImages").notNull().default(true),
  rulesJson: json("rulesJson").$type<Array<{ term: string; action: "blur" | "block" | "warn" }>>().notNull(),
  version: int("version").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const checkHistory = mysqlTable("checkHistory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  policyId: int("policyId").references(() => policies.id, { onDelete: "set null" }),
  inputType: mysqlEnum("inputType", ["text", "image"]).notNull(),
  inputValue: text("inputValue").notNull(),
  decision: mysqlEnum("decision", ["allow", "blur", "block", "warn", "uncertain"]).notNull(),
  confidence: int("confidence").notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  cacheStatus: mysqlEnum("cacheStatus", ["fresh", "cached"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Policy = typeof policies.$inferSelect;
export type InsertPolicy = typeof policies.$inferInsert;
export type CheckHistory = typeof checkHistory.$inferSelect;

export const developerApiKeys = mysqlTable("developerApiKeys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 80 }).notNull(),
  keyPrefix: varchar("keyPrefix", { length: 24 }).notNull(),
  secretHash: varchar("secretHash", { length: 64 }).notNull(),
  scopesJson: json("scopesJson").$type<string[]>().notNull(),
  status: mysqlEnum("status", ["active", "revoked"]).notNull().default("active"),
  rateLimitPerMinute: int("rateLimitPerMinute").notNull().default(5),
  lastUsedAt: timestamp("lastUsedAt"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("developer_api_key_hash_unique").on(table.secretHash), uniqueIndex("developer_api_key_prefix_unique").on(table.keyPrefix)]);

export type DeveloperApiKey = typeof developerApiKeys.$inferSelect;

export const developerApiUsage = mysqlTable("developerApiUsage", {
  id: int("id").autoincrement().primaryKey(),
  apiKeyId: int("apiKeyId").notNull().references(() => developerApiKeys.id, { onDelete: "cascade" }),
  itemCount: int("itemCount").notNull(),
  matchCount: int("matchCount").notNull().default(0),
  noMatchCount: int("noMatchCount").notNull().default(0),
  unavailableCount: int("unavailableCount").notNull().default(0),
  latencyMs: int("latencyMs").notNull(),
  httpStatus: int("httpStatus").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("developer_api_usage_key_created_idx").on(table.apiKeyId, table.createdAt)]);

export type DeveloperApiUsage = typeof developerApiUsage.$inferSelect;
