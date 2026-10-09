# DUST — "Your dust is a lottery ticket."

![status](https://img.shields.io/badge/network-TESTNET%20ONLY-orange) ![supply](https://img.shields.io/badge/supply-1B%20fixed-blue) ![team](https://img.shields.io/badge/team%20allocation-0%25-green)

DUST is a Solana meme coin built around one event: **the Great Sweep** — a 7-day window where anyone sweeps their dust (sub-$5 untradeable wallet balances) into the sweep vault. When the window closes, the **entire 1,000,000,000 DUST supply** is distributed **pro-rata to sweepers**, with a **per-wallet cap** so no whale's dust pile eats everyone else's.

No presale. No insiders. Zero team allocation — including the founder. After the sweep, the founder seeds a small, publicly disclosed liquidity pool (~$50), and DUST becomes a pure meme with the cleanest origin story in crypto.

> **TESTNET ONLY.** This repository contains devnet-tested mechanics. **DUST is not deployed on Solana mainnet.** A mainnet launch requires the founder's explicit word and is a separate, public, announced event. Anything claiming to be $DUST on mainnet before that announcement is a scam.

## The honesty baseline (read before you ape)

- **$100 → $1M is lottery math.** That is the entire point of the framing — a lottery ticket, not an investment thesis.
- **~95%+ of meme coins die**, most within days. DUST is an experiment with honest mechanics, not a promise of returns.
- **Nothing here is financial advice.** Never spend money you can't afford to lose. Most likely outcome for any meme coin: zero.
- There are **no profit promises** anywhere in this project — not in this README, not on the website, not in any announcement. Anyone promising DUST returns is lying.
- DUST has no utility, no roadmap to utility, and no team building utility. It is a meme with a fair distribution event.

Full disclosure: [`docs/HONESTY.md`](docs/HONESTY.md).

## How the Great Sweep works

1. **Sweep window (7 days).** Send any dust (SOL or SPL tokens below ~$5 — the balances too small to bother trading) to the published sweep vault address.
2. **Dust Census.** A live leaderboard ranks sweepers — biggest dust pile, funniest dust. All public, all on-chain.
3. **Distribution.** When the window closes:
   - Each sweeper's share = `their_dust / total_dust × 1,000,000,000 DUST`
   - **Per-wallet cap:** no wallet receives more than **0.5% of supply (5,000,000 DUST)**. Excess above the cap is redistributed pro-rata to uncapped sweepers (iterative water-filling — see [`docs/SWEEP_MECHANICS.md`](docs/SWEEP_MECHANICS.md)).
   - Dust below the anti-spam floor is excluded (documented parameter, prevents wallet-spam gaming).
   - Any undistributable remainder (e.g. every sweeper hits the cap) goes to a **public community wallet** with published rules — never to the team, never burned silently.
4. **LP seeding.** The founder seeds a small liquidity pool (~$50: half DUST, half SOL) with amounts and tx signatures published before trading opens.

The distribution math is deterministic and independently verifiable: [`scripts/sweep.py`](scripts/sweep.py) computes the plan, [`scripts/verify_plan.py`](scripts/verify_plan.py) recomputes it via a separate code path, and both must agree to the base unit before any transfer runs.

## Tokenomics

| Parameter | Value |
|---|---|
| Name / ticker | DUST / $DUST |
| Chain | Solana (SPL) |
| Total supply | 1,000,000,000 (fixed — mint authority **revoked** at launch) |
| Decimals | 9 |
| Transfer tax | 0% |
| Freeze authority | **Revoked** (no one can freeze your tokens) |
| Team / insider allocation | **0%** |
| Presale | None |
| Distribution | 100% via Great Sweep pro-rata (+ cap), remainder → public community wallet |
| Post-sweep LP | Founder-seeded ~$50, amounts + txs published |

What this repo does NOT contain: honeypots, hidden taxes, hidden mints, fake renounces, or any mechanism that can take your tokens. If you find one, that's a critical bug — report it.

## Repository structure

```
dust-coin/
├── README.md                 # you are here
├── LICENSE                   # MIT
├── .env.example              # config template (no secrets — ever)
├── docs/
│   ├── HONESTY.md            # risk disclosure, the honesty baseline
│   ├── SWEEP_MECHANICS.md    # exact distribution rules, cap math, edge cases
│   ├── TESTNET.md            # how to reproduce every devnet test
│   └── LP_PLAN.md            # mainnet LP-seeding disclosure template
├── scripts/
│   ├── sweep.py              # pro-rata distributor with per-wallet caps (deterministic)
│   ├── verify_plan.py        # independent recomputation cross-check
│   ├── dust_census.py        # Dust Census leaderboard renderer
│   └── lp_rehearsal.py       # devnet LP-seeding dry run
├── chain/                    # Solana devnet scripts (@solana/web3.js)
│   ├── 01_mint.js            # create DUST mint, 1B supply, revoke mint+freeze
│   ├── 02_sweepers.js        # simulate sweepers: fund wallets, send dust to vault
│   ├── 03_distribute.js      # execute plan.json payouts (idempotent, resumable)
│   ├── 04_census.js          # read contributions, emit census input
│   └── 05_lp.js              # LP-seeding rehearsal on devnet
└── tests/
    ├── TEST_LOG.md           # every test run, pass/fail, with tx evidence
    ├── unit_test.py          # unit tests for the pro-rata + cap math
    └── devnet_e2e.sh         # full devnet E2E orchestrator
```

## Running the devnet tests

```bash
# 1. math unit tests (no chain needed)
python3 tests/unit_test.py

# 2. full devnet E2E (needs free devnet SOL from the faucet)
cp .env.example .env   # fill RPC_URL (devnet), nothing secret needed
bash tests/devnet_e2e.sh
```

Every run appends timestamped results + transaction signatures to `tests/TEST_LOG.md`. Devnet explorer: https://explorer.solana.com/?cluster=devnet

## Security / responsible disclosure

No private keys, seed phrases, or secrets are ever committed to this repo (`.gitignore` covers `devnet/`, `.env`, `wallets/`). Test wallets are devnet-only and worthless. If you find a real vulnerability in the mechanics, open an issue — the math is the product.

## Legal

DUST is a meme coin with no expectation of profit and no utility. Distribution is pro-rata to all sweepers — it is not a lottery, raffle, or game of chance (no random winners; everyone who sweeps receives a deterministic share). This repo is a technical experiment. Nothing here is an offer to sell securities. See [`docs/HONESTY.md`](docs/HONESTY.md).

---

Built by Mehyar Soft LLC. Contact: info@mehyar.us
