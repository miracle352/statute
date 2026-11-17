# Statute's laws as Kane CLI tests

Proven on a real run: on the demo shop Kane reported PASSED (the steps ran) and Statute judged the same pack a VIOLATION. The recorded run is in `replays/kane-testmd-demo-shop`.

Each law is a plain Kane CLI test file. Kane runs it and seals the evidence; Statute's code reads the sealed pack and decides the verdict against the law. Kane's own pass or fail only says the steps ran.

```bash
kane-cli testmd run laws/reject_means_reject_test.md --variables '{"url":{"value":"https://your-site.com"}}'
# PowerShell: write the variables to a file instead
#   '{"url":{"value":"https://your-site.com"}}' | Out-File -Encoding ascii vars.json
#   kane-cli testmd run laws\reject_means_reject_test.md --variables-file vars.json
npx github:miracle352/statute judge consent --latest
```

| Test file | Judge with | Law |
|---|---|---|
| `reject_means_reject_test.md` | `statute judge consent --latest` | GDPR, ePrivacy Directive, CCPA |
| `accept_still_works_test.md` | `statute judge consent-accept --latest` | the fix didn't just switch tracking off |
| `price_shown_is_price_paid_test.md` | `statute judge price --latest` | California SB 478, UK DMCC Act 2024, EU Directive 2011/83/EU |
| `cancel_as_easy_as_signup_test.md` | `statute judge cancel --latest` | click-to-cancel rules |

`--latest` reads the newest sealed pack in `.testmuai/evidence/` or your Kane sessions folder. Pass `--evidence <file>` to judge a specific pack. Exit codes: 0 pass, 1 violation, 3 not judged.

Kane replays steps that passed before, keyed on the step's text, not on the variables. When you point a law at a different site, delete its `output-<name>/` folder first, or Kane may replay the old site's steps.
