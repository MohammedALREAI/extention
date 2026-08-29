import { BadgeCheck, Check, ChevronRight, CircleAlert, Copy, Download, ExternalLink, Eye, Globe2, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";

type Language = "en" | "ar";
type TutorialStep = { id: string; icon: typeof Download; title: string; time: string; body: string; actions?: { label: string; href: string; download?: boolean }[]; checklist: string[] };

export const tutorialSteps: Record<Language, TutorialStep[]> = {
  en: [
    { id: "download", icon: Download, title: "Download the correct extension", time: "1 minute", body: "Start with the current v1.0.8 ZIP. Strict mode covers each candidate image while it is checked, then resolves to target-only blur, reveal, or Review. This release defers off-screen work and coalesces repeated checks. The package includes manifest.json and all four icon files.", actions: [{ label: "Download Chrome extension v1.0.8", href: "/manus-storage/content-firewall-chrome-extension_db504c16.zip", download: true }], checklist: ["Save the ZIP, then extract it completely.", "Open the extracted folder and confirm that manifest.json and the icons folder are beside each other."] },
    { id: "install", icon: ExternalLink, title: "Install it in Chrome", time: "1 minute", body: "Chrome loads a folder, not the ZIP itself. Use Developer mode to select the extracted folder that directly contains manifest.json.", checklist: ["Open chrome://extensions in Chrome.", "Turn on Developer mode, then choose Load unpacked.", "Select the extracted Content Firewall folder — not a parent folder and not the old extension folder."] },
    { id: "policy", icon: Copy, title: "Create and import your policy", time: "1 minute", body: "Sign in to save a policy. Use Copy for Chrome on the saved policy, then paste the complete copied text into the extension's Protection rules settings.", actions: [{ label: "Open my policies", href: "/#policies" }], checklist: ["Create rules in the language you prefer and save the policy.", "Click Copy for Chrome on that saved policy.", "Open the extension icon, select Protection rules, paste and import the snapshot."] },
    { id: "verify", icon: BadgeCheck, title: "Verify protection is working", time: "1 minute", body: "Search normally. Matching words and object regions are protected, and the purple badge counts currently protected items on the search page.", checklist: ["Try a search result that contains one of your protected terms.", "Confirm the purple number appears on the Content Firewall toolbar icon.", "Click a covered phrase or image region only if you want to reveal it intentionally."] },
  ],
  ar: [
    { id: "download", icon: Download, title: "نزّل الإضافة الصحيحة", time: "دقيقة واحدة", body: "ابدأ بملف ZIP الحالي الإصدار 1.0.8. وضع Strict يغطي كل صورة مرشحة أثناء الفحص، ثم يتحول إلى تمويه للكائن فقط أو كشف الصورة أو Review. هذا الإصدار يؤجل العمل خارج الشاشة ويدمج الفحوص المتكررة. يحتوي الملف manifest.json وملفات الأيقونة الأربعة.", actions: [{ label: "تنزيل إضافة Chrome الإصدار 1.0.8", href: "/manus-storage/content-firewall-chrome-extension_db504c16.zip", download: true }], checklist: ["احفظ ملف ZIP ثم فك ضغطه بالكامل.", "افتح المجلد الناتج وتأكد أن manifest.json ومجلد icons موجودان بجانب بعضهما."] },
    { id: "install", icon: ExternalLink, title: "ثبّتها في Chrome", time: "دقيقة واحدة", body: "Chrome يحمّل مجلداً وليس ملف ZIP مباشرة. فعّل وضع المطور واختر المجلد الذي يحتوي manifest.json مباشرة.", checklist: ["افتح chrome://extensions داخل Chrome.", "فعّل Developer mode ثم اختر Load unpacked.", "اختر مجلد Content Firewall الذي فُك ضغطه، وليس مجلداً أباً أو مجلد الإضافة القديم."] },
    { id: "policy", icon: Copy, title: "أنشئ سياستك واستوردها", time: "دقيقة واحدة", body: "سجّل الدخول لحفظ سياسة. استخدم نسخ لإضافة Chrome على السياسة المحفوظة، ثم الصق النص كاملاً في إعدادات قواعد الحماية للإضافة.", actions: [{ label: "فتح سياساتي", href: "/#policies" }], checklist: ["أنشئ القواعد باللغة التي تريدها واحفظ السياسة.", "انقر نسخ لإضافة Chrome على السياسة المحفوظة.", "افتح أيقونة الإضافة، اختر قواعد الحماية، ثم الصق اللقطة واستوردها."] },
    { id: "verify", icon: BadgeCheck, title: "تأكد أن الحماية تعمل", time: "دقيقة واحدة", body: "ابحث بشكل طبيعي. الكلمات ومناطق الكائنات المطابقة تُحمى، والعدّاد البنفسجي يعرض عدد العناصر المحمية في صفحة البحث.", checklist: ["جرّب نتيجة بحث تحتوي عبارة من قواعدك.", "تأكد من ظهور الرقم البنفسجي على أيقونة Content Firewall في الشريط.", "انقر العبارة أو منطقة الصورة المغطاة فقط إذا أردت كشفها عن قصد."] },
  ],
};

export const tutorialInstallGif = "/manus-storage/content-firewall-load-unpacked_a4ea7cf4.gif";

export function installationDemoMode(reducedMotion: boolean) {
  return reducedMotion ? "paused" : "animated";
}

export default function TutorialStart() {
  const [language, setLanguage] = useState<Language>("en");
  const [reducedMotion, setReducedMotion] = useState(false);
  const isArabic = language === "ar";
  const steps = tutorialSteps[language];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return (
    <div className="tutorial-shell" dir={isArabic ? "rtl" : "ltr"}>
      <header className="site-header tutorial-header">
        <Link href="/" className="brand" aria-label="Content Firewall home"><span className="brand-mark"><ShieldCheck size={18} /></span><span>content<span>firewall</span></span></Link>
        <div className="tutorial-header-actions"><Link href="/privacy" className="tutorial-text-link">{isArabic ? "الخصوصية" : "Privacy"}</Link><button className="language-toggle" onClick={() => setLanguage(current => current === "en" ? "ar" : "en")}><Globe2 size={15} /><span>{isArabic ? "English" : "العربية"}</span></button></div>
      </header>

      <main className="tutorial-content">
        <section className="tutorial-hero">
          <div><div className="tutorial-eyebrow"><Sparkles size={14} />{isArabic ? "TUTORIAL START" : "TUTORIAL START"}</div><h1>{isArabic ? "ابدأ الحماية خلال أربع دقائق." : "Start protection in four minutes."}</h1><p>{isArabic ? "هذا الدليل يوصلك من تنزيل الإضافة إلى ظهور العدّاد البنفسجي في نتائج بحثك." : "This guide takes you from downloading the extension to seeing the purple count badge in your search results."}</p></div>
          <div className="tutorial-ready-card"><BadgeCheck size={22} /><div><b>{isArabic ? "جاهز للبدء" : "Ready to start"}</b><span>{isArabic ? "الإصدار 1.0.8 · Chrome MV3" : "Version 1.0.8 · Chrome MV3"}</span></div></div>
        </section>

        <section className="tutorial-layout" aria-label="Extension installation tutorial">
          <aside className="tutorial-progress"><span>{isArabic ? "خطواتك" : "Your steps"}</span>{steps.map((step, index) => <a href={`#${step.id}`} key={step.id}><i>{String(index + 1).padStart(2, "0")}</i><b>{step.title}</b></a>)}</aside>
          <div className="tutorial-steps">{steps.map((step, index) => { const Icon = step.icon; return <article className="tutorial-step" id={step.id} key={step.id}><div className="tutorial-step-number">{String(index + 1).padStart(2, "0")}</div><div className="tutorial-step-main"><div className="tutorial-step-head"><span className="tutorial-step-icon"><Icon size={19} /></span><div><p>{step.time}</p><h2>{step.title}</h2></div></div><p className="tutorial-step-body">{step.body}</p><ul>{step.checklist.map(item => <li key={item}><Check size={15} />{item}</li>)}</ul>{step.id === "install" && <figure className="tutorial-demo"><div className="tutorial-demo-label"><Sparkles size={13} />{isArabic ? "عرض التثبيت" : "Installation demo"}</div>{installationDemoMode(reducedMotion) === "paused" ? <div className="tutorial-demo-paused"><ExternalLink size={19} /><span>{isArabic ? "تم إيقاف الحركة حسب تفضيل جهازك. اتبع الخطوات النصية أعلاه." : "Motion is paused for your device preference. Follow the written steps above."}</span></div> : <img src={tutorialInstallGif} alt="Animated walkthrough: open chrome extensions, enable Developer mode, click Load unpacked, and select the Content Firewall folder containing manifest.json and icons." />}</figure>}{step.actions?.map(action => action.href.startsWith("/") && !action.href.includes("#") ? <a className="tutorial-action" key={action.label} href={action.href} download={action.download}>{action.label}<Download size={15} /></a> : <Link className="tutorial-action" key={action.label} href={action.href}>{action.label}<ChevronRight size={15} /></Link>)}</div></article>; })}</div>
        </section>

        <section className="tutorial-help"><CircleAlert size={19} /><div><h2>{isArabic ? "هل ظهر خطأ Could not load icon أو Could not load manifest؟" : "Seeing “Could not load icon” or “Could not load manifest”?"}</h2><p>{isArabic ? "أزل النسخة القديمة من chrome://extensions، نزّل ZIP الإصدار 1.0.8، فك ضغطه، ثم اختر عبر Load unpacked المجلد الذي يحتوي manifest.json وicons. لا تختر ملف ZIP نفسه." : "Remove the old build from chrome://extensions, download the v1.0.8 ZIP, extract it, and use Load unpacked on the folder containing manifest.json and icons. Do not select the ZIP file itself."}</p></div></section>

        <section className="tutorial-finish"><Eye size={20} /><div><h2>{isArabic ? "ملاحظة مهمة" : "One important note"}</h2><p>{isArabic ? "عند تغيير السياسة أو ظهور Review بسبب انتهاء الوصول، انسخ السياسة من التطبيق مرة أخرى واستوردها من جديد في الإضافة." : "When you change a policy—or see Review because access expired—copy the policy again in the web app and re-import it into the extension."}</p></div></section>
      </main>
    </div>
  );
}
