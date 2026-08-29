import { createHash, randomBytes } from "node:crypto";

export function hashDeveloperApiKey(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function createDeveloperApiSecret() {
  const secret = `cfk_${randomBytes(24).toString("base64url")}`;
  return { secret, keyPrefix: secret.slice(0, 16), secretHash: hashDeveloperApiKey(secret) };
}

export function readBearerApiKey(value: string | undefined) {
  const token = value?.replace(/^Bearer\s+/i, "").trim() || "";
  return token.startsWith("cfk_") && token.length <= 200 ? token : undefined;
}
