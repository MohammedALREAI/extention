export const developerOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Content Firewall Arabic Moderation API",
    version: "0.1.0-pilot",
    description: "Arabic-first, customer-rule moderation pilot. API keys are separate from Chrome extension tokens. A completed evaluation returns match or no_match; unavailable is explicit and must not be silently treated as allow.",
  },
  paths: {
    "/api/v1/moderate/text": {
      post: {
        summary: "Moderate up to 20 Arabic or multilingual text items against customer-defined rules.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ModerationRequest" } } } },
        responses: {
          "200": { description: "Completed batch. Individual results may be match, no_match, or unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/ModerationBatch" } } } },
          "400": { description: "Malformed or out-of-bounds policy/request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing, revoked, expired, or wrong-scope developer key.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "429": { description: "Pilot per-key rate limit reached.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/v1/images/detect": {
      post: {
        summary: "Store an uploaded image locally, name its main subject, and locate any of the requested categories in it.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ImageDetectionRequest" } } } },
        responses: {
          "200": { description: "Image stored and analysed. Boxes are normalized to a 1000x1000 space.", content: { "application/json": { schema: { $ref: "#/components/schemas/ImageDetection" } } } },
          "400": { description: "Not a data URL, over the 6 MB limit, or the bytes are not a supported image.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing, revoked, expired, or wrong-scope developer key.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "429": { description: "Per-key rate limit reached.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "502": { description: "Detection could not be completed for this image.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/v1/images/{name}": {
      get: {
        summary: "Fetch a previously stored image by the id returned from detection, suffixed with its extension.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string", pattern: "^[a-f0-9]{64}\\.(png|jpg|gif|webp)$" } }],
        responses: {
          "200": { description: "The original stored bytes.", content: { "image/*": { schema: { type: "string", format: "binary" } } } },
          "400": { description: "The name is not a stored image id.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing, revoked, expired, or wrong-scope developer key.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "404": { description: "No stored image with that id.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "cfk_ pilot API key" } },
    schemas: {
      Rule: { type: "object", additionalProperties: false, required: ["label", "description", "action"], properties: { label: { type: "string", minLength: 1, maxLength: 80 }, description: { type: "string", minLength: 1, maxLength: 500 }, action: { type: "string", enum: ["mask", "review", "block"] } } },
      Policy: { type: "object", additionalProperties: false, required: ["revision", "description", "rules"], properties: { revision: { type: "string", minLength: 1, maxLength: 100 }, description: { type: "string", minLength: 1, maxLength: 1500 }, rules: { type: "array", minItems: 1, maxItems: 12, items: { $ref: "#/components/schemas/Rule" } } } },
      Item: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: { type: "string", minLength: 1, maxLength: 80 }, text: { type: "string", minLength: 2, maxLength: 5000 }, language: { type: "string", maxLength: 16, description: "Optional BCP-47-style hint; it is not stored in pilot usage telemetry." } } },
      ModerationRequest: { type: "object", additionalProperties: false, required: ["policy", "items"], properties: { policy: { $ref: "#/components/schemas/Policy" }, items: { type: "array", minItems: 1, maxItems: 20, items: { $ref: "#/components/schemas/Item" } } } },
      ModerationResult: { type: "object", additionalProperties: false, required: ["id", "state", "action", "labels", "confidence", "reason"], properties: { id: { type: "string" }, state: { type: "string", enum: ["match", "no_match", "unavailable"] }, action: { type: ["string", "null"], enum: ["mask", "review", "block", null] }, labels: { type: "array", maxItems: 4, items: { type: "string", maxLength: 80 } }, confidence: { type: "number", minimum: 0, maximum: 1 }, reason: { type: "string", maxLength: 255 } } },
      ModerationBatch: { type: "object", additionalProperties: false, required: ["object", "policyRevision", "results"], properties: { object: { const: "moderation.batch" }, policyRevision: { type: "string" }, results: { type: "array", items: { $ref: "#/components/schemas/ModerationResult" } } } },
      ImageDetectionRequest: { type: "object", additionalProperties: false, required: ["image"], properties: { image: { type: "string", description: "Base64 data URL, for example data:image/png;base64,iVBORw0... The declared type is checked against the actual bytes and a mismatch is rejected.", maxLength: 8_400_000 }, categories: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 2, maxLength: 40 }, description: "Categories to locate. Omit to use the built-in list." } } },
      DetectedCategory: { type: "object", additionalProperties: false, required: ["label", "confidence", "box"], properties: { label: { type: "string", maxLength: 80 }, confidence: { type: "number", minimum: 0, maximum: 1 }, box: { type: "object", additionalProperties: false, required: ["x", "y", "width", "height"], properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } } } } },
      StoredImage: { type: "object", required: ["id", "mimeType", "bytes", "url"], properties: { id: { type: "string", description: "SHA-256 of the stored bytes; identical uploads return the same id.", pattern: "^[a-f0-9]{64}$" }, mimeType: { type: "string" }, bytes: { type: "integer" }, width: { type: "integer" }, height: { type: "integer" }, url: { type: "string" }, storedAt: { type: ["string", "null"], format: "date-time" } } },
      ImageDetection: { type: "object", additionalProperties: false, required: ["object", "image", "subject", "categories"], properties: { object: { const: "image.detection" }, image: { $ref: "#/components/schemas/StoredImage" }, subject: { type: ["string", "null"], description: "Open-ended main subject of the image, independent of the categories.", maxLength: 80 }, categories: { type: "array", items: { $ref: "#/components/schemas/DetectedCategory" } } } },
      Error: { type: "object", additionalProperties: false, required: ["error"], properties: { error: { type: "object", additionalProperties: false, required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } } },
    },
  },
} as const;
