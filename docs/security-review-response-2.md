# Response to the second Kickback security review (23 Nov 2026)

Review: https://claude.ai/artifact/SJ3PTt9Upv6eE4a7afjZmU

Wei Wei's choice on the contract findings: **prepare v2 and test it, deploy only on her go.** Nothing has been deployed. The live v1 factory (0xEAC922d8AAC8f32cb9832f52Ac878B2a94772F8B) is unchanged, and the site still reads it.

Commits:
- Site and contract copy: `weiwei-ooi/kickback` main `2e479f1`
- Protocol (canonical contracts): `weiwei-ooi/devcon-side-event-kickback` main `fac1a37`

## Contracts v2 (written and tested, not deployed)

| Change | Why |
|---|---|
| `eventEnd` can be at most 2 years ahead (`MAX_LEAD_TIME`), and the list deadline at most 90 days after the end (`MAX_SETTLEMENT_WINDOW`) | An organiser could set dates far in the future and lock guests' deposits for decades. |
| `reject` (turn a guest away) works only before `eventStart` | After the start, an organiser could turn away a guest who came, which takes away their share. **Trade-off:** walk-ins who book during the event can no longer be turned away. |
| `recoverSpare` of another token checks that the event token's balance did not drop | Tokens with two addresses for one balance could be used to take the deposits. |

Tests: 21/21 protocol tests (ganache) and 36/36 fork tests (hardhat) pass, including the new BadConfig cases and reject timing.

**After her go:** v2 needs a new factory, so `deployments/ethereum.json` and the site config must point to the new address. Events already made on v1 stay on v1. There are none yet.

## Site fixes (on main)

| Finding | Fix |
|---|---|
| F4: case text might not be on IPFS when a case opens | "Match" first reads the contract's own case description, checks that it hashes to the address the contract gives Kleros, and pins it through Kleros's IPFS service. If any step fails, nothing is sent. Unit tested. |
| F18: a guest with an open Kleros case after payouts read "Your deposit went to the guests who came" | The card now says "With Kleros" and links to the case. |
| F12, F40: dates a browser cannot show crashed the page | They show "date out of range". One broken event row can no longer take the home page down (error boundary). Deadlines keep the year when it isn't the current year. The create form limits the list deadline to 7–90 days. |
| F19: "Verified" badge suggested the organiser was checked | It is renamed "Proof of Presence contract" and says it checks the code, not the organiser. The home page lists only featured organisers' events (`NEXT_PUBLIC_FEATURED_ORGANISERS`, set to Wei Wei's organiser wallet in netlify.toml). Any other event still opens from its own link. |
| F9, F14: only the organiser could see or answer challenges | The list and challenges page is public, and the guest card links to it. Any connected wallet can match a challenge, which the contract already allows. |
| F71: guests were not told about appeals | The guest card for a case says "Send proof or appeal on the case page" and links to the case. |
| F64: guests did not see the challenge fee | "How it works" shows Kleros's current fee. The create form shows the fee too, and warns when it is above the deposit, because guests would then rarely challenge. |

## Not done in this round

- F2: a mainnet-fork test of the live addresses. This needs a mainnet RPC, so it runs on Wei Wei's Mac (`yarn test:fork`).
- F31: upgrading to Next.js 15 is a separate change and is deferred.
- F1, F49: not changed in this round.

## Tests on `2e479f1`

- 341 unit tests pass.
- 7 browser tests pass: the full organiser flow on a local chain, deposit-card states at 375 and 1280 px, receipt QR, and smoke. The 4 tests that only take screenshots are skipped by default.
- The production build (mainnet settings) succeeds.
