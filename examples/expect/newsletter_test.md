---
mode: testing
tags: [statute, privacy]
---

# Lumen: the newsletter keeps the email address private

<!-- expect
- text "jane.doe@example.com" never leaves this site
- what was typed in "Sign up for the newsletter" never leaves this site
- no server errors
- no failed requests to this site
-->

## Accept cookies
Go to {{url}}. In the cookie banner, click Accept all.

## Sign up for the newsletter
Type jane.doe@example.com into the newsletter email field and click Sign up. Then wait 10 seconds, so the page's tags have time to send.

## Confirmation
Verify the page says the visitor is on the list.
