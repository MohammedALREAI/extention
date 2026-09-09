/**
 * Mints a developer API key for local testing and prints ready-to-run requests.
 * The secret is shown once here because only its hash is stored.
 *
 *   npx tsx scripts/dev_api_key.ts
 */
import "dotenv/config";
import { users } from "../drizzle/schema";
import { createDeveloperApiKey, getDb, getUserByOpenId } from "../server/db";
import { createDeveloperApiSecret } from "../server/developerKeys";

const SEED_OPEN_ID = "local-dev-user";
const PORT = process.env.PORT || "3001";

const db = await getDb();
if (!db) throw new Error("DATABASE_URL is not set, so no key can be stored. See docs/local-development.md.");

let user = await getUserByOpenId(SEED_OPEN_ID);
if (!user) {
  await db.insert(users).values({ openId: SEED_OPEN_ID, name: "Local Dev", email: "dev@localhost", loginMethod: "seed" });
  user = await getUserByOpenId(SEED_OPEN_ID);
}
if (!user) throw new Error("Could not create the local user.");

const { secret, keyPrefix, secretHash } = createDeveloperApiSecret();
const id = await createDeveloperApiKey({ userId: user.id, label: "local testing", keyPrefix, secretHash, rateLimitPerMinute: 60 });

console.log(`\nDeveloper API key ${id} for user ${user.id}. Copy the secret now — only its hash is stored.\n`);
console.log(`  ${secret}\n`);
console.log("Detect (replace the data URL with a real image):\n");
console.log(`  curl -s http://localhost:${PORT}/api/v1/images/detect \\
    -H "Authorization: Bearer ${secret}" \\
    -H "Content-Type: application/json" \\
    -d '{"image":"data:image/jpeg;base64,<BASE64>","categories":["dog","cat"]}'\n`);
console.log("Fetch it back with the id the response returns:\n");
console.log(`  curl -s http://localhost:${PORT}/api/v1/images/<id>.jpg -H "Authorization: Bearer ${secret}" --output roundtrip.jpg\n`);
