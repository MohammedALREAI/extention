/**
 * Prints the model ids your configured gateway actually offers, so CF_MODEL_* can be
 * set to names that exist instead of guessed.
 *
 *   npx tsx scripts/list_models.ts          # everything
 *   npx tsx scripts/list_models.ts qwen     # only ids containing "qwen"
 */
import "dotenv/config";
import { listLLMModels } from "../server/_core/llm";
import { orderedModels, routePrefixes } from "../server/modelRouter";

const filter = (process.argv[2] || "").toLowerCase();
const { data } = await listLLMModels();
const ids = data.map(model => model.id).sort();
const shown = filter ? ids.filter(id => id.toLowerCase().includes(filter)) : ids;

console.log(`\n${shown.length} of ${ids.length} model(s)${filter ? ` matching "${filter}"` : ""}:\n`);
shown.forEach(id => console.log(`  ${id}`));

console.log("\nWhat the routes look for right now:");
(["visual", "semantic", "developer_moderation"] as const).forEach(route => {
  const prefixes = routePrefixes(route);
  // Must use the router's own matcher, not a second copy: a private startsWith here
  // reported NO MATCH for vendor-namespaced catalogs the router resolves fine.
  const matched = orderedModels(data, prefixes);
  console.log(`  ${route.padEnd(20)} ${matched.length ? matched.join(", ") : "NO MATCH — set the CF_MODEL_* variable for this route"}`);
});
console.log("\nThe visual route must be a model that accepts images.\n");
