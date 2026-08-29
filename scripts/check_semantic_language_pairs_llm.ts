import { evaluateSemantically } from "../server/semanticFirewall";

const [englishToRussian, russianToSpanish] = await Promise.all([
  evaluateSemantically({
    sourcePreference: "I do not want to see dogs",
    rules: [{ term: "dogs", action: "warn" }],
    results: [{ id: "english-russian", text: "Новая семейная история о собаке и её приключениях." }],
  }),
  evaluateSemantically({
    sourcePreference: "Я не хочу видеть собак",
    rules: [{ term: "собак", action: "block" }],
    results: [{ id: "russian-spanish", text: "Una nueva película sobre un perro y su familia." }],
  }),
]);

console.log(JSON.stringify({ englishToRussian, russianToSpanish }, null, 2));
