import { Link } from "wouter";
import { ArrowLeft, BookOpen, ShieldCheck } from "lucide-react";

const request = `POST /api/v1/moderate/text
Authorization: Bearer cfk_your_pilot_key
Content-Type: application/json

{
  "policy": {
    "revision": "community-ar-v1",
    "description": "لا تسمح بإهانات أو تهديدات أو عروض احتيال.",
    "rules": [{
      "label": "harassment",
      "description": "إهانة أو تهديد موجّه لشخص، بالفصحى أو العامية الواضحة.",
      "action": "review"
    }]
  },
  "items": [{ "id": "comment-17", "text": "إنت غبي", "language": "ar" }]
}`;

const response = `{
  "object": "moderation.batch",
  "policyRevision": "community-ar-v1",
  "results": [{
    "id": "comment-17",
    "state": "match",
    "action": "review",
    "labels": ["harassment"],
    "confidence": 0.91,
    "reason": "Clear directed insult."
  }]
}`;

export default function DeveloperDocs() {
  return <div className="min-h-screen bg-[#090b15] text-slate-100" dir="rtl"><header className="mx-auto flex max-w-4xl items-center justify-between border-b border-white/10 px-5 py-5"><Link href="/developer" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"><ArrowLeft size={16} />بوابة المطور</Link><div className="flex items-center gap-2 font-semibold"><span>content</span><span className="text-violet-300">firewall</span><ShieldCheck className="text-violet-300" size={19} /></div></header><main className="mx-auto max-w-4xl px-5 py-14"><div className="mb-10"><div className="inline-flex items-center gap-2 rounded-full bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200"><BookOpen size={14} />توثيق API التجريبي</div><h1 className="mt-5 text-4xl font-semibold tracking-tight">إشراف نصي عربي قابل للتفسير</h1><p className="mt-4 max-w-3xl text-lg leading-8 text-slate-300">هذا مسار تجريبي لخوادم المنتجات. أرسل قواعدك أنت، واستلم نتيجة واضحة لكل عنصر. لا يستخدم مفتاح API الخاص بالمطور رمز امتداد Chrome ولا يشاركه.</p></div><div className="grid gap-6"><section className="rounded-2xl border border-white/10 bg-[#111427] p-6"><h2 className="text-xl font-semibold">نقطة الوصول والمصادقة</h2><p className="mt-3 leading-7 text-slate-300">استخدم <code>POST /api/v1/moderate/text</code> مع <code>Authorization: Bearer cfk_…</code>. المرحلة التجريبية تسمح بـ 5 طلبات في الدقيقة لكل مفتاح، ونطاقها الحالي <code>moderation:text</code>.</p></section><section className="rounded-2xl border border-white/10 bg-[#111427] p-6"><h2 className="text-xl font-semibold">الطلب</h2><p className="mt-3 leading-7 text-slate-300">يحتاج الطلب إلى revision ووصف سياسة وقاعدة واحدة على الأقل، مع عناصر نصية فريدة لا يزيد عددها عن 20. القواعد يملكها العميل: label ثابت، description بلغة طبيعية، وaction من <code>mask</code> أو <code>review</code> أو <code>block</code>.</p><pre dir="ltr" className="mt-5 overflow-x-auto rounded-xl bg-black/25 p-5 text-left text-xs leading-6 text-teal-100"><code>{request}</code></pre></section><section className="rounded-2xl border border-white/10 bg-[#111427] p-6"><h2 className="text-xl font-semibold">الاستجابة</h2><p className="mt-3 leading-7 text-slate-300">كل عنصر يعيد <code>match</code> أو <code>no_match</code> أو <code>unavailable</code>. التعذر ليس سماحًا ولا عدم مطابقة؛ وجّهه إلى مسار المراجعة في منتجك.</p><pre dir="ltr" className="mt-5 overflow-x-auto rounded-xl bg-black/25 p-5 text-left text-xs leading-6 text-teal-100"><code>{response}</code></pre></section><section className="rounded-2xl border border-amber-300/20 bg-amber-400/5 p-6"><h2 className="text-xl font-semibold text-amber-100">الخصوصية والحدود</h2><p className="mt-3 leading-7 text-slate-300">لا تحفظ v1 نص الطلب في سجلات الاستخدام ولا تدرب عليه تلقائيًا. دعم العربية يشمل الفصحى ولهجاتها والصيغ المختلطة، لكن لا ينبغي تحويل اللهجة أو الهوية إلى فئة. إشراف الصور مسار URL-only منفصل ومعطل افتراضيًا إلى أن يثبت على أمثلة مراجعَة ومصرح بها.</p></section></div></main></div>;
}
