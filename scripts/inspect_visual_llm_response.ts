import "dotenv/config";
import { invokeLLM, listLLMModels } from "../server/_core/llm";

// The sample image is supplied by the environment so no deployment URL is baked in:
// CF_TEST_IMAGE_URL=https://your-host/path/mixed-dog-cat-test.jpg
const TEST_IMAGE_URL = process.env.CF_TEST_IMAGE_URL;
if (!TEST_IMAGE_URL) throw new Error("CF_TEST_IMAGE_URL is not set");

const { data } = await listLLMModels();
const model = data.find(entry => entry.id.startsWith("gemini-3-flash-preview"))?.id ?? data[0]?.id;
const response = await invokeLLM({
  model,
  maxTokens: 2_000,
  messages: [{ role: "user", content: [
    { type: "text", text: "Return JSON with one detection for the dog only. Schema: {detections:[{id:string,boxes:[{x:number,y:number,width:number,height:number,label:string,confidence:number}]}]}. The image id is dog-cat." },
    { type: "image_url", image_url: { url: TEST_IMAGE_URL, detail: "low" } },
  ] }],
  response_format: { type: "json_object" },
});
console.log(JSON.stringify({ model, response }, null, 2));
