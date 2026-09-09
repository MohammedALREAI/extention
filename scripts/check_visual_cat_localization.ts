import "dotenv/config";
import { localizeVisualMatches } from "../server/visualLocalization";

// The sample image is supplied by the environment so no deployment URL is baked in:
// CF_TEST_IMAGE_URL=https://your-host/path/mixed-dog-cat-test.jpg
const TEST_IMAGE_URL = process.env.CF_TEST_IMAGE_URL;
if (!TEST_IMAGE_URL) throw new Error("CF_TEST_IMAGE_URL is not set");

const detections = await localizeVisualMatches({
  sourcePreference: "لا أريد مشاهدة قطط",
  rules: [{ term: "قطط", action: "blur" }],
  images: [{ id: "dog-cat", url: TEST_IMAGE_URL }],
});

console.log(JSON.stringify(detections, null, 2));
