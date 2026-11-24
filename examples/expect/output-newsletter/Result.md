---
test: ../newsletter_test.md
status: passed
started: 2026-11-24T11:05:26.423Z
duration_s: 90
session_id: 33c15cbf-5f44-4550-9e6f-40280c2f5259
---

# Lumen: the newsletter keeps the email address private — Result

## Accept cookies ✓ passed (3s)
md5: d2368411697b9b0df4ed2db74c8c284d
Go to {{url}}. In the cookie banner, click Accept all.

## Sign up for the newsletter ✓ passed (60.6s)
md5: a9e761f8f2f8bd8475fc1e060608f4db
Type jane.doe@example.com into the newsletter email field and click Sign up. Then wait 10 seconds, so the page's tags have time to send.

## Confirmation ✓ passed (17.5s)
md5: 63305a01dd6e92ad8bd285a4593172fc
Verify the page says the visitor is on the list.
