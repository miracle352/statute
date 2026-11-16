# Statute

**Your Reject button might be lying. Statute sends Kane CLI to find out.**

Paste a website. Kane CLI opens it in a real Chrome, clicks Reject on the cookie banner, keeps browsing and records every request. Code, not a model, reads Kane's sealed evidence pack and decides whether trackers still fired. On your own app, the report goes to your coding agent, and Kane comes back to prove the fix. A fix only counts when Kane says so.

Built for the [Kane CLI Online Hackathon](https://www.kaneclihack.sh/) (12 to 19 November 2026).

## Start here

| Time | What | Where |
|---|---|---|
| 1 min | Watch Kane audit our demo shop live, in a real browser on our server | [statute-production.up.railway.app](https://statute-production.up.railway.app) → "Watch Kane audit our demo shop" |
| 1 min | A real open-source fix: Kane finds HAXCMS loading Google Analytics with no way to refuse, Claude Code adds a banner, Kane proves Decline and Accept | [Case file](https://statute-production.up.railway.app/cases/haxcms.html) · [PR haxtheweb/haxcms-nodejs#289](https://github.com/haxtheweb/haxcms-nodejs/pull/289) · [issue #2955](https://github.com/haxtheweb/issues/issues/2955) |
| 1 min | The Statute Census: 7 of 15 popular European sites kept tracking after Reject, each checked by hand | [Census section](https://statute-production.up.railway.app/#census) |
| 1 min | The GitHub Action commenting a violation on a real pull request | [The PR](https://github.com/miracle352/statute/pulls?q=is%3Apr+%22Test+the+Statute+action%22) |
| 2 min | Run it yourself with no Kane credits and no login | `git clone https://github.com/miracle352/statute && cd statute && npm run demo` |
| 10 min | Run the whole loop on your machine (Kane CLI and Claude Code needed, about 31 credits) | `npm run demo:fix` |

`npm run demo` needs only Node 22. It re-judges four recorded loops (the demo shop's Reject, price and cancel checks, and HAXCMS) from their sealed Kane evidence packs in `replays/` and rebuilds each case file in `statute-report/replay/`. Nothing is sent to Kane.

## The checks

| Check | The rule | Laws it comes from |
|---|---|---|
| Reject means reject | After a visitor refuses cookies, no analytics or ads tag may load and no visitor ID may leave the browser. | ePrivacy Directive 2002/58/EC Art. 5(3); GDPR Art. 4(11) and Art. 7; California Civil Code §1798.120 |
| Accept still works | After Accept, the site's tags load. This is the guard that stops an agent from "fixing" the first check by deleting analytics. | |
| Cancel as easy as signup | A subscription started online can be cancelled online, in no more steps than it took to start. | Cal. Bus. & Prof. Code §17602; German Civil Code §312k; EU Directive 2023/2673 Art. 11a |
| The price shown is the price paid | Kane reads the price on the product page and the total at checkout; code compares them after taking off shipping and tax. | California Civil Code §1770(a)(29) (SB 478); UK DMCC Act 2024 s.230; EU Directive 2011/83/EU Art. 6(1)(e) |

## How a verdict is made

1. **Kane visits.** `kane-cli run --agent` drives Chrome with a plain-English objective: deal with the cookie banner first by refusing, open a page, reload. Kane seals the run into an evidence pack: HAR files, an action log with timestamps, screenshots.
2. **Code judges.** `src/packs/consent.js` reads the pack. It finds the moment of the Reject click in Kane's action log, splits every request into before and after that moment, and matches hosts against a tracker list (`rules/trackers.json`). It pulls Google Analytics client IDs out of `/g/collect` hits, so "the same visitor ID went out after Reject" is a fact from the traffic, not a guess. Two things are shown but not counted: Google Consent Mode hits that say consent was denied, and Google Tag Manager's own code loading with no measurement hit.
3. **Your agent fixes.** `statute fix` hands the report, the rule and the law to Claude Code (`claude -p`, edit tools only, working in your app's folder). It restarts your app and sends Kane back.
4. **Kane proves.** The loop stops when Reject passes *and* Accept still loads the tags, or after three rounds. The case file shows every round with Kane's screenshots and share links.

## Use it in CI

Add Statute to any repository. Every pull request gets Kane in a real browser, a verdict computed by code, a comment on the PR and the case file as an artifact. The job fails on a violation.

```yaml
# .github/workflows/statute.yml
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  statute:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: miracle352/statute@main
        with:
          check: consent                 # or price, cancel
          url: http://localhost:3000     # or your PR preview URL
          start: npm ci && npm start     # leave out when checking a preview URL
          lt-username: ${{ secrets.LT_USERNAME }}
          lt-access-key: ${{ secrets.LT_ACCESS_KEY }}
```

See it on a real pull request in this repository: [the PR](https://github.com/miracle352/statute/pulls?q=is%3Apr+%22Test+the+Statute+action%22) where the Action ran on the demo shop and commented the violation.

Set `LT_USERNAME` and `LT_ACCESS_KEY` as repository secrets (your TestMu AI username and access key). Each run costs Kane credits, about 20 to 40 per check. This repository runs the Action on its own demo shop in [`.github/workflows/statute.yml`](.github/workflows/statute.yml); the shop ships with its bugs on purpose, so that job reports violations without failing.

## The live site

`server/index.js` serves the site, the demo shop at `/demo`, and live audits. When you start one, the server launches Chrome, Kane drives it, and the console streams Kane's steps, a screenshot of Kane's tab every 0.7 seconds and every request the browser sends. The verdict comes from Kane's evidence pack when the run ends.

Guard rails: public `http`/`https` sites only (private, internal and metadata addresses are refused), 40 live audits a day, and a site audited in the last 24 hours shows its saved result. Live audits run the Reject check; the cancel check needs an account and runs on the demo shop.

## The Census

`bin/census.js` ran the Reject check on 31 popular sites in 17 countries. The first pass ran from my machine. Every site that could not be judged from there was run again from a TestMu AI cloud browser in the site's own country (`kane-cli run --ws-endpoint` with a `geoLocation` capability), so it showed the banner a local visitor sees: 14 sites, 13 of them in Europe.

- 15 were judged. **7 kept tracking after Reject or before any choice.** 8 held up.
- 7 blocked automated browsers and 9 could not be run (more on that below), so they are listed as not judged.
- Every flagged site was checked by hand against its evidence. One was a false alarm: only Google Tag Manager's code had loaded. We changed the rule in code and re-judged everything from the saved packs (`node bin/census.js --rejudge`), so it is now listed as held up, with a note saying so.
- Site names stay private (`census/private/`, not in git). The site shows them as "an Italian news site" and so on.

## What it doesn't do

- **It is evidence, not legal advice.** Statute shows what a browser did and when. Whether that breaks the law where you operate is for a lawyer.
- **A pass is about one visit.** Kane refuses, opens one page and reloads. A tracker that only fires on checkout or after a scroll would be missed.
- **The tracker list decides what counts.** A tracker missing from `rules/trackers.json` is not seen. First-party analytics on the site's own domain is not counted.
- **Kane proves the law, not the whole change.** On HAXCMS, Claude Code's fix passed both Kane checks but showed the banner on sites with no Google Analytics ID at all, which the issue says should stay unchanged. Kane only tested a site that had an ID. A person caught it, and the upstream PR uses a version that skips the banner when there is no ID.
- **My setup mistake, caught by the loop.** On the first HAXCMS run I had left an already-fixed copy of one template file in the example folder, and Claude Code copied it. Its own report said so. I restored the original files, moved my patch out of the folder and ran the loop again; the second run is the one published.
- **Location matters.** Run from Nigeria, most European sites showed no banner at all, so they could not be judged. That is why the Census switched to in-country cloud browsers. After 16 sessions the cloud browsers stopped accepting new runs on this account, so 9 sites outside Europe were never run.
- **Kane once filed a fee as shipping.** The first version of the price check asked Kane for "the shipping cost", and Kane put the shop's €4.99 service fee there, so the check passed when it should have failed. Now Kane only copies each checkout line with the shop's own name for it, and code decides which lines are shipping or tax.
- **Kane's own timeout is not always kept.** One cloud run hung for hours. Every Kane run now has a hard limit (`src/kane.js`), and the run is recorded as not judged.
- **Some sites block automated browsers.** Those are listed as not judged, never as passes.

## Run it locally

Node 22, [Kane CLI](https://www.npmjs.com/package/@testmuai/kane-cli) (`npm i -g @testmuai/kane-cli && kane-cli login`), and Claude Code for the fix loop. No npm install: Statute has no dependencies.

    npm run demo              replay recorded runs, no credits
    npm start                 the site on http://localhost:8080, live audits included
    npm run check:consent     one Reject check on the demo shop
    npm run demo:fix          find, fix and prove on the demo shop
    npm run demo:reset        put the demo shop's bugs back
    npm run check:price       one price check on the demo shop
    npm run demo:fix-price    find, fix and prove the hidden checkout fee
    npm run demo:hax          find, fix and prove on the HAXCMS template
    npm run demo:hax-reset    put HAXCMS's original files back

    node bin/statute.js check consent --url <url> [--start "<cmd>"]
    node bin/statute.js fix consent --url <url> --start "<cmd>" --app <dir>

To host it: the `Dockerfile` installs Chrome and Kane CLI. Set `LT_USERNAME` and `LT_ACCESS_KEY` so Kane can sign in on the server.

## Layout

    src/kane.js          runs kane-cli, reads its event stream, hard time limit
    src/evidence.js      reads Kane evidence packs (HAR, action log, screenshots)
    src/packs/           the checks: consent, consent-accept, cancel, price
    src/agent.js         hands a report to Claude Code
    src/page.js          builds the case file from sealed evidence
    bin/statute.js       check, fix, replay
    bin/census.js        the Census runner, --rejudge
    server/              the live site, audit queue, Chrome and its live view
    demo-store/          Lumen, a shop with deliberate compliance bugs
    examples/haxcms/     HAXCMS's site template, unchanged, with a GA ID set
    replays/             recorded Kane runs for the zero-credit demo

Photos on the site: Wikimedia Commons (CC0 and public domain). HAXCMS template: Apache-2.0.
