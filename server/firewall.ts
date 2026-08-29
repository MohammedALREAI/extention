export type PolicyAction = "blur" | "block" | "warn";
export type Decision = "allow" | PolicyAction | "uncertain";
export type InputType = "text" | "image";

export type FirewallRule = {
  term: string;
  action: PolicyAction;
};

export type FirewallScope = {
  text: boolean;
  images: boolean;
};

export type ParsedPreference = {
  language: "ar" | "en";
  action: PolicyAction;
  rules: FirewallRule[];
  notes: string[];
};

export type CheckResult = {
  decision: Decision;
  confidence: number;
  reason: string;
  cacheStatus: "fresh" | "cached";
  matchedTerms: string[];
  uncertain: boolean;
};

const decisionCache = new Map<string, Omit<CheckResult, "cacheStatus">>();

const ACTION_MARKERS: Array<{ action: PolicyAction; markers: string[] }> = [
  { action: "block", markers: ["block", "hide", "don't show", "do not show", "احجب", "اخفي", "لا أريد", "لا اريد", "ممنوع"] },
  { action: "blur", markers: ["blur", "obscure", "طمس", "غبش", "ضبب"] },
  { action: "warn", markers: ["warn", "warning", "alert me", "حذر", "تحذير", "نبهني"] },
];

const ENGLISH_NOISE = /\b(i\s+(?:do\s+not|don't)\s+want\s+to\s+(?:see|view)|please|show\s+me|block|hide|blur|warn(?:\s+me)?|about|images?\s+of|text\s+about)\b/gi;
const ARABIC_NOISE = /(لا\s*أريد\s*(?:أن\s*)?(?:أرى|اشوف|أشوف|مشاهدة)?|لا\s*اريد\s*(?:ان\s*)?(?:ارى|اشوف|أشوف|مشاهدة)?|احجب|اخفي|أخفي|طمس|غبش|حذرني|نبهني|من\s*(?:مشاهدة|رؤية))/gi;

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function detectLanguage(value: string): "ar" | "en" {
  return /[\u0600-\u06FF]/.test(value) ? "ar" : "en";
}

function inferAction(value: string): PolicyAction {
  const normalized = value.toLocaleLowerCase();
  for (const option of ACTION_MARKERS) {
    if (option.markers.some(marker => normalized.includes(marker))) return option.action;
  }
  return "blur";
}

function extractTerms(preference: string, language: "ar" | "en"): string[] {
  const stripped = compact(
    preference
      .replace(language === "ar" ? ARABIC_NOISE : ENGLISH_NOISE, " ")
      .replace(/[.!?؟]/g, " ")
  );

  const separator = language === "ar" ? /(?:\s*[،,]\s*|\s+أو\s+|\s+و\s+)/ : /\s*(?:,|\band\b|\bor\b)\s*/i;
  const seen = new Set<string>();
  return stripped
    .split(separator)
    .map(part => compact(part.replace(/^(?:the|a|an)\s+/i, "")))
    .filter(term => term.length >= 2)
    .filter(term => {
      const key = term.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export function parsePreference(preference: string, requestedAction?: PolicyAction): ParsedPreference {
  const language = detectLanguage(preference);
  const action = requestedAction ?? inferAction(preference);
  const terms = extractTerms(preference, language);
  const notes = terms.length
    ? []
    : [language === "ar" ? "أضف موضوعاً واضحاً واحداً على الأقل، مثل: عنف أو قمار." : "Add at least one clear topic, such as violence or gambling."];

  return {
    language,
    action,
    rules: terms.map(term => ({ term, action })),
    notes,
  };
}

function normalize(value: string) {
  return compact(value.toLocaleLowerCase());
}

function cacheKey(rules: FirewallRule[], scope: FirewallScope, inputType: InputType, value: string) {
  const signature = rules
    .map(rule => `${normalize(rule.term)}:${rule.action}`)
    .sort()
    .join("|");
  return `${signature}::${scope.text}:${scope.images}::${inputType}::${normalize(value)}`;
}

export function evaluateCheck(input: {
  rules: FirewallRule[];
  scope: FirewallScope;
  inputType: InputType;
  value: string;
}): CheckResult {
  const key = cacheKey(input.rules, input.scope, input.inputType, input.value);
  const cached = decisionCache.get(key);
  if (cached) return { ...cached, cacheStatus: "cached" };

  const enabled = input.inputType === "text" ? input.scope.text : input.scope.images;
  const normalizedValue = normalize(input.value);
  const matched = enabled
    ? input.rules.filter(rule => normalizedValue.includes(normalize(rule.term)))
    : [];

  let result: Omit<CheckResult, "cacheStatus">;
  if (!enabled) {
    result = {
      decision: "allow",
      confidence: 1,
      reason: input.inputType === "text" ? "Text checks are disabled by this policy." : "Image URL checks are disabled by this policy.",
      matchedTerms: [],
      uncertain: false,
    };
  } else if (matched.length) {
    const strongest = matched.reduce((winner, rule) => {
      const order: Record<PolicyAction, number> = { block: 3, blur: 2, warn: 1 };
      return order[rule.action] > order[winner.action] ? rule : winner;
    });
    result = {
      decision: strongest.action,
      confidence: 0.96,
      reason: `Matched rule: “${strongest.term}”.`,
      matchedTerms: matched.map(rule => rule.term),
      uncertain: false,
    };
  } else if (input.inputType === "image") {
    result = {
      decision: "uncertain",
      confidence: 0,
      reason: "No rule matched the URL text. This MVP does not inspect remote image pixels, so the image is not marked safe.",
      matchedTerms: [],
      uncertain: true,
    };
  } else {
    result = {
      decision: "allow",
      confidence: 0.88,
      reason: "No enabled rule matched this text.",
      matchedTerms: [],
      uncertain: false,
    };
  }

  decisionCache.set(key, result);
  return { ...result, cacheStatus: "fresh" };
}

export function resetDecisionCache() {
  decisionCache.clear();
}
