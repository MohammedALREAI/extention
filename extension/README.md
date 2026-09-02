# Content Firewall — Search Guard

**Version 1.0.10.** Content Firewall applies your saved content preferences to search-result cards before you open them. Text protection masks only the exact matched phrase, inline, so the rest of the result stays readable. Image protection runs independently: each matching object gets a soft patch sized to that object, feathered at its edges, and the rest of the picture stays visible. **Strict** is the default image mode — a temporary blur covers each candidate while it is checked, then resolves per image to an object patch, a full reveal on no-match, or a whole-image blur when that one image could not be checked. **Fast** remains an explicit opt-out. Google results prefer an original or high-resolution source; where a search page embeds its thumbnail inline rather than linking it, that reduced-size thumbnail is checked instead. Duplicate boxes are removed while separate matching objects stay separately covered. This release defers off-screen candidates, coalesces repeated scans and in-flight visual checks, avoids rebuilding identical image layers, and retains small batches for standard images.

## Required before semantic or visual checks work

`host_permissions` in `manifest.json` is intentionally empty. Chrome only lets the
extension contact hosts listed there, so until your API host is added, **every semantic
and visual check fails**: exact local rules still mask text, but no image is ever
analysed and nothing is covered. The toolbar popup reports the failed checks rather than
leaving it a mystery.

Add your API origin and reload the extension:

```json
"host_permissions": ["https://api.example.com/*"]
```

It must match the host in the policy snapshot you import, and that host must send the
CORS headers the endpoint already sets for `chrome-extension://` origins.

## Engine coverage

The selector registry has dedicated adapters for **Google, Bing, DuckDuckGo, Brave Search, Yahoo, and Ecosia**. On another search engine, the extension activates a generic adapter only when the URL looks like a search page; it then inspects common result-card structures. It does not add protection UI to ordinary article pages.

## Install or update locally

1. Download and unzip `content-firewall-chrome-extension.zip`.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the unzipped folder that directly contains `manifest.json`. Do not select a parent folder. The `icons/` directory must be beside `manifest.json`; version 1.0.10 includes it in both the ZIP and this source `extension/` directory.
4. If replacing an older build, click **Reload** on the existing extension card, or remove it and load this folder again.
5. Open **Protection rules** from the toolbar popup. In the web app, use **Copy for Chrome** and import a freshly copied policy snapshot. Re-import it after changing a policy or after the access token expires.
6. Search normally. Click a covered word or object patch only when you deliberately want to reveal it.

## What you see on a search page

| What appears | What it means |
| --- | --- |
| A blurred word inside otherwise normal text | That exact phrase matched a rule. Click it to restore the word. |
| A soft patch over part of an image | A matching object was located there. The rest of the picture is untouched. Click the patch to reveal that region. |
| Nothing on an image | Either nothing in it matched, or its check could not complete. Only located objects are ever covered — a failed check never blurs the whole picture. The popup reports how many checks could not complete, which is the only way to tell the two apart. |
| A number on the toolbar icon | How many items are currently protected on this page. It drops as you reveal them. |

Nothing is written over the result itself: every state explains itself through its tooltip, so the search layout is never pushed around.

**Blur strength** in Protection rules controls how strong an object patch is. **Auto** (default) scales it with the object's size — lighter for a small region, stronger for one that dominates the picture. Light, Medium, and Strong override that with a fixed strength.

## Language and protection behavior

Rules preserve the original Unicode text the user entered. Exact local matches are applied immediately. For contextual, synonymous, and cross-language decisions, an imported policy snapshot can authorize a server-side semantic evaluator. For image object matching, it can authorize a vision localization check. Images are covered only inside high-confidence matching-object regions. A fresh no-match result leaves the image visible. An unavailable or expired visual service also leaves the image visible — by product choice, only located objects are ever covered — and the toolbar popup reports how many checks could not complete, so an unchecked image is not mistaken for a clean one.

## Improving object detection

Open the extension settings and opt into **Keep local detection feedback for export** only if you wish to help improve detection. Hold **Alt** while clicking a visible image to record a missed object, or hold **Shift** while revealing an incorrect object blur to record a false positive. Feedback is stored locally, strips URL query parameters, and is exported only when you select **Export feedback JSON**. A future model fine-tuning run requires reviewing and labelling the exported examples before sending them to a training provider.

## Privacy and network behavior

With semantic or visual evaluation enabled, the extension sends limited batches of visible search-result text (title, snippet, link text, and URL) or result images to the Content Firewall endpoint. An image is sent as its HTTPS URL where the page provides one; where the search page embeds the thumbnail inline instead of linking it, the reduced-size thumbnail itself is sent, because there is no URL to send. A short piece of the text shown beside that image — its title, caption, or alt text, capped at 200 characters — is sent with it as a hint for the check; it never decides the outcome on its own, so a caption naming a filtered subject does not cover an image that does not contain it. Images are used only to answer that one check and are not retained. It does **not** send full page HTML, browser cookies, form values, or browsing history. The imported policy snapshot contains a time-limited signed access token; tokens expire and can be refreshed by importing a newly copied snapshot. The extension stores its rules and imported snapshot in Chrome Sync.

**Content Firewall does not sell user data and does not use extension data for advertising, including targeted advertising.** The limited data described above is used only to provide the protection features selected by the user and operate them securely.

## Chrome Web Store privacy statement

Use this statement prominently in the store listing: **“Content Firewall does not sell user data or use extension data for advertising, including targeted advertising. Visible search-result text, result images, and the short caption shown beside an image are processed only when needed to provide the protection features selected by the user.”**

## Before publishing to the Chrome Web Store

This ZIP is a technically validated production candidate. A Chrome Web Store submission still requires the publisher to provide the store listing, support contact, accurate data-use disclosures, and a public privacy-policy URL. Because generic search support requires access to search-result pages across websites, the listing must clearly explain that broad site access is used only to detect search pages and protect result cards.
