# Content Firewall — Search Guard

**Version 1.0.8.** Content Firewall applies your saved content preferences to search-result cards before you open them. The production result-card pipeline masks only the exact matched text phrase, while image decisions independently apply a strong blur only over high-confidence matching object regions. **Strict** is now the default image mode: a temporary image-only cover is placed before visual analysis, then resolves per image to target-only blur, full reveal on no-match, or a Review cover on failure. **Fast** remains an explicit opt-out. Google Images still prefers an original/high-resolution source and analyzes each image independently with high-detail visual localization; duplicate boxes are removed while separate matching objects remain separately blurred. This release defers off-screen candidates, coalesces repeated scans and in-flight visual checks, avoids rebuilding identical image layers, and retains small batches for standard images.

## Engine coverage

The selector registry has dedicated adapters for **Google, Bing, DuckDuckGo, Brave Search, Yahoo, and Ecosia**. On another search engine, the extension activates a generic adapter only when the URL looks like a search page; it then inspects common result-card structures. It does not add protection UI to ordinary article pages.

## Install or update locally

1. Download and unzip `content-firewall-chrome-extension.zip`.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the unzipped folder that directly contains `manifest.json`. Do not select a parent folder. The `icons/` directory must be beside `manifest.json`; version 1.0.8 includes it in both the ZIP and this source `extension/` directory.
4. If replacing an older build, click **Reload** on the existing extension card, or remove it and load this folder again.
5. Open **Protection rules** from the toolbar popup. In the web app, use **Copy for Chrome** and import a freshly copied policy snapshot. Re-import it after changing a policy or after the access token expires.
6. Search normally. Click a covered word, object region, or review cover only when you deliberately want to reveal it.

## Language and protection behavior

Rules preserve the original Unicode text the user entered. Exact local matches are applied immediately. For contextual, synonymous, and cross-language decisions, an imported policy snapshot can authorize a server-side semantic evaluator. For image object matching, it can authorize a vision localization check. Images are blurred only inside high-confidence matching-object regions. A fresh no-match result leaves the image visible; an unavailable or expired visual service shows a Review cover only for the affected image so it is not silently exposed.

## Improving object detection

Open the extension settings and opt into **Keep local detection feedback for export** only if you wish to help improve detection. Hold **Alt** while clicking a visible image to record a missed object, or hold **Shift** while revealing an incorrect object blur to record a false positive. Feedback is stored locally, strips URL query parameters, and is exported only when you select **Export feedback JSON**. A future model fine-tuning run requires reviewing and labelling the exported examples before sending them to a training provider.

## Privacy and network behavior

With semantic or visual evaluation enabled, the extension sends limited batches of visible search-result text (title, snippet, link text, and URL) or HTTPS image URLs to the Content Firewall endpoint. It does **not** send full page HTML, browser cookies, form values, or browsing history. The imported policy snapshot contains a time-limited signed access token; tokens expire and can be refreshed by importing a newly copied snapshot. The extension stores its rules and imported snapshot in Chrome Sync.

**Content Firewall does not sell user data and does not use extension data for advertising, including targeted advertising.** The limited data described above is used only to provide the protection features selected by the user and operate them securely.

## Chrome Web Store privacy statement

Use this statement prominently in the store listing: **“Content Firewall does not sell user data or use extension data for advertising, including targeted advertising. Visible search-result text and HTTPS image URLs are processed only when needed to provide the protection features selected by the user.”**

## Before publishing to the Chrome Web Store

This ZIP is a technically validated production candidate. A Chrome Web Store submission still requires the publisher to provide the store listing, support contact, accurate data-use disclosures, and a public privacy-policy URL. Because generic search support requires access to search-result pages across websites, the listing must clearly explain that broad site access is used only to detect search pages and protect result cards.
