import { invokeLLM, listLLMModels } from "../server/_core/llm";
import { semanticPrompt } from "../server/semanticFirewall";

const { data } = await listLLMModels();
const model = data.find(entry => entry.id.startsWith("claude-haiku-4-5"))?.id ?? data[0]?.id;
const response = await invokeLLM({
  model,
  maxTokens: 240,
  messages: [{ role: "user", content: semanticPrompt({
    sourcePreference: "لا أريد مشاهدة كلاب",
    rules: [{ term: "كلب", action: "blur" }],
    results: [{ id: "dog-example", text: "Cat-and-Dog (2024): a movie about a dog and a cat escaping together." }],
  }) }],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "inspect_semantic_response",
      strict: true,
      schema: {
        type: "object",
        properties: {
          evaluations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                decision: { type: "string", enum: ["allow", "blur", "block", "warn"] },
                confidence: { type: "number" },
                reason: { type: "string" },
              },
              required: ["id", "decision", "confidence", "reason"],
              additionalProperties: false,
            },
          },
        },
        required: ["evaluations"],
        additionalProperties: false,
      },
    },
  },
});

console.log(JSON.stringify({ model, choice: response.choices[0] }, null, 2));
