# Great Sweep — Exact Mechanics

**Version:** 1.0 (devnet-tested) · **Status:** TESTNET ONLY

## Parameters

| Parameter | Symbol | Value (devnet test) | Mainnet (planned) |
|---|---|---|---|
| Total supply | `S` | 1,000,000,000 DUST | 1,000,000,000 DUST |
| Decimals | — | 9 | 9 |
| Sweep window | `T` | simulated (see TESTNET.md) | 7 days, published start/end timestamps |
| Per-wallet cap | `C` | 0.5% of supply = 5,000,000 DUST | 0.5% of supply |
| Anti-spam floor | `F` | 0.00001 SOL-equivalent | published before window opens |
| Dust asset | — | devnet SOL | SOL (SPL dust accepted, converted at window-close price) |

All parameters are published **before** the window opens and are immutable during the window.

## Eligibility

A wallet is an eligible sweeper iff during `T` it sent ≥ `F` of dust to the sweep vault address. One wallet = one entry (sybil resistance is best-effort: the per-wallet cap is the economic defense — splitting dust across wallets doesn't increase total share, it just splits it).

## Distribution algorithm

Let `d_i` = total dust contributed by wallet `i` (in lamports), `D = Σ d_i`.

**Step 1 — raw pro-rata (integer math, base units):**
```
raw_i = floor(d_i × S / D)
```
Remainder `R = S − Σ raw_i` is allocated by largest-remainder to the largest fractional parts (deterministic tiebreak: lexicographically smaller wallet address first).

**Step 2 — cap water-filling:**
```
cap = C (in base units)
repeat:
    excess = 0
    for each uncapped wallet i with share_i > cap:
        excess += share_i − cap
        share_i = cap
        mark i capped
    if excess == 0: break
    distribute excess pro-rata over uncapped wallets by d_i weight
        (same floor + largest-remainder treatment per round)
until no wallet exceeds cap or no uncapped wallets remain
```

**Step 3 — remainder sink:** if every eligible wallet is capped and undistributed DUST remains, it goes to the **public community wallet** (published address, published spend rules — bounties/contests only, no team access). It is never burned silently and never assigned to the team.

**Step 4 — plan freeze:** the final per-wallet plan is written to `plan.json` containing: all inputs (`S`, `C`, `F`, window timestamps, vault address), every contribution, every share, the input hash. The plan is published before any transfer executes.

**Step 5 — execution:** transfers run from `plan.json` only. Each completed transfer is recorded in `state.json`; re-running skips completed transfers (idempotent, crash-resumable). `verify_plan.py` must independently reproduce `plan.json` byte-identically (same canonical JSON) before execution is allowed.

## Edge cases (all covered by unit tests)

| Case | Behavior |
|---|---|
| Wallet contributes below `F` | Excluded (logged as ineligible) |
| Wallet contributes 0 / doesn't sweep | Not a sweeper, no entry |
| Single eligible sweeper | Gets `min(pro-rata, cap)`; remainder → community wallet |
| All sweepers over cap | Everyone capped at `C`; remainder → community wallet |
| Two wallets, one whale | Whale capped, excess redistributed to the other (up to cap) |
| Identical contributions | Identical shares (deterministic) |
| `D = 0` (nobody sweeps) | No distribution; supply stays in distributor wallet; event declared void, publicly |
| Contribution arrives after window close | Not counted (vault still accepts SOL, but it's excluded from the plan and returned where feasible) |
| Rounding | Total distributed always equals exactly `S` minus the community-wallet remainder — never more, never less |

## What the algorithm guarantees

1. **Determinism:** same inputs → same plan, every time, on any machine.
2. **Conservation:** distributed + community remainder = exactly `S`.
3. **Cap enforcement:** no wallet exceeds `C`, verified post-distribution on-chain.
4. **No discretion:** the founder cannot alter shares after the window opens. The code is public; the plan is public; the chain is public.

## Anti-gaming notes

- **Whale dust:** the cap is the defense. A $10,000 dust pile and a $0.50 dust pile both cap at 5M DUST.
- **Sybil wallets:** splitting $5 across 100 wallets yields the same total as one $5 wallet (pro-rata is linear; caps only bind upward). Dust below `F` per wallet is excluded, which makes mass-splitting *lose* share.
- **Last-minute sniping:** contributions are summed over the whole window; timing confers no advantage.
- **Fake volume:** the vault only counts what it received. There is no off-chain contribution registry to forge.
