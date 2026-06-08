# Bergamot on Mobile — Research & Architecture

Canonical reference for bringing bergamot's browsing-capture to Android and iOS. Captures the agreed architecture, the open engine/approach decisions, and the trade-offs that drive them.

## Goal

Run bergamot's capture on a phone: as the user browses on mobile, capture browsing **metadata** (URL, timestamp, title, and the navigation/session graph) and sync it to the user's own storage, so mobile browsing feeds the user's trail/session graph — and, after re-download server/desktop, their research corpus.

Capture is **privacy-first** (see the privacy model: `privacy-preserving-capture-model.md`): the mobile app captures **metadata only — never page content**. It does **not** download or archive page content on-device. Content is obtained later, server-side or on the desktop, by **re-downloading the public URL**; the login wall is the privacy filter (authenticated/paywalled pages fail to re-download and are excluded). This keeps the on-device footprint to metadata only.

Mobile web browsers do not support extensions and cannot talk to a `localhost` server, so the desktop model (an MV3 extension POSTing to a local server) does not transfer. The capture must live inside a browser app the project ships, and it must sync to the user's own devices rather than localhost.

## Prerequisite: privacy model + user-owned sync transport

This work builds on two foundations:

1. **The privacy model (`privacy-preserving-capture-model.md`)** — metadata-only capture; content is re-downloaded from the public URL server/desktop, where the login wall excludes authenticated pages. No page content is captured or cached on the device. This defines _what_ is captured.
2. **A user-owned sync transport** — _how_ visits reach the user's desktop. The strongest privacy posture is device-to-device: the shared capture core writes visit files locally and a user-owned sync (P2P / a synced inbox folder on Android; the user's own iCloud / CloudKit on iOS) replicates them into the desktop's existing file-based inbox, which the existing `VisitQueueProcessor` already ingests. This reuses the desktop pipeline and means **no developer-controlled server is required** — a developer relay is an optional fallback, not a prerequisite.

The visit metadata format (visit id, URL, timestamp, title, session/referrer/group metadata) is reused from the desktop pipeline — only the transport changes (user-owned sync instead of localhost POST).

## Agreed architecture: one shared capture core + thin native shells

The native/engine layers cannot be shared — Android (Kotlin) and iOS (Swift) use different languages and different web engines. But the _valuable, complex_ part of bergamot's capture is JavaScript that runs in the page, and it ports across both platforms unchanged. The architecture is therefore **one shared TypeScript capture core injected on both platforms, wrapped by two thin native browser shells** — not two parallel reimplementations.

This is the key decision: do **not** duplicate capture logic in Kotlin and Swift. Duplicating the hardest, most bug-prone part doubles maintenance forever.

### What is shared vs. native

| Layer                                                                                 | Android                                | iOS                                    | Shared?                   |
| ------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------- | ------------------------- |
| Metadata + session-graph capture (URL, timestamp, title, referrer/opener/group)       | injected JS                            | injected JS                            | Shared TS                 |
| SPA detection (`pushState`/`replaceState` monkey-patch + `popstate` + Navigation API) | injected JS                            | injected JS                            | Shared TS                 |
| Visit/session payload model + sync client                                             | shared JS                              | shared JS                              | Shared TS                 |
| Transport shim (`sendToNative(payload)`)                                              | `connectNative` / `postMessage` bridge | `webkit.messageHandlers.x.postMessage` | ~10 lines each            |
| Full-page navigation boundaries                                                       | `WebViewClient` / `NavigationDelegate` | `WKNavigationDelegate`                 | Native, trivial           |
| Cross-tab/window lifecycle (new tab, opener, switching)                               | native                                 | native                                 | Native; data model shared |
| Browser UI (tabs, address bar)                                                        | Kotlin                                 | SwiftUI                                | Native                    |

The shared core maps onto the desktop split already present in `browser/`: the content-script capture logic (`content.ts`), the background session/enrichment logic (`background.ts`, message routing), and the API client (`api_client.ts`). These become a platform-agnostic package; the native shells provide the transport, tab lifecycle, and UI the desktop extension got from Chrome APIs.

Because iOS forces SPA detection into page-JS anyway (Safari has no `webNavigation.onHistoryStateUpdated`), all navigation detection is standardised in the shared JS core. The native layer only provides full-page-load boundaries and cross-tab lifecycle. This maximises sharing and keeps the two shells near-symmetric.

## Open decision 1 — Android engine: System WebView vs. GeckoView

Both inject the same shared capture core; they differ in engine ownership and maintenance profile.

|                                | Android System WebView                                                               | GeckoView (embed)                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Injection                      | direct `evaluateJavascript` / `WKUserScript`-style                                   | requires a bundled built-in WebExtension (GeckoView has no native DOM API)                                                  |
| Nav events                     | `WebViewClient.onPageStarted/Finished` (coarse; SPA handled in shared JS)            | rich `NavigationDelegate` (ordered `onLoadRequest → onPageStart → onLocationChange → onPageStop`, ≈ `chrome.webNavigation`) |
| Engine security upkeep         | OS ships updates — **zero** engine maintenance                                       | Mozilla patches engine; bump a versioned AAR (light–moderate)                                                               |
| Engine consistency             | version varies by device/user — fragmentation, long tail of "works on my phone" bugs | **one pinned engine** shipped in the APK — identical everywhere                                                             |
| APK size                       | small                                                                                | larger (bundles Gecko)                                                                                                      |
| Architecture symmetry with iOS | **symmetric** (both direct-inject)                                                   | asymmetric (extension vs. user-script injection)                                                                            |
| Extension sandbox              | none                                                                                 | real (relevant only if hosting third-party extensions later)                                                                |

**Trade-off summary:** System WebView gives the lightest update burden and symmetry with iOS, at the cost of engine-version fragmentation. GeckoView gives one consistent pinned engine and richer native nav events, at the cost of a heavier (but not fork-level) dependency and an asymmetric injection model. Neither requires forking a browser.

**Leaning:** start with **System WebView** for a symmetric, fastest MVP (mirror-image shells around the shared core); treat **GeckoView as a known, isolated upgrade path** for Android if WebView engine-version fragmentation hurts capture fidelity or if real extension hosting is wanted later. Swapping the Android engine never touches the shared core or iOS.

**Why not fork Chromium (Cromite / Brave brave-core):** forking a full Chromium browser means owning a continuous security-rebase treadmill (Chromium ships every ~1–4 weeks; this is why Bromite died). Cromite is alive and Android-buildable but is an ad-block/privacy browser, not an extension platform; Brave's `brave-core` (MPL-2.0, one codebase for mobile+desktop) is forkable but inherits the rebase burden. Embedding an OS/vendor-maintained engine avoids becoming a browser vendor.

**Why not rely on running the existing MV3 extension as-is on a mobile Chromium fork:** Kiwi Browser pioneered Chrome extensions on Android (patching the Tabs and Web Navigation APIs bergamot uses) but was archived in early 2025, and support was always partial (many APIs stubbed behind `#if 0`). Firefox-for-Android add-ons drop `history`/`sessions` entirely and degrade `tabs`. The shared-core-injection path is more reliable than depending on partial mobile extension support.

## Open decision 2 — iOS approach: WKWebView app vs. Safari Web Extension

Non-WebKit engines on iOS are **EU-only** (BrowserEngineKit + Web/Embedded Browser Engine Entitlement, iOS 17.4+) and as of late 2025 effectively none had shipped — so a real alternative engine is not a viable universal path. The choice is between a WebKit-based app you own and a Safari extension.

|                      | WKWebView app (recommended)                                     | Safari Web Extension                                                                                                                                 |
| -------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM capture          | JS injection (`WKUserScript` + `WKScriptMessageHandler`)        | content scripts (`scripting.registerContentScripts`, Safari 16.4+)                                                                                   |
| Navigation           | `WKNavigationDelegate` + shared-JS SPA detection — full control | `webNavigation` **lacks `onHistoryStateUpdated`** etc., so SPA must use content-script History monkey-patch or the W3C Navigation API (Safari 26.2+) |
| Fit with shared core | clean — same injected core as Android                           | partial — MV3 loads but ignores unsupported APIs                                                                                                     |
| Review risk          | low–moderate (metadata-first, user-owned sync)                  | low–moderate, same data profile                                                                                                                      |

**Leaning:** a **WKWebView-based app** is the cleanest iOS path — you own injection timing and navigation, it reuses the same shared capture core, and it sidesteps every Safari-extension limitation. Treat it as a later port once the capture-to-cloud pipeline is proven on Android.

## Effort & maintenance (estimate — not independently sourced)

- **Android MVP** (System WebView shell + shared core port + user-owned sync + basic browser UI): ~2–4 person-months for someone comfortable with native Android (Kotlin) plus the existing TypeScript. iOS port adds incremental effort on top, reusing the shared core.
- **Maintenance:** using OS/vendor-maintained engines converts "maintaining a browser" into "maintaining two normal apps + one JS library." No security-rebase treadmill. Recurring costs are: testing the shared capture JS against **two engines** (Blink in Android WebView, WebKit in WKWebView), each OS's yearly SDK/API churn, Android WebView version fragmentation, and two store relationships.

Person-month figures are inferential; the research could not source effort numbers.

## Distribution & store policy

The metadata-first, user-owned-sync posture is a minimal, defensible data footprint. Because data syncs device-to-device under the user's control (no developer-controlled server), the App Privacy labels can be minimal — potentially **"Data Not Collected"** by the developer when sync is end-to-end between the user's own devices. This is the strongest review position available.

It is not a free pass: browsing history is sensitive, so the app still needs **opt-in consent, a privacy policy, and accurate App Privacy labels**, plus user controls (pause, exclude, view, delete).

- **Android:** Google Play prominent-disclosure still applies to browsing-history collection. **Sideloading / F-Droid remains the lower-friction channel** and avoids Play-specific friction.
- **iOS:** review risk is low because only metadata leaves the device, and it travels over the user's own iCloud (CloudKit) sync transport, which Apple treats favorably. Non-WebKit engines remain EU-only, but the recommended WKWebView path is unaffected.

## Capture specifics to verify during implementation

- Per-site permission/consent friction (host permissions, Safari Ask-mode prompts) and its effect on silent background-capture UX.

## Key sources

- GeckoView docs & `NavigationDelegate` Javadoc (Mozilla) — navigation hooks, built-in WebExtension + native messaging.
- `extensionworkshop.com` desktop-vs-Android extension differences — `history`/`sessions` unsupported on Firefox-for-Android.
- `github.com/kiwibrowser/patches` — canonical (unmaintained) Android extension-support patch; Kiwi archived early 2025.
- `github.com/uazo/cromite`, `github.com/brave/brave-core` — Chromium fork bases.
- Apple Developer: alternative browser engines (EU-only, BrowserEngineKit) and Safari Web Extension browser-compatibility (no `webNavigation.onHistoryStateUpdated`).
- Google Play prominent-disclosure policy; Apple App Store Review Guidelines.

## Bottom line

The realistic path is **not** forking a browser. It is: build a privacy-first capture once as a shared TypeScript core (metadata only, never page content — content is re-downloaded server/desktop, where the login wall excludes private pages), wrap it in two thin native browser shells (Android first, iOS second), and sync to the user's own devices (P2P / inbox-folder on Android, the user's own iCloud on iOS) — with a developer relay only as an optional fallback. Android is genuinely feasible as a multi-month effort; iOS is more constrained but viable via WKWebView. The metadata-first, user-owned-sync posture turns the original store-review concern into a strength, and reusing the desktop's existing file inbox means little-to-no new server is required.
