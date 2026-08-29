export type ExtensionSnapshotAction = "blur" | "block" | "warn";

export type ExtensionPolicySnapshot = {
  schemaVersion: 1;
  revision: string;
  enabled: boolean;
  locale: string;
  sourcePreference: string;
  scope: { text: boolean; images: boolean };
  rules: Array<{ term: string; action: ExtensionSnapshotAction }>;
  semantic?: { endpoint: string; visualEndpoint?: string; token: string; expiresAt: number };
};

export function toExtensionPolicySnapshot(input: {
  id: number;
  version: number;
  language: string;
  sourcePreference: string;
  scopeText: boolean;
  scopeImages: boolean;
  rules: Array<{ term: string; action: ExtensionSnapshotAction }>;
}): ExtensionPolicySnapshot {
  return {
    schemaVersion: 1,
    revision: `app-${input.id}-v${input.version}`,
    enabled: true,
    locale: input.language,
    sourcePreference: input.sourcePreference,
    scope: { text: input.scopeText, images: input.scopeImages },
    rules: input.rules.map(rule => ({ term: rule.term.normalize("NFC").trim(), action: rule.action })),
  };
}
