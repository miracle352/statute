---
name: statute
description: Use after changing anything that touches analytics or ad tags, cookie or consent banners, prices, fees or checkout totals, or subscriptions and cancellation. Kane CLI checks the running app against consumer law in a real browser and code judges the evidence; do not call the work done until it passes.
---

# Statute: prove the change is legal before calling it done

Functional tests can't see these bugs: the page works, and it still breaks the law. Statute sends Kane CLI to use the app like a visitor and judges what Kane recorded with code, not a model.

## When to run it

Run the matching check after any change that touches:

| The change touches | Check |
|---|---|
| analytics or ad tags (gtag, Google Tag Manager, Meta pixel, TikTok, LinkedIn, Clarity, Hotjar), cookies, a consent banner | `consent` |
| product prices, fees, surcharges, cart or checkout totals | `price` |
| subscribing, plans, renewals, cancelling | `cancel` |

If you are unsure, `npx -y @miracle352/statute` lists the checks. A change to styling or copy alone needs none.

## How

1. Start nothing yourself. Statute starts the app, sends Kane, and stops the app:

   ```bash
   npx -y @miracle352/statute check consent --url http://localhost:3000 --start "npm start"
   ```

   Use the project's real start command and port. For a deployed preview, pass its URL and leave out `--start`.

2. Read the exit code and the report it prints (also saved to `statute-report/<check>.md`):
   - `0` pass: say so, and quote the one-line verdict.
   - `1` violation: the report names every tracker request, fee or extra cancel step Kane recorded, and how to fix it. Fix exactly that.
   - `3` not judged: Kane could not finish or was not installed. Tell the user; do not report a pass.

3. After a fix, run the same check again. For `consent`, also run `consent-accept`: the fix must keep the tags working after Accept, so removing analytics is not a fix.

4. You are done only when the check passes. Never describe a fix as working before Kane has passed it.

To let Statute run the whole loop itself (Kane finds it, you fix it, Kane proves it, up to three rounds):

```bash
npx -y @miracle352/statute fix consent --url http://localhost:3000 --start "npm start" --app .
```

## Already have a sealed Kane pack?

Kane CLI test files for each law are in the Statute repository (`laws/*_test.md`). After `kane-cli testmd run ...`, judge the newest pack with no new run:

```bash
npx -y @miracle352/statute judge consent --latest
```

## Needs

Node 22 and Kane CLI (`npm install -g @testmuai/kane-cli`, then `kane-cli login`, or `LT_USERNAME` and `LT_ACCESS_KEY` set). Each check costs about 20 to 40 Kane credits.
