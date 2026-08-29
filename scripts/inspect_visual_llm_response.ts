import { invokeLLM, listLLMModels } from "../server/_core/llm";

const { data } = await listLLMModels();
const model = data.find(entry => entry.id.startsWith("gemini-3-flash-preview"))?.id ?? data[0]?.id;
const response = await invokeLLM({
  model,
  maxTokens: 2_000,
  messages: [{ role: "user", content: [
    { type: "text", text: "Return JSON with one detection for the dog only. Schema: {detections:[{id:string,boxes:[{x:number,y:number,width:number,height:number,label:string,confidence:number}]}]}. The image id is dog-cat." },
    { type: "image_url", image_url: { url: "https://contfirewall-giyzqqgx.manus.space/manus-storage/mixed-dog-cat-test_bc71f115.jpg", detail: "low" } },
  ] }],
  response_format: { type: "json_object" },
});
console.log(JSON.stringify({ model, response }, null, 2));
