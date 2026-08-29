import { startLogin } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toExtensionPolicySnapshot } from "@shared/extensionSnapshot";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Globe2,
  Image as ImageIcon,
  Layers3,
  Loader2,
  LockKeyhole,
  Plus,
  Radar,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

type UiLanguage = "en" | "ar";
type Action = "blur" | "block" | "warn";
type Rule = { term: string; action: Action };
type InputType = "text" | "image";
type CheckView = {
  decision: "allow" | Action | "uncertain";
  confidence: number;
  reason: string;
  cacheStatus: "fresh" | "cached";
  matchedTerms: string[];
  uncertain: boolean;
};

const copy = {
  en: {
    nav: ["Setup", "Test space", "My policies"],
    developer: "Developer API",
    status: "Local-first protection",
    signIn: "Sign in to save",
    signOut: "Sign out",
    eyebrow: "YOUR CONTENT. YOUR BOUNDARIES.",
    title: "A quieter, safer web — on your terms.",
    lead: "Describe what you prefer not to encounter. We turn it into clear, editable rules before anything is filtered.",
    trustA: "Rules run before heavier checks",
    trustB: "Uncertain images stay transparent",
    trustC: "Your policies follow your account",
    setup: "01 · Preference setup",
    setupTitle: "Say it naturally. Keep control.",
    setupText: "Write in Arabic or English. The starter parser creates rules you can review and change — it never hides the logic from you.",
    preferenceLabel: "What would you like to filter?",
    preferenceHint: "Example: I don't want to see gambling or graphic violence",
    parse: "Create editable rules",
    parsing: "Reading preference…",
    actionLabel: "Default action",
    scopeLabel: "Apply rules to",
    textScope: "Text",
    imageScope: "Image URLs",
    rulesTitle: "Editable rules",
    rulesHint: "A rule only matches when its term appears in the tested text or image URL.",
    addRule: "Add rule",
    noRules: "Create rules from your preference or add one manually.",
    policyName: "Policy name",
    policyPlaceholder: "My safer feed",
    save: "Save policy",
    update: "Update policy",
    saving: "Saving…",
    signInSave: "Sign in to save your policy",
    testKicker: "02 · Test space",
    testTitle: "See the decision before you rely on it.",
    testText: "Run a quick check with the same rules. Repeated inputs are served from the instant rule cache.",
    pasteText: "Paste text to check",
    imageUrl: "Paste an image URL to check",
    testPlaceholder: "Try: A guide to gambling offers and casino bonuses",
    urlPlaceholder: "https://example.com/image.jpg",
    runTest: "Run protection check",
    running: "Checking…",
    resultsTitle: "Protection decision",
    resultsEmpty: "Your result will explain exactly what matched — or why a check remains uncertain.",
    confidence: "Confidence",
    reason: "Reason",
    cache: "Cache",
    matched: "Matched rules",
    noMatch: "No matching rule",
    cached: "Instant cache hit",
    fresh: "Fresh evaluation",
    uncertainLabel: "Needs visual review",
    uncertainNote: "This app has not inspected remote image pixels. An unmatched image URL is never shown as safe by default.",
    policiesKicker: "03 · Continuity",
    policiesTitle: "Your saved guardrails",
    policiesText: "Sign in once and keep your policies and recent checks across sessions.",
    policyCount: "saved policies",
    recentChecks: "Recent checks",
    noPolicies: "No saved policies yet.",
    noHistory: "Checks completed while signed in appear here.",
    usePolicy: "Use this policy",
    copyExtension: "Copy for Chrome",
    active: "Active",
    edit: "Edit",
    enabled: "Enabled",
    signedOutTitle: "Take the rules with you.",
    signedOutText: "You can build and test rules now. Sign in when you want policies and history to persist.",
    cta: "Sign in securely",
    allow: "Allow",
    blur: "Blur",
    block: "Block",
    warn: "Warn",
    uncertain: "Uncertain",
    loading: "Loading your workspace…",
    parserNote: "The MVP parser handles clear Arabic and English topics. Review every rule before saving.",
    reset: "New policy",
    validation: "Add at least one rule before testing or saving.",
    downloadExtension: "Download Chrome extension v1.0.9",
  },
  ar: {
    nav: ["الإعداد", "مساحة الاختبار", "سياساتي"],
    developer: "واجهة المطور",
    status: "حماية تبدأ محلياً",
    signIn: "سجّل الدخول للحفظ",
    signOut: "تسجيل الخروج",
    eyebrow: "محتواك. حدودك.",
    title: "ويب أهدأ وأكثر أماناً — حسب ما تختار.",
    lead: "اكتب ما لا ترغب برؤيته بطريقتك. نحوله إلى قواعد واضحة وقابلة للتعديل قبل تطبيق أي حماية.",
    trustA: "القواعد السريعة تعمل قبل الفحوص الثقيلة",
    trustB: "الصور غير المؤكدة تظهر بشفافية",
    trustC: "سياساتك تبقى مع حسابك",
    setup: "٠١ · إعداد التفضيل",
    setupTitle: "قل ما تريده بطبيعية، وابقَ المتحكم.",
    setupText: "اكتب بالعربية أو الإنجليزية. المحلل الأولي ينشئ قواعد تراجعها وتعدلها؛ المنطق واضح دائماً أمامك.",
    preferenceLabel: "ما المحتوى الذي تود تصفيته؟",
    preferenceHint: "مثال: لا أريد مشاهدة عنف مصور أو قمار",
    parse: "إنشاء قواعد قابلة للتعديل",
    parsing: "جارٍ فهم التفضيل…",
    actionLabel: "الإجراء الافتراضي",
    scopeLabel: "طبّق القواعد على",
    textScope: "النصوص",
    imageScope: "روابط الصور",
    rulesTitle: "قواعد قابلة للتعديل",
    rulesHint: "تتطابق القاعدة فقط عند ظهور عبارتها في النص المختبر أو رابط الصورة.",
    addRule: "إضافة قاعدة",
    noRules: "أنشئ القواعد من التفضيل أو أضف قاعدة يدوياً.",
    policyName: "اسم السياسة",
    policyPlaceholder: "محتوى أهدأ",
    save: "حفظ السياسة",
    update: "تحديث السياسة",
    saving: "جارٍ الحفظ…",
    signInSave: "سجّل الدخول لحفظ السياسة",
    testKicker: "٠٢ · مساحة الاختبار",
    testTitle: "اعرف القرار قبل أن تعتمد عليه.",
    testText: "اختبر القواعد نفسها فوراً. الإدخالات المتكررة تعمل من مخبأ القواعد السريع.",
    pasteText: "الصق النص المطلوب فحصه",
    imageUrl: "الصق رابط صورة لفحصه",
    testPlaceholder: "جرّب: دليل عروض القمار ومكافآت الكازينو",
    urlPlaceholder: "https://example.com/image.jpg",
    runTest: "تنفيذ فحص الحماية",
    running: "جارٍ الفحص…",
    resultsTitle: "قرار الحماية",
    resultsEmpty: "ستوضح النتيجة ما الذي تطابق بالضبط، أو سبب بقاء الفحص غير مؤكد.",
    confidence: "مستوى الثقة",
    reason: "السبب",
    cache: "المخبأ",
    matched: "القواعد المطابقة",
    noMatch: "لا توجد قاعدة مطابقة",
    cached: "نتيجة فورية من المخبأ",
    fresh: "تقييم جديد",
    uncertainLabel: "يحتاج مراجعة بصرية",
    uncertainNote: "لم يفحص هذا التطبيق بكسلات الصورة البعيدة. رابط صورة لم يطابق قاعدة لا يُعرض آمناً افتراضياً.",
    policiesKicker: "٠٣ · الاستمرارية",
    policiesTitle: "حواجزك المحفوظة",
    policiesText: "سجل الدخول مرة واحدة واحتفظ بسياساتك وسجل فحوصاتك عبر الجلسات.",
    policyCount: "سياسات محفوظة",
    recentChecks: "الفحوصات الأخيرة",
    noPolicies: "لا توجد سياسات محفوظة بعد.",
    noHistory: "ستظهر هنا الفحوصات التي تنفذها بعد تسجيل الدخول.",
    usePolicy: "استخدم هذه السياسة",
    copyExtension: "نسخ لإضافة Chrome",
    active: "نشطة",
    edit: "تعديل",
    enabled: "مفعل",
    signedOutTitle: "خذ قواعدك معك.",
    signedOutText: "يمكنك بناء القواعد واختبارها الآن. سجّل الدخول عندما تريد حفظ السياسات والسجل.",
    cta: "تسجيل دخول آمن",
    allow: "سماح",
    blur: "طمس",
    block: "حجب",
    warn: "تحذير",
    uncertain: "غير مؤكد",
    loading: "جارٍ تحميل مساحة العمل…",
    parserNote: "يدعم محلل النسخة الأولى الموضوعات العربية والإنجليزية الواضحة. راجع كل قاعدة قبل حفظها.",
    reset: "سياسة جديدة",
    validation: "أضف قاعدة واحدة على الأقل قبل الاختبار أو الحفظ.",
    downloadExtension: "تنزيل إضافة Chrome الإصدار 1.0.9",
  },
} as const;

const actionAppearance: Record<Action | "allow" | "uncertain", { icon: typeof Eye; tone: string }> = {
  allow: { icon: CheckCircle2, tone: "allow" },
  blur: { icon: EyeOff, tone: "blur" },
  block: { icon: ShieldCheck, tone: "block" },
  warn: { icon: TriangleAlert, tone: "warn" },
  uncertain: { icon: CircleHelp, tone: "uncertain" },
};

function initials(name?: string | null) {
  return name?.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase() || "CF";
}

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("en");
  const [preference, setPreference] = useState("I don't want to see gambling or graphic violence");
  const [policyName, setPolicyName] = useState("My safer feed");
  const [action, setAction] = useState<Action>("blur");
  const [scope, setScope] = useState({ text: true, images: true });
  const [rules, setRules] = useState<Rule[]>([]);
  const [testType, setTestType] = useState<InputType>("text");
  const [testValue, setTestValue] = useState("A quick guide to gambling offers and casino bonuses.");
  const [result, setResult] = useState<CheckView | null>(null);
  const [activePolicyId, setActivePolicyId] = useState<number | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const t = copy[uiLanguage];
  const utils = trpc.useUtils();

  const policiesQuery = trpc.firewall.policies.list.useQuery(undefined, { enabled: isAuthenticated });
  const historyQuery = trpc.firewall.history.useQuery({ limit: 6 }, { enabled: isAuthenticated });
  const parseMutation = trpc.firewall.parsePreference.useMutation({
    onSuccess: parsed => {
      setRules(parsed.rules);
      setAction(parsed.action);
      setUiLanguage(parsed.language);
      if (parsed.notes.length) setNotice(parsed.notes[0]);
      else setNotice(null);
    },
  });
  const evaluateMutation = trpc.firewall.evaluate.useMutation({
    onSuccess: check => {
      setResult(check);
      if (isAuthenticated) void utils.firewall.history.invalidate();
    },
  });
  const createMutation = trpc.firewall.policies.create.useMutation({
    onSuccess: async data => {
      setActivePolicyId(data.id);
      setNotice(uiLanguage === "ar" ? "تم حفظ السياسة في حسابك." : "Policy saved to your account.");
      await utils.firewall.policies.invalidate();
    },
  });
  const updateMutation = trpc.firewall.policies.update.useMutation({
    onSuccess: async () => {
      setNotice(uiLanguage === "ar" ? "تم تحديث السياسة." : "Policy updated.");
      await utils.firewall.policies.invalidate();
    },
  });
  const extensionAccessMutation = trpc.firewall.policies.extensionAccess.useMutation();

  const currentPolicy = useMemo(
    () => policiesQuery.data?.find(policy => policy.id === activePolicyId),
    [activePolicyId, policiesQuery.data]
  );

  function parseRules() {
    setNotice(null);
    parseMutation.mutate({ preference, requestedAction: action });
  }

  function updateRule(index: number, patch: Partial<Rule>) {
    setRules(current => current.map((rule, position) => position === index ? { ...rule, ...patch } : rule));
  }

  function addRule() {
    setRules(current => [...current, { term: "", action }]);
  }

  function removeRule(index: number) {
    setRules(current => current.filter((_, position) => position !== index));
  }

  function validatedRules() {
    return rules.map(rule => ({ ...rule, term: rule.term.trim() })).filter(rule => rule.term.length >= 2);
  }

  function savePolicy() {
    const preparedRules = validatedRules();
    if (!preparedRules.length) return setNotice(t.validation);
    const payload = {
      name: policyName.trim() || t.policyPlaceholder,
      sourcePreference: preference.trim(),
      language: uiLanguage,
      action,
      scope,
      rules: preparedRules,
    };
    if (activePolicyId) updateMutation.mutate({ id: activePolicyId, ...payload });
    else createMutation.mutate(payload);
  }

  function runTest() {
    const preparedRules = validatedRules();
    if (!preparedRules.length) return setNotice(t.validation);
    setNotice(null);
    evaluateMutation.mutate({
      policyId: activePolicyId,
      rules: preparedRules,
      scope,
      inputType: testType,
      value: testValue.trim(),
    });
  }

  function loadPolicy(policy: NonNullable<typeof policiesQuery.data>[number]) {
    setActivePolicyId(policy.id);
    setPolicyName(policy.name);
    setPreference(policy.sourcePreference);
    setUiLanguage(policy.language === "ar" ? "ar" : "en");
    setAction(policy.action);
    setScope({ text: policy.scopeText, images: policy.scopeImages });
    setRules(policy.rulesJson as Rule[]);
    setResult(null);
    setNotice(uiLanguage === "ar" ? "تم تحميل السياسة للتعديل." : "Policy loaded for editing.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copyPolicyForExtension(policy: NonNullable<typeof policiesQuery.data>[number]) {
    const access = await extensionAccessMutation.mutateAsync({ id: policy.id });
    const snapshot = toExtensionPolicySnapshot({
      id: policy.id,
      version: policy.version,
      language: policy.language,
      sourcePreference: policy.sourcePreference,
      scopeText: policy.scopeText,
      scopeImages: policy.scopeImages,
      rules: policy.rulesJson as Rule[],
    });
    snapshot.semantic = access;
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setNotice(uiLanguage === "ar" ? "تم نسخ السياسة. الصقها في إعدادات إضافة Chrome." : "Policy copied. Paste it into Chrome extension settings.");
    } catch {
      setNotice(uiLanguage === "ar" ? "تعذر النسخ. حاول مرة أخرى من متصفح يسمح بالوصول إلى الحافظة." : "Copy failed. Try again in a browser that allows clipboard access.");
    }
  }

  function newPolicy() {
    setActivePolicyId(undefined);
    setPolicyName(uiLanguage === "ar" ? "محتوى أهدأ" : "My safer feed");
    setPreference(uiLanguage === "ar" ? "لا أريد مشاهدة عنف مصور أو قمار" : "I don't want to see gambling or graphic violence");
    setAction("blur");
    setScope({ text: true, images: true });
    setRules([]);
    setResult(null);
    setNotice(null);
  }

  if (loading) {
    return <div className="loading-screen"><Radar className="spin" /><span>{t.loading}</span></div>;
  }

  const visualResult = result && actionAppearance[result.decision];
  const ResultIcon = visualResult?.icon ?? ShieldCheck;
  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="app-shell" dir={uiLanguage === "ar" ? "rtl" : "ltr"}>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Content Firewall home">
          <span className="brand-mark"><ShieldCheck size={18} strokeWidth={2.6} /></span>
          <span>content<span>firewall</span></span>
        </a>
        <nav className="top-nav" aria-label="Page sections">
          <a href="#setup">{t.nav[0]}</a>
          <a href="#test">{t.nav[1]}</a>
          <a href="#policies">{t.nav[2]}</a>
        </nav>
        <div className="header-actions">
          <Link className="tutorial-link" href="/developer"><CircleHelp size={15} />{t.developer}</Link>
          <Link className="tutorial-link" href="/account"><CircleHelp size={15} />{uiLanguage === "ar" ? "الحساب" : "Account"}</Link>
          <Link className="tutorial-link" href="/tutorial"><CircleHelp size={15} />{uiLanguage === "ar" ? "بدء الدليل" : "Tutorial Start"}</Link>
          <button className="language-toggle" onClick={() => setUiLanguage(current => current === "en" ? "ar" : "en")} aria-label="Switch language">
            <Globe2 size={15} /> <span>{uiLanguage === "en" ? "العربية" : "English"}</span>
          </button>
          {isAuthenticated ? (
            <button className="profile-chip" onClick={logout} title={t.signOut}>
              <span>{initials(user?.name)}</span><span className="profile-name">{user?.name || "Account"}</span>
            </button>
          ) : (
            <Button className="sign-in-button" onClick={() => startLogin()}><LockKeyhole size={15} />{t.signIn}</Button>
          )}
        </div>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow"><span className="pulse-dot" />{t.status}</div>
            <p className="hero-kicker">{t.eyebrow}</p>
            <h1>{t.title}</h1>
            <p className="hero-lead">{t.lead}</p>
            <div className="trust-row">
              {[t.trustA, t.trustB, t.trustC].map((item, index) => <span key={item}><CheckCircle2 size={15} />{item}{index < 2 && <i />}</span>)}
            </div>
          </div>
          <div className="hero-signal-card" aria-label="How protection is evaluated">
            <div className="signal-card-top"><span>{uiLanguage === "ar" ? "سلسلة قرار واضحة" : "Clear decision chain"}</span><Zap size={16} /></div>
            <div className="signal-step active"><span className="step-number">01</span><div><b>{uiLanguage === "ar" ? "قواعد فورية" : "Instant rules"}</b><small>{uiLanguage === "ar" ? "مطابقة محلية سريعة" : "Fast local matching"}</small></div><CheckCircle2 size={17} /></div>
            <div className="signal-connector" />
            <div className="signal-step"><span className="step-number">02</span><div><b>{uiLanguage === "ar" ? "نتيجة قابلة للتفسير" : "Explainable result"}</b><small>{uiLanguage === "ar" ? "سبب وثقة واضحة" : "Reason & confidence shown"}</small></div><Eye size={17} /></div>
            <div className="signal-connector" />
            <div className="signal-step careful"><span className="step-number">03</span><div><b>{uiLanguage === "ar" ? "لا تخمين صامت" : "No silent guessing"}</b><small>{uiLanguage === "ar" ? "الصورة غير المؤكدة تبقى واضحة" : "Uncertain image checks are flagged"}</small></div><AlertTriangle size={17} /></div>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="setup-panel" id="setup">
            <div className="section-heading">
              <span className="section-kicker">{t.setup}</span>
              <h2>{t.setupTitle}</h2>
              <p>{t.setupText}</p>
            </div>
            <div className="form-field">
              <div className="label-row"><label htmlFor="preference">{t.preferenceLabel}</label><span>{uiLanguage === "ar" ? "العربية والإنجليزية مدعومتان" : "Arabic & English supported"}</span></div>
              <Textarea id="preference" value={preference} onChange={event => setPreference(event.target.value)} placeholder={t.preferenceHint} className="preference-input" />
              <div className="field-footer"><span><Sparkles size={14} />{t.parserNote}</span><Button onClick={parseRules} disabled={parseMutation.isPending || preference.trim().length < 3} className="parse-button">{parseMutation.isPending ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}{parseMutation.isPending ? t.parsing : t.parse}</Button></div>
            </div>

            <div className="control-grid">
              <div className="control-card">
                <label>{t.actionLabel}</label>
                <div className="segmented-control" role="group" aria-label={t.actionLabel}>
                  {(["blur", "block", "warn"] as Action[]).map(option => <button key={option} className={action === option ? `selected ${option}` : ""} onClick={() => setAction(option)}>{t[option]}</button>)}
                </div>
              </div>
              <div className="control-card scope-card">
                <label>{t.scopeLabel}</label>
                <div className="scope-list">
                  <label><FileText size={15} /><span>{t.textScope}</span><Switch checked={scope.text} onCheckedChange={checked => setScope(current => ({ ...current, text: checked }))} /></label>
                  <label><ImageIcon size={15} /><span>{t.imageScope}</span><Switch checked={scope.images} onCheckedChange={checked => setScope(current => ({ ...current, images: checked }))} /></label>
                </div>
              </div>
            </div>

            <div className="rules-editor">
              <div className="rules-header"><div><h3>{t.rulesTitle}</h3><p>{t.rulesHint}</p></div><Button variant="outline" onClick={addRule}><Plus size={15} />{t.addRule}</Button></div>
              {rules.length ? <div className="rule-list">{rules.map((rule, index) => <div className="rule-row" key={`${index}-${rule.term}`}><span className="rule-index">{String(index + 1).padStart(2, "0")}</span><Input value={rule.term} onChange={event => updateRule(index, { term: event.target.value })} placeholder={uiLanguage === "ar" ? "الموضوع أو العبارة" : "Topic or phrase"} /><select value={rule.action} onChange={event => updateRule(index, { action: event.target.value as Action })}><option value="blur">{t.blur}</option><option value="block">{t.block}</option><option value="warn">{t.warn}</option></select><button className="icon-button destructive" onClick={() => removeRule(index)} aria-label="Remove rule"><Trash2 size={16} /></button></div>)}</div> : <div className="empty-rules"><Layers3 size={18} />{t.noRules}</div>}
              {notice && <p className="inline-notice"><CircleHelp size={15} />{notice}</p>}
            </div>

            <div className="save-bar">
              <Input value={policyName} onChange={event => setPolicyName(event.target.value)} placeholder={t.policyPlaceholder} aria-label={t.policyName} />
              {isAuthenticated ? <Button onClick={savePolicy} disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}{saving ? t.saving : activePolicyId ? t.update : t.save}</Button> : <Button variant="outline" onClick={() => startLogin()}><LockKeyhole size={15} />{t.signInSave}</Button>}
              <button onClick={newPolicy} className="reset-button" title={t.reset}><RotateCcw size={16} /></button>
            </div>
          </div>

          <aside className="test-panel" id="test">
            <div className="section-heading compact"><span className="section-kicker">{t.testKicker}</span><h2>{t.testTitle}</h2><p>{t.testText}</p></div>
            <div className="test-tabs"><button className={testType === "text" ? "active" : ""} onClick={() => { setTestType("text"); setTestValue("A quick guide to gambling offers and casino bonuses."); setResult(null); }}><FileText size={16} />{t.textScope}</button><button className={testType === "image" ? "active" : ""} onClick={() => { setTestType("image"); setTestValue("https://cdn.example.com/family-photo.jpg"); setResult(null); }}><ImageIcon size={16} />{t.imageScope}</button></div>
            <div className="test-input-wrap">{testType === "text" ? <Textarea value={testValue} onChange={event => setTestValue(event.target.value)} placeholder={t.testPlaceholder} className="test-input" /> : <Input value={testValue} onChange={event => setTestValue(event.target.value)} placeholder={t.urlPlaceholder} className="url-input" />}</div>
            <Button className="run-check-button" onClick={runTest} disabled={evaluateMutation.isPending || testValue.trim().length < 3}>{evaluateMutation.isPending ? <Loader2 className="spin" size={17} /> : <Radar size={17} />}{evaluateMutation.isPending ? t.running : t.runTest}<ArrowRight size={16} /></Button>

            <div className={`result-card ${result ? visualResult?.tone : "empty"}`}>
              <div className="result-card-head"><span>{t.resultsTitle}</span>{result && <span className="cache-pill"><Zap size={12} />{result.cacheStatus === "cached" ? t.cached : t.fresh}</span>}</div>
              {!result ? <div className="empty-result"><ShieldCheck size={28} /><p>{t.resultsEmpty}</p></div> : <>
                <div className="decision-line"><span className="decision-icon"><ResultIcon size={22} /></span><div><strong>{t[result.decision]}</strong><small>{result.uncertain ? t.uncertainLabel : `${Math.round(result.confidence * 100)}% ${t.confidence.toLowerCase()}`}</small></div></div>
                <div className="confidence-bar"><span style={{ width: `${Math.max(result.confidence * 100, result.uncertain ? 14 : 5)}%` }} /></div>
                <div className="result-detail"><span>{t.reason}</span><p>{result.reason}</p></div>
                <div className="result-detail"><span>{t.matched}</span>{result.matchedTerms.length ? <div className="match-chips">{result.matchedTerms.map(term => <b key={term}>{term}</b>)}</div> : <p>{t.noMatch}</p>}</div>
                {result.uncertain && <div className="uncertain-note"><AlertTriangle size={16} />{t.uncertainNote}</div>}
              </>}
            </div>
          </aside>
        </section>

        <section className="continuity-section" id="policies">
          <div className="continuity-heading"><span className="section-kicker">{t.policiesKicker}</span><h2>{t.policiesTitle}</h2><p>{t.policiesText}</p></div>
          {!isAuthenticated ? <div className="sign-in-callout"><div className="callout-icon"><LockKeyhole size={22} /></div><div><h3>{t.signedOutTitle}</h3><p>{t.signedOutText}</p></div><Button onClick={() => startLogin()}>{t.cta}<ChevronRight size={16} /></Button></div> : <div className="continuity-grid">
            <div className="saved-policies-card"><div className="card-title"><div><span className="metric">{policiesQuery.data?.length ?? 0}</span><span>{t.policyCount}</span></div><ShieldCheck size={20} /></div>{policiesQuery.isLoading ? <div className="mini-loader"><Loader2 className="spin" /> </div> : policiesQuery.data?.length ? <div className="policy-list">{policiesQuery.data.map(policy => <div className={`saved-policy ${activePolicyId === policy.id ? "active" : ""}`} key={policy.id}><div><b>{policy.name}</b><span>{policy.rulesJson.length} {uiLanguage === "ar" ? "قواعد" : "rules"} · {policy.scopeText ? t.textScope : ""}{policy.scopeText && policy.scopeImages ? " + " : ""}{policy.scopeImages ? t.imageScope : ""}</span></div><div className="policy-actions"><button className="copy-policy" onClick={() => copyPolicyForExtension(policy)}><Copy size={13} />{t.copyExtension}</button><button onClick={() => loadPolicy(policy)}>{activePolicyId === policy.id ? t.active : t.edit}<ChevronRight size={15} /></button></div></div>)}</div> : <div className="card-empty"><Layers3 size={20} />{t.noPolicies}</div>}</div>
            <div className="history-card"><div className="card-title"><div><span>{t.recentChecks}</span></div><Radar size={20} /></div>{historyQuery.isLoading ? <div className="mini-loader"><Loader2 className="spin" /></div> : historyQuery.data?.length ? <div className="history-list">{historyQuery.data.map(item => { const Appearance = actionAppearance[item.decision].icon; const isCached = String(item.cacheStatus) === "cached"; return <div className="history-item" key={item.id}><span className={`history-icon ${actionAppearance[item.decision].tone}`}><Appearance size={15} /></span><div><b>{item.inputType === "text" ? t.textScope : t.imageScope}</b><span>{item.reason}</span></div><small>{isCached ? t.cached : `${item.confidence}%`}</small></div>; })}</div> : <div className="card-empty"><Radar size={20} />{t.noHistory}</div>}</div>
          </div>}
        </section>
      </main>
      <footer><span>© 2026 Content Firewall</span><span>{uiLanguage === "ar" ? "قرارات قابلة للتفسير، وليست تخميناً." : "Explainable decisions, not silent guesses."}</span><a className="privacy-link" href="/manus-storage/content-firewall-chrome-extension_db504c16.zip" download>{t.downloadExtension}</a><Link className="privacy-link" href="/privacy">{uiLanguage === "ar" ? "الخصوصية" : "Privacy"}</Link></footer>
    </div>
  );
}
