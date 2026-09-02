import { ArrowLeft, Database, Eye, Globe2, RefreshCcw, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import "./privacy-banner.css";

export const privacyPolicySections = [
  {
    icon: Eye,
    title: "What the extension reads",
    body: "Content Firewall evaluates visible search-result information: result titles, snippets, link text, destination URLs, and, when image localization is enabled, result images — as an HTTPS image URL, or as the thumbnail itself when the search page embeds it inline instead of linking it. It does not read full article pages, browser cookies, form fields, passwords, or your complete browsing history.",
  },
  {
    icon: Globe2,
    title: "When data leaves your browser",
    body: "Exact local matches are handled in the browser. When you import an active policy snapshot, limited batches of visible result text or result images may be sent to the Content Firewall semantic or vision endpoint for contextual and cross-language decisions. An image is sent as its HTTPS URL where the page provides one; where the search page embeds the thumbnail inline, the extension sends that reduced-size thumbnail instead, because there is no URL to send. Images are used only to answer that one check and are not retained. The extension does not send complete page HTML.",
  },
  {
    icon: Database,
    title: "Storage and control",
    body: "Rules and the imported policy snapshot are stored in Chrome Sync so they can follow your signed-in Chrome profile. Policies saved in the web app are associated with your account. You can edit, replace, disable, or delete your policy at any time.",
  },
  {
    icon: ShieldCheck,
    title: "No sale and no advertising use",
    body: "Content Firewall does not sell user data and does not use extension data for advertising, including targeted advertising. It uses the limited data described here only to provide the protection features you choose and operate them securely.",
  },
  {
    icon: RefreshCcw,
    title: "Access tokens and safety behavior",
    body: "Imported snapshots contain a signed, time-limited access token used only for the semantic and vision endpoints. A confident image no-match stays visible. When visual access expires or a check cannot be completed, the extension protects only that affected image with a Review cover. Import a freshly copied policy to refresh access.",
  },
];

export default function Privacy() {
  return (
    <div className="privacy-shell">
      <header className="site-header privacy-header">
        <Link href="/" className="brand" aria-label="Content Firewall home">
          <span className="brand-mark"><ShieldCheck size={18} /></span>
          <span>Content <span>Firewall</span></span>
        </Link>
        <Link href="/" className="privacy-back"><ArrowLeft size={15} /> Back to app</Link>
      </header>

      <main className="privacy-content">
        <div className="privacy-kicker"><ShieldCheck size={14} /> PRIVACY NOTICE</div>
        <h1>Clear boundaries for content protection data.</h1>
        <p className="privacy-lead">This notice explains how the Content Firewall web app and Chrome extension handle information while applying your content preferences to search results. It is written for the production extension release, version 1.0.9.</p>
        <section className="privacy-no-sale" aria-label="No sale or advertising commitment"><ShieldCheck size={20} /><p><strong>We do not sell user data or use extension data for advertising.</strong> The limited data described below is used only to provide the protection features you select and operate them securely.</p></section>
        <p className="privacy-updated">Last updated: August 23, 2026</p>

        <section className="privacy-grid" aria-label="Privacy notice details">
          {privacyPolicySections.map(section => {
            const Icon = section.icon;
            return <article key={section.title} className="privacy-card"><Icon size={19} /><h2>{section.title}</h2><p>{section.body}</p></article>;
          })}
        </section>

        <section className="privacy-commitment">
          <h2>Your choice stays visible.</h2>
          <p>Content Firewall is designed to make filtering reversible. You can reveal protected text or image areas manually, change the rules that caused a protection decision, and turn a policy off. The extension badge counts protections on the current search page only; it is not an activity tracker.</p>
        </section>
      </main>
    </div>
  );
}
