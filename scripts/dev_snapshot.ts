/**
 * Prints a policy snapshot pointing at the local server, for use with CF_DEV_NO_AUTH=1.
 *
 * No database and no JWT secret are involved: with the bypass on, the server never
 * verifies the token, but the extension refuses to send anything without one, so a
 * placeholder with a future expiry is included.
 *
 *   npx tsx scripts/dev_snapshot.ts [term ...]
 */
import { toExtensionPolicySnapshot } from "../shared/extensionSnapshot";

const PORT = process.env.PORT || "3001";
const BASE = process.env.CF_EXTENSION_API_BASE || `http://localhost:${PORT}/api/extension`;
const terms = process.argv.slice(2).filter(Boolean);
const rules = (terms.length ? terms : String(process.env.CF_DEV_RULES || "dog").split(",").map(term => term.trim()).filter(Boolean))
  .map(term => ({ term, action: "blur" as const }));

const snapshot = toExtensionPolicySnapshot({
  id: 0,
  version: 1,
  language: "en",
  sourcePreference: `Do not show me: ${rules.map(rule => rule.term).join(", ")}`,
  scopeText: true,
  scopeImages: true,
  rules,
});
snapshot.revision = `dev-${Date.now()}`;
snapshot.semantic = {
  endpoint: `${BASE}/semantic-evaluate`,
  visualEndpoint: `${BASE}/visual-localize`,
  token: "dev-local-bypass",
  expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
};

console.log(`\nBlocking: ${rules.map(rule => rule.term).join(", ")}`);
console.log("The selected API must run with CF_DEV_NO_AUTH=1 and the same terms in CF_DEV_RULES.");
console.log("\nPaste into the extension → Protection rules → Import policy snapshot:\n");
console.log(JSON.stringify(snapshot, null, 2));
