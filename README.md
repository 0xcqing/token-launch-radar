# Token Radar

Token Radar is a static, offline radar for pre-token crypto protocols. It reads one sealed DefiLlama
snapshot, covers every slug on the snapshot's watchlist, adds the pre-token protocols the watchlist
leaves out, and ranks them by a single transparent **implied value**. Every ranked protocol carries a
value breakdown, a plain-English "why this value" sentence and a four-step farm plan with an explicit
cost and time. Protocols whose token already trades are held strictly apart in their own market view;
they are never mixed into the implied-value ranking.

This is the entry for the **Token Radar** bounty:
<https://make.fun/bounty/token-radar-01>

## What you get

Running the program writes:

| Output | What it holds |
| --- | --- |
| `out/board.json` | `{"rows": [...]}` — the ranked pre-token board, one object per protocol |
| `out/data.js` | `window.RADAR` — the dashboard's whole dataset, loaded by a classic `<script>` tag |
| `out/dashboard/` | `index.html`, `app.js`, `app.css` — the page |
| `out/screenshots/` | at least three images: the board, a detail view and a filtered view |
| `out/dossier.json` | the make.fun dossier, built by `vendor/makefun-board.ts` |

The page uses no framework, no `fetch`, no network and no external asset. It works from `file://`
because every byte it shows arrives in `out/data.js`.

## The implied-value model (version radar-2.1)

Every pre-token protocol goes through the same deterministic function. No protocol name is
special-cased; only the snapshot's own figures are read: **TVL**, **seven-day TVL growth**, **age
without a token** (`as_of` minus `listed_at`), **chain count**, **category**, and **funding** when a
snapshot carries it (this snapshot does not).

```
implied = TVL
        × category weight
        × (1 + clamp(7d growth, -60%, +150%) × 0.35)
        × (0.60 + min(age days, 1460) ÷ 1460 × 0.40)
        × (1 + min(chains, 8) × 0.03)
        × (1 + min(funding ÷ $50M, 1) × 0.15)
```

In words:

- **TVL × category weight** is the base. Larger books are worth more, and a category where a token
  captures fee or spread value is worth more per dollar of TVL.
- **Seven-day growth** is clamped to −60%..+150% and multiplied by **0.35**, so momentum matters
  without letting one outlier week dominate.
- **Age without a token** is the best record of how long the protocol has run with no token. The
  multiplier rises from **0.60× to 1.00×** over **1,460 days**; an unlisted age assumes **240 days**.
  A longer record means more accumulated usage and stronger launch pressure.
- **Chain count** adds **0.03× per chain**, capped at **8 chains**, as a small reach premium.
- **Funding**, when present, adds up to **0.15×** for up to **$50M** of disclosed funding. This
  snapshot carries none, so every row uses 1.00×.

### Category weight table

Categories are matched by keyword; the first match wins. An unmapped category uses **0.18×**.

| Category | Weight |
| --- | --- |
| Lending & credit (lending, CDP, collateral, credit) | 0.30 |
| Trading & liquidity (DEX, leveraged farming, liquidity manager) | 0.26 |
| Derivatives (derivatives, perpetuals, basis, options) | 0.24 |
| Yield & staking (yield, staking pools, restaking) | 0.22 |
| RWA & BTC (RWA, BTC) | 0.20 |
| Infrastructure (chain, payments, privacy, indexes, bridges) | 0.18 |
| Curators & allocators (risk curators, allocators, governance) | 0.14 |
| Insurance | 0.14 |
| Stable assets | 0.10 |
| Unclassified / other | 0.18 |

The dashboard prints this same table, the formula, each row's factors and the "why this value"
sentence, so the screenshots and the code tell the same story.

## Watchlist coverage and the live-token split

The snapshot's `watchlist` is the coverage floor, never a ceiling. On this snapshot it holds **40**
protocols at or above the **$50M** floor with no token on record. The board covers all **40**, then
adds pre-token protocols the watchlist left out: **198 ranked rows** in total, **158** of them beyond
the watchlist. Wrapped, staked, versioned, bridge and exchange products are filtered out by the same
rule the house used.

A protocol is pre-token when both `gecko_id` and `symbol` are null. Protocols that record a token are
shown in the separate **Live token** view with their market cap as a fact, not a model value.

## Farm plans

Each ranked protocol gets four concrete steps, derived from its own category, chains, TVL and age:

1. fund a dedicated wallet on the first chain, with an explicit capital and gas cost;
2. enter the category-specific position (supply, LP, stake, mint, allocate, bridge and so on);
3. mirror a smaller position on a second chain when the protocol is multi-chain, or make the weekly
   qualifying action when it is not, for a hold window that scales with the protocol's age;
4. log the wallet and transactions, then claim only from the protocol's official rewards page.

Every step states a cost in USD (or `free`) and a time estimate.

## How to run

Node 22+ runs the TypeScript directly, with no build and no dependencies:

```sh
node main.ts --input D:\makefun-work\tr-kit\token-radar-01-kit\input --output out
```

Or point `--input` directly at a snapshot file:

```sh
node main.ts --input path\to\snapshot.json --output out
```

The program prints a summary with protocols scanned, pre-token count, board size, watchlist coverage,
top implied value and the files it wrote. It refuses to write a board that misses a watchlist slug,
has fewer than 100 rows, is not ranked correctly, or has a malformed farm plan.

## Repository layout

```
main.ts                 input/output contract, board.json, data.js, copies, dossier
lib/model.ts            snapshot parsing, implied-value model, farm plans, live split, gate check
dashboard/index.html    the page shell
dashboard/app.css       dark editorial palette, spacing and type
dashboard/app.js        sorting, filtering, detail drawer, live-token view
screenshots/            board, detail and filtered views
vendor/makefun-board.ts the sealed dossier library (unmodified)
```

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/0xcqing/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/0xcqing/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Bounty: https://make.fun/bounty/token-radar-01
