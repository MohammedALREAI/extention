import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("developer API usage ledger schema", () => {
  it("uses a non-unique key/time index so concurrent API requests are never rejected by timestamp collision", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
    const migration = readFileSync(resolve(process.cwd(), "drizzle/0005_overrated_scorpion.sql"), "utf8");
    expect(schema).toContain('index("developer_api_usage_key_created_idx")');
    expect(schema).not.toContain('uniqueIndex("developer_api_usage_key_created_unique")');
    expect(migration.indexOf("CREATE INDEX")).toBeLessThan(migration.indexOf("DROP INDEX"));
  });
});
