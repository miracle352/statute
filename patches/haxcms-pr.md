Gate Google Analytics behind an Accept/Decline banner (#2955)

Refs haxtheweb/issues#2955

When a site sets `metadata.site.settings.gaID`, `index.html` and `ghpages.html` load gtag.js and send a `page_view` with a client ID as soon as `haxcms-ready` fires. The visitor never gets a choice, which is the gap #2955 describes (ePrivacy Art. 5(3), GDPR Art. 7).

This keeps the change inside the existing loader script in both boilerplate files:

- Sites without a `gaID` behave exactly as before: no banner, nothing loads.
- With a `gaID` and no stored choice, a small banner shows **Accept** and **Decline**. Nothing from Google loads until Accept.
- The choice is saved in `localStorage` (`haxcms-analytics-consent`), so the banner shows once. Decline keeps GA off on later visits; Accept loads it on later visits without asking again.
- `gtag('config', …)` and the script tag are only created on Accept.

I only touched the two Node boilerplate files. The issue mentions a `haxcms-cookie-consent.js` element in webcomponents as the long-term home and the PHP `getGaCode()` path; happy to follow up there if this approach looks right to you.

**How I tested it**

I served the boilerplate with a two-page `site.json` that has a test `gaID`, and drove it in Chrome:

| Case | Requests to googletagmanager.com / google-analytics.com |
|---|---|
| Before any choice | 0 (banner shown) |
| Decline, then reload | 0 (no banner on reload) |
| Accept, then reload | gtag.js loads and page_view is sent |

Before the change, the same page sent the gtag.js request and a `page_view` hit with a client ID on load.

I also ran it through Kane CLI (TestMu AI's browser agent), which clicked Decline and Accept itself and recorded the traffic. The run is here: https://statute-production.up.railway.app/cases/haxcms.html
