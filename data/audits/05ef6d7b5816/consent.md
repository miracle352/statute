# VIOLATION: Reject means reject

Kane recorded 5 tracker requests after the visitor clicked "Reject", 2 before they had chosen anything. After "Reject", the same visitor ID kept going out (Google Analytics client ID (_ga cookie): 546690339.1794759081; Google Analytics client ID (_ga cookie): 1754379113.1794759126).

Kane clicked **Rejecting non-essential cookies** at 2026-11-15T16:11:19.511Z.

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
| After "Reject" | googletagmanager.com | GET https://www.googletagmanager.com/gtag/js | 2 |  |  |
| After "Reject" | google-analytics.com | POST https://www.google-analytics.com/g/collect | 3 | https://www.base.org/stocksmaxxing, https://www.base.org/trading | Google Analytics client ID (_ga cookie): 546690339.1794759081; Google Analytics client ID (_ga cookie): 1754379113.1794759126 |
| Before any choice | googletagmanager.com | GET https://www.googletagmanager.com/gtag/js | 1 |  |  |
| Before any choice | google-analytics.com | POST https://www.google-analytics.com/g/collect | 1 | https://www.base.org/stocksmaxxing | Google Analytics client ID (_ga cookie): 1716085680.1794759040 |

## How to fix

Load each tracker listed above only after the visitor accepts. Before a choice, and after Reject, the tags must not load at all (hiding the banner is not enough). Check the stored choice on every page load, before any tag script is added. Keep the tags working after Accept.

## Evidence

- Sealed Kane evidence pack: `consent-1794759158018.evidence` (open with `kane-cli evidence serve <path>`)
- Kane run: https://test-manager.lambdatest.com/projects/01M7E4JR87M8V8X3PY5SPEP2E6/test-cases/01M7FZJ2AEVF5BERZ546Z33WZQ/dashboard/share/US_0ETVTNQTJUD0B4PZN8ECFGCDQ10HJQKRM3NUSSJJOI35MZN1P09JS1NMG50O0MH5?type=summary&agentView=true&fqdn=summary-page
- Credits used: 22.7
