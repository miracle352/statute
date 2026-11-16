# VIOLATION: Reject means reject

Kane found no way to refuse cookies, and 6 tracker requests went out before the visitor made any choice.

## Rule

When a visitor refuses cookies, no advertising or analytics tracker may load, before the choice or after it, and no visitor ID may be sent to a tracker.

## Why it matters

- **ePrivacy Directive 2002/58/EC, Art. 5(3)**: storing or reading non-essential data on a device needs prior consent
- **GDPR (EU) 2016/679, Art. 4(11) and Art. 7**: consent must be freely given and as easy to withdraw as to give
- **California Civil Code §1798.120 (CCPA/CPRA)**: consumers may opt out of the sale or sharing of their personal information

_Evidence, not legal advice._

## Tracker requests Kane recorded

| When | Tracker | Endpoint | Times | Pages | Visitor ID sent |
|---|---|---|---|---|---|
| During the visit | googletagmanager.com (tag manager code only, not counted) | GET https://www.googletagmanager.com/gtag/js | 3 |  |  |
| During the visit | google-analytics.com | POST https://www.google-analytics.com/g/collect | 6 | https://cruisinginthewake.com/, https://cruisinginthewake.com/about-us.html | Google Analytics client ID (_ga cookie): 1321631677.1794849994 |

## How to fix

Load each tracker listed above only after the visitor accepts. Before a choice, and after Reject, the tags must not load at all (hiding the banner is not enough). Check the stored choice on every page load, before any tag script is added. Keep the tags working after Accept. If the site has no way to refuse yet, add a small banner with Accept and Decline buttons.

## Evidence

- Sealed Kane evidence pack: `C:\Users\IYANUOLUWA\statute\statute-report\evidence\consent-1794850070387.evidence` (open with `kane-cli evidence serve <path>`)
- Kane run: https://test-manager.lambdatest.com/projects/01M7E4JR87M8V8X3PY5SPEP2E6/test-cases/01M7JPA5RPHYZMWZSRK6A0BQFD/dashboard/share/US_LK5DHP7GHEDPQQ3OGDHG38EX97X3ETPA9F1Q2YDP2QPFOMN4467TF68XSK8LWAD4?type=summary&agentView=true&fqdn=summary-page
- Credits used: 20.0
