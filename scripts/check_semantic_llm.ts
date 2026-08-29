import { evaluateSemantically } from "../server/semanticFirewall";

const evaluations = await evaluateSemantically({
  sourcePreference: "لا أريد مشاهدة كلاب",
  rules: [{ term: "كلب", action: "blur" }],
  results: [{ id: "dog-example", text: "Cat-and-Dog (2024): a movie about a dog and a cat escaping together." }],
});

console.log(JSON.stringify(evaluations, null, 2));
