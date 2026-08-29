import { evaluateSemantically } from "../server/semanticFirewall";

const evaluations = await evaluateSemantically({
  sourcePreference: "No quiero ver perros",
  rules: [{ term: "perros", action: "block" }],
  results: [{ id: "russian-dog", text: "Новая семейная история о собаке и её приключениях." }],
});

console.log(JSON.stringify(evaluations, null, 2));
