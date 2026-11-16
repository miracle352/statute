I ran an outside check on the live site today (16 Nov) and this is still happening on production.

I used Kane CLI (TestMu AI's browser agent) to visit https://cruisinginthewake.com/ in a real Chrome as a first-time visitor, open About, and reload. There was no consent prompt at any point, and GA4 sent 6 `g/collect` hits with a `_ga` client ID across `/` and `/about-us.html` before the visitor could make any choice. The gtag snippet is included directly in the page, so it runs on every load.

Evidence from that visit (Kane's screenshots, the request log and the sealed evidence pack): https://statute-production.up.railway.app/cases/in-the-wake.html

If it helps with the fix: since the snippet is copied into every page, the smallest change is probably to replace it everywhere with one shared script that only injects gtag after a stored "accepted" choice, and shows an Accept/Decline prompt when there's no choice yet. Then later changes only touch that one file. Happy to share the version I tested elsewhere if useful.
