import { AlertTriangle, CalendarDays, Check, CircleDollarSign, Clock3, CreditCard, ExternalLink, Globe2, LogIn, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import React, { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

type Language = "en" | "ar";
type AccountType = "free_trial" | "monthly_subscription" | "yearly_subscription" | "expired_no_subscription";
type Status = "trial" | "active" | "expired" | "cancelled";

export type SubscriptionView = {
  accountType: AccountType;
  status: Status;
  planCode: "trial" | "monthly" | "yearly" | "none";
  hasAccess: boolean;
  daysRemaining: number;
  trialStartedAt: Date | string;
  trialEndsAt: Date | string;
  currentPeriodStart: Date | string | null;
  currentPeriodEnd: Date | string | null;
  priceCents: number | null;
  currency: "USD" | null;
  billingPeriod: "month" | "year" | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | string | null;
  paymentSetupRequired: boolean;
};

export const accountCopy = {
  en: {
    label: "ACCOUNT & SUBSCRIPTION",
    title: "Your access, always clear.",
    lead: "Review your trial or subscription status, remaining access, and the plan that protects your workflow.",
    signInTitle: "Sign in to view your access",
    signInText: "Your trial and subscription information is linked to your Content Firewall account.",
    signIn: "Sign in securely",
    currentAccess: "Current access",
    trialStart: "Trial started",
    trialEnd: "Trial ends",
    periodStart: "Plan started",
    periodEnd: "Renews / expires",
    remaining: "Remaining access",
    days: "days remaining",
    today: "Ends today",
    noAccess: "Your access has expired.",
    active: "Active",
    trial: "Trial",
    expired: "Expired",
    cancelled: "Cancelled",
    free_trial: "Free Trial",
    monthly_subscription: "Monthly Subscription",
    yearly_subscription: "Yearly Subscription",
    expired_no_subscription: "Expired / No Subscription",
    planOptions: "Choose a plan",
    planLead: "Keep full access to policies, history, and semantic protection after your trial.",
    monthly: "Monthly Plan",
    yearly: "Yearly Plan",
    month: "month",
    year: "year",
    perMonth: "$10 / month",
    perYear: "$50 / year",
    monthlyDetail: "Flexible monthly access",
    yearlyDetail: "Best value for a full year",
    selectPlan: "Subscribe with Stripe",
    paymentPending: "Payment setup pending",
    paymentPendingText: "Stripe Checkout will be enabled here once the project payment keys are connected. No payment is being simulated.",
    manage: "Manage subscription",
    manageText: "Cancellation and billing management will open the Stripe customer portal after payment setup is connected.",
    cancelInfo: "Cancellation keeps access until the listed period end.",
    privacy: "Privacy",
    back: "Back to app",
  },
  ar: {
    label: "الحساب والاشتراك",
    title: "وصولك واضح دائماً.",
    lead: "راجع حالة تجربتك أو اشتراكك، الوقت المتبقي، والخطة التي تحمي سير عملك.",
    signInTitle: "سجّل الدخول لعرض وصولك",
    signInText: "ترتبط معلومات التجربة والاشتراك بحساب Content Firewall الخاص بك.",
    signIn: "تسجيل دخول آمن",
    currentAccess: "الوصول الحالي",
    trialStart: "بدأت التجربة",
    trialEnd: "تنتهي التجربة",
    periodStart: "بدأت الخطة",
    periodEnd: "التجديد / الانتهاء",
    remaining: "الوصول المتبقي",
    days: "أيام متبقية",
    today: "ينتهي اليوم",
    noAccess: "انتهى وصولك.",
    active: "نشط",
    trial: "تجربة",
    expired: "منتهٍ",
    cancelled: "ملغى",
    free_trial: "تجربة مجانية",
    monthly_subscription: "اشتراك شهري",
    yearly_subscription: "اشتراك سنوي",
    expired_no_subscription: "منتهي / بدون اشتراك",
    planOptions: "اختر خطة",
    planLead: "احتفظ بوصول كامل للسياسات والسجل والحماية الدلالية بعد التجربة.",
    monthly: "الخطة الشهرية",
    yearly: "الخطة السنوية",
    month: "شهر",
    year: "سنة",
    perMonth: "10$ / شهر",
    perYear: "50$ / سنة",
    monthlyDetail: "وصول شهري مرن",
    yearlyDetail: "أفضل قيمة لسنة كاملة",
    selectPlan: "الاشتراك عبر Stripe",
    paymentPending: "إعداد الدفع قيد الانتظار",
    paymentPendingText: "سيتم تفعيل Stripe Checkout هنا بعد ربط مفاتيح الدفع بالمشروع. لا توجد محاكاة للدفع.",
    manage: "إدارة الاشتراك",
    manageText: "سيفتح الإلغاء وإدارة الفوترة بوابة عملاء Stripe بعد ربط إعداد الدفع.",
    cancelInfo: "يبقى الوصول متاحاً حتى تاريخ نهاية الفترة المعروض.",
    privacy: "الخصوصية",
    back: "العودة للتطبيق",
  },
} as const;

export function subscriptionTone(status: Status) {
  return status === "active" ? "active" : status === "trial" ? "trial" : status === "cancelled" ? "cancelled" : "expired";
}

function formatDate(value: Date | string | null, language: Language) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(language === "ar" ? "ar" : "en-US", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

export function AccessStatusCard({ subscription, language }: { subscription: SubscriptionView; language: Language }) {
  const t = accountCopy[language];
  return <>
    <section className={`access-card ${subscriptionTone(subscription.status)}`}>
      <div className="access-card-top"><div className="access-icon">{subscription.hasAccess ? <ShieldCheck size={25} /> : <AlertTriangle size={25} />}</div><div><span>{t.currentAccess}</span><h2>{t[subscription.accountType]}</h2></div><b className={`access-status ${subscriptionTone(subscription.status)}`}>{t[subscription.status]}</b></div>
      <div className="access-remaining"><Clock3 size={17} /><div>{subscription.hasAccess ? <><strong>{subscription.daysRemaining > 0 ? `${subscription.daysRemaining} ${t.days}` : t.today}</strong><span>{subscription.status === "trial" ? `${t.trialEnd}: ${formatDate(subscription.trialEndsAt, language)}` : `${t.periodEnd}: ${formatDate(subscription.currentPeriodEnd, language)}`}</span></> : <><strong>{t.noAccess}</strong><span>{t.planOptions}</span></>}</div></div>
    </section>
    <section className="account-details-grid">
      <article className="account-detail-card"><CalendarDays size={18} /><span>{t.trialStart}</span><b>{formatDate(subscription.trialStartedAt, language)}</b><small>{t.trialEnd}: {formatDate(subscription.trialEndsAt, language)}</small></article>
      <article className="account-detail-card"><CreditCard size={18} /><span>{subscription.planCode === "trial" ? t.free_trial : subscription.planCode === "monthly" ? t.monthly : subscription.planCode === "yearly" ? t.yearly : t.expired_no_subscription}</span><b>{subscription.priceCents ? `$${(subscription.priceCents / 100).toFixed(0)} / ${subscription.billingPeriod === "year" ? t.year : t.month}` : "—"}</b><small>{subscription.currentPeriodStart ? `${t.periodStart}: ${formatDate(subscription.currentPeriodStart, language)}` : t.paymentPending}</small></article>
      <article className="account-detail-card"><CircleDollarSign size={18} /><span>{t.periodEnd}</span><b>{formatDate(subscription.currentPeriodEnd ?? subscription.trialEndsAt, language)}</b><small>{subscription.cancelAtPeriodEnd ? t.cancelInfo : subscription.status === "trial" ? t.trial : t.active}</small></article>
    </section>
  </>;
}

export default function Account() {
  const [language, setLanguage] = useState<Language>("en");
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "yearly" | null>(null);
  const { isAuthenticated, loading } = useAuth();
  const subscriptionQuery = trpc.account.subscription.useQuery(undefined, { enabled: isAuthenticated });
  const checkoutQuery = trpc.account.checkoutAvailability.useQuery(undefined, { enabled: isAuthenticated });
  const t = accountCopy[language];
  const subscription = subscriptionQuery.data;
  const isArabic = language === "ar";

  return <div className="account-shell" dir={isArabic ? "rtl" : "ltr"}>
    <header className="site-header account-header">
      <Link href="/" className="brand"><span className="brand-mark"><ShieldCheck size={18} /></span><span>content<span>firewall</span></span></Link>
      <div className="account-header-actions"><Link href="/developer" className="account-back">{isArabic ? "واجهة المطور" : "Developer API"}</Link><Link href="/tutorial" className="account-back">{t.back}</Link><Link href="/privacy" className="account-back">{t.privacy}</Link><button className="language-toggle" onClick={() => setLanguage(current => current === "en" ? "ar" : "en")}><Globe2 size={15} /><span>{isArabic ? "English" : "العربية"}</span></button></div>
    </header>

    <main className="account-content">
      <section className="account-hero"><div className="account-kicker"><Sparkles size={14} />{t.label}</div><h1>{t.title}</h1><p>{t.lead}</p></section>

      {!loading && !isAuthenticated && <section className="account-signin"><LogIn size={23} /><div><h2>{t.signInTitle}</h2><p>{t.signInText}</p></div><Button onClick={() => startLogin()}>{t.signIn}</Button></section>}

      {isAuthenticated && subscriptionQuery.isLoading && <section className="account-loading"><RefreshCcw className="spin" size={20} /><span>{isArabic ? "جارٍ تحميل حالة الوصول…" : "Loading your access status…"}</span></section>}

      {isAuthenticated && subscription && <>
        <AccessStatusCard subscription={subscription} language={language} />

        <section className="account-plans"><div className="account-section-heading"><span>{t.planOptions}</span><h2>{subscription.hasAccess ? (isArabic ? "خطط عند الحاجة" : "Plans when you need them") : (isArabic ? "استعد الوصول الكامل" : "Restore full access")}</h2><p>{t.planLead}</p></div><div className="plan-grid">{(["monthly", "yearly"] as const).map(plan => <article className={`plan-card ${plan === "yearly" ? "featured" : ""}`} key={plan}><span className="plan-tag">{plan === "yearly" ? (isArabic ? "أفضل قيمة" : "Best value") : (isArabic ? "مرن" : "Flexible")}</span><h3>{plan === "monthly" ? t.monthly : t.yearly}</h3><b>{plan === "monthly" ? t.perMonth : t.perYear}</b><p>{plan === "monthly" ? t.monthlyDetail : t.yearlyDetail}</p><ul><li><Check size={14} />{isArabic ? "وصول كامل للسياسات" : "Full policy access"}</li><li><Check size={14} />{isArabic ? "حماية نص وصور دلالية" : "Semantic text & image protection"}</li><li><Check size={14} />{isArabic ? "إدارة ذاتية عند التفعيل" : "Self-service management when enabled"}</li></ul><button type="button" onClick={() => setSelectedPlan(plan)}>{t.selectPlan}</button></article>)}</div>{selectedPlan && <div className="payment-pending"><AlertTriangle size={18} /><div><b>{t.paymentPending}</b><p>{t.paymentPendingText} {selectedPlan === "monthly" ? t.perMonth : t.perYear}</p></div></div>}</section>

        <section className="account-manage"><ExternalLink size={18} /><div><h2>{t.manage}</h2><p>{subscription.status === "cancelled" ? t.cancelInfo : t.manageText}</p></div><button type="button" disabled={!checkoutQuery.data?.available}>{t.manage}</button></section>
      </>}
    </main>
  </div>;
}
