/**
 * Seeds the minimum a local extension test needs: one user, one trial
 * subscription, one policy — then prints the snapshot to paste into the
 * extension's Protection rules.
 *
 * The extension API checks user → subscription → policy on every call, so all
 * three rows must exist before a single image can be analysed locally.
 *
 *   npx tsx scripts/seed_local.ts [term ...]
 *
 * Safe to re-run: it reuses the seeded user and replaces its policy.
 */
import { and, eq } from "drizzle-orm";
import { policies, subscriptions, users } from "../drizzle/schema";
import { getDb, ensureTrialSubscriptionForUser, getUserByOpenId } from "../server/db";
import { createExtensionAccessToken } from "../server/extensionSemanticApi";
import { toExtensionPolicySnapshot } from "../shared/extensionSnapshot";

const SEED_OPEN_ID = "local-dev-user";
const PORT = process.env.PORT || "3001";
const BASE = `http://localhost:${PORT}/api/extension`;

const terms = process.argv.slice(2).filter(Boolean);
const rules = (terms.length ? terms : ["dog"]).map(term => ({ term, action: "blur" as const }));

const db = await getDb();
if (!db) throw new Error("DATABASE_URL is not set, so there is no database to seed.");

let user = await getUserByOpenId(SEED_OPEN_ID);
if (!user) {
  await db.insert(users).values({ openId: SEED_OPEN_ID, name: "Local Dev", email: "dev@localhost", loginMethod: "seed" });
  user = await getUserByOpenId(SEED_OPEN_ID);
}
if (!user) throw new Error("Seed user could not be created.");

// A trial that is already running, so getSubscriptionSummaryForUser reports access.
const trialStartedAt = new Date();
const trialEndsAt = new Date(trialStartedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
await ensureTrialSubscriptionForUser(user.id, trialStartedAt, trialEndsAt);
await db.update(subscriptions).set({ status: "trial", trialStartedAt, trialEndsAt }).where(eq(subscriptions.userId, user.id));

await db.delete(policies).where(and(eq(policies.userId, user.id), eq(policies.name, "Local dev policy")));
const inserted = await db.insert(policies).values({
  userId: user.id,
  name: "Local dev policy",
  sourcePreference: `Do not show me: ${rules.map(rule => rule.term).join(", ")}`,
  language: "en",
  action: "blur",
  scopeText: true,
  scopeImages: true,
  rulesJson: rules,
});
const policyId = Number(inserted[0].insertId);

const access = createExtensionAccessToken(policyId, user.id);
const snapshot = toExtensionPolicySnapshot({
  id: policyId,
  version: 1,
  language: "en",
  sourcePreference: `Do not show me: ${rules.map(rule => rule.term).join(", ")}`,
  scopeText: true,
  scopeImages: true,
  rules,
});
snapshot.semantic = { endpoint: `${BASE}/semantic-evaluate`, visualEndpoint: `${BASE}/visual-localize`, ...access };

console.log(`\nSeeded user ${user.id}, policy ${policyId}, blocking: ${rules.map(rule => rule.term).join(", ")}`);
console.log("\nPaste this into the extension's Protection rules → Import policy snapshot:\n");
console.log(JSON.stringify(snapshot, null, 2));
