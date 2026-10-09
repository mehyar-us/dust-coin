# Devnet Test Guide

Everything in this repo is tested on **Solana devnet** (free, worthless tokens). Nothing here touches mainnet.

## Prerequisites

- Python 3.10+
- Node.js 18+
- A devnet RPC endpoint (default: `https://api.devnet.solana.com`; free, no key needed)
- Free devnet SOL from a faucet (e.g. `https://faucet.solana.com`) — test wallets only

## Quick start

```bash
cp .env.example .env        # set RPC_URL (devnet). No secrets needed.
python3 tests/unit_test.py  # 1. pure-math unit tests (no chain)
bash tests/devnet_e2e.sh    # 2. full devnet end-to-end
```

## What devnet_e2e.sh does (in order)

| Step | Script | What it proves |
|---|---|---|
| 0 | `tests/unit_test.py` | pro-rata + cap + water-filling math on 12 edge cases, no chain |
| 1 | `chain/01_mint.js` | creates DUST mint on devnet, mints 1B to distributor, **revokes mint + freeze authorities**, sets metadata. Emits `devnet/mint.json` (mint address, tx sigs) |
| 2 | `chain/02_sweepers.js` | creates 25 test wallets, airdrops devnet SOL, simulates the sweep: wallets send dust (incl. one whale, tiny dusts, sub-floor dust, one non-sweeper) to the vault. Emits `devnet/contributions.json` |
| 3 | `scripts/sweep.py` | computes `devnet/plan.json` from contributions (deterministic, canonical JSON) |
| 4 | `scripts/verify_plan.py` | independent recomputation — must match `plan.json` byte-identically or the run aborts |
| 5 | `chain/03_distribute.js` | executes payouts from the plan, recording each in `devnet/state.json` (**idempotent**: kill it mid-run and re-run — no double-pays) |
| 6 | failure drill | `03_distribute.js` is SIGKILLed mid-run, re-run, and final balances are verified correct with no duplicates |
| 7 | `chain/04_census.js` + `scripts/dust_census.py` | Dust Census leaderboard from contributions; ordering verified against expected |
| 8 | `scripts/lp_rehearsal.py` + `chain/05_lp.js` | LP-seeding rehearsal: founder vault funded with disclosed amounts, custody + checklist verified |

Results (pass/fail + tx signatures + explorer links) append to `tests/TEST_LOG.md`.

## Reproducing a run

Every artifact needed to reproduce is committed or emitted deterministically:
- `devnet/mint.json`, `devnet/contributions.json`, `devnet/plan.json`, `devnet/state.json` are **gitignored** (they contain devnet test-wallet keys — worthless, but never committed as policy).
- `tests/TEST_LOG.md` records the mint address, every tx signature, and the exact commands, so anyone can re-verify on https://explorer.solana.com/?cluster=devnet.

## RPC / faucet notes

Devnet SOL is free and rate-limited. If the public faucet is dry, the script waits and retries with backoff, or use `solana airdrop` via the CLI. The E2E needs ~3 devnet SOL total (rent for 25 wallets + mint + transfers).

**Local-validator fallback (documented, honest):** if `https://api.devnet.solana.com` is unreachable from your environment (observed 2026-10-09: the runtime's egress DNS sinkholes it to `198.18.49.63`; all keyless public devnet RPCs tried — ankr, blockpi, soo — were dead or key-gated), run the E2E against a local test validator instead:

```bash
solana-test-validator --reset   # JSON RPC on http://localhost:8899, built-in faucet
RPC_URL=http://localhost:8899 bash tests/devnet_e2e.sh
```

The local validator runs the **identical Solana programs** (System, SPL Token, Token Metadata) — every mechanic under test (mint, revocations, transfers, balance verification) behaves the same. The test log records which RPC was used. Mainnet URLs are refused by every chain script.

## What devnet does NOT prove

- Mainnet AMM behavior (the devnet rehearsal covers custody/amounts/disclosure mechanics; the real pool forms via the launchpad on mainnet).
- Economic outcomes. Devnet proves the *mechanics*; the market decides the rest (see [HONESTY.md](HONESTY.md)).
