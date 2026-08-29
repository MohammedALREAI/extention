import { localizeVisualMatches } from "../server/visualLocalization";

const detections = await localizeVisualMatches({
  sourcePreference: "لا أريد مشاهدة قطط",
  rules: [{ term: "قطط", action: "blur" }],
  images: [{ id: "dog-cat", url: "https://contfirewall-giyzqqgx.manus.space/manus-storage/mixed-dog-cat-test_bc71f115.jpg" }],
});

console.log(JSON.stringify(detections, null, 2));
