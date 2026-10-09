#!/usr/bin/env python3
"""DUST Great Sweep distributor — pro-rata with per-wallet caps (water-filling).

Deterministic: same inputs -> byte-identical plan.json (canonical JSON).
Integer math in base units throughout; largest-remainder allocation of
fractional leftovers with a deterministic tiebreak (address sort).

Usage:
    python3 sweep.py --contributions devnet/contributions.json \
        --supply 1000000000 --decimals 9 --cap-pct 0.5 --floor-lamports 10000 \
        --window-start 0 --window-end 9999999999 \
        --vault <vault-address> --dust-mint <mint> --dust-mint <mint> \
        --community-wallet <address> --out devnet/plan.json

contributions.json format:
    {"window_start": ..., "window_end": ..., "vault": "...",
     "contributions": [{"wallet": "<base58>", "lamports": 12345, "tx": "<sig>"}, ...]}
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys


def distribute(contributions, supply_base: int, cap_base: int, floor_lamports: int):
    """Return (plan_entries, community_remainder_base, stats).

    plan_entries: list of {"wallet","dust_lamports","share_base","capped":bool}
    sorted by wallet for determinism.
    """
    eligible = sorted(
        (c for c in contributions if c["lamports"] >= floor_lamports),
        key=lambda c: c["wallet"],
    )
    ineligible = [c for c in contributions if c["lamports"] < floor_lamports]

    total_dust = sum(c["lamports"] for c in eligible)
    stats = {
        "eligible_sweepers": len(eligible),
        "ineligible_below_floor": len(ineligible),
        "total_dust_lamports": total_dust,
    }
    if not eligible or total_dust == 0:
        return [], supply_base, stats  # void event: everything to community wallet

    # Step 1: raw pro-rata, floor + largest remainder
    raws = []
    for c in eligible:
        num = c["lamports"] * supply_base
        q, r = divmod(num, total_dust)
        raws.append({"wallet": c["wallet"], "dust": c["lamports"], "q": q, "r": r})
    allocated = sum(r["q"] for r in raws)
    remainder = supply_base - allocated
    # largest remainder; tiebreak by wallet address (already sorted)
    for entry in sorted(raws, key=lambda e: (-e["r"], e["wallet"]))[:remainder]:
        entry["q"] += 1

    shares = {e["wallet"]: e["q"] for e in raws}
    dust_of = {e["wallet"]: e["dust"] for e in raws}
    capped = set()

    # Step 2: cap water-filling
    while True:
        excess = 0
        newly_capped = []
        for w in sorted(shares):
            if w not in capped and shares[w] > cap_base:
                excess += shares[w] - cap_base
                shares[w] = cap_base
                newly_capped.append(w)
        for w in newly_capped:
            capped.add(w)
        if excess == 0:
            break
        uncapped = [w for w in sorted(shares) if w not in capped]
        if not uncapped:
            break
        uncapped_dust = sum(dust_of[w] for w in uncapped)
        # distribute excess pro-rata over uncapped by dust weight
        adds = {}
        alloc = 0
        remainders = []
        for w in uncapped:
            num = dust_of[w] * excess
            q, r = divmod(num, uncapped_dust)
            adds[w] = q
            alloc += q
            remainders.append((r, w))
        leftover = excess - alloc
        remainders.sort(key=lambda t: (-t[0], t[1]))
        for _, w in remainders[:leftover]:
            adds[w] += 1
        for w in uncapped:
            shares[w] += adds[w]

    community_remainder = supply_base - sum(shares.values())
    assert community_remainder >= 0, "over-distribution bug"
    assert all(s <= cap_base for s in shares.values()), "cap violated"

    plan = [
        {
            "wallet": w,
            "dust_lamports": dust_of[w],
            "share_base": shares[w],
            "capped": w in capped,
        }
        for w in sorted(shares)
    ]
    stats["capped_wallets"] = len(capped)
    stats["community_remainder_base"] = community_remainder
    stats["distributed_base"] = sum(shares.values())
    return plan, community_remainder, stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--contributions", required=True)
    ap.add_argument("--supply", type=int, default=1_000_000_000, help="whole DUST tokens")
    ap.add_argument("--decimals", type=int, default=9)
    ap.add_argument("--cap-pct", type=float, default=0.5)
    ap.add_argument("--floor-lamports", type=int, default=10_000)
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dust-mint", required=True)
    ap.add_argument("--community-wallet", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    with open(args.contributions) as f:
        data = json.load(f)

    supply_base = args.supply * (10 ** args.decimals)
    cap_base = int(supply_base * args.cap_pct / 100)

    plan, community_remainder, stats = distribute(
        data["contributions"], supply_base, cap_base, args.floor_lamports
    )

    inputs = {
        "supply_whole": args.supply,
        "decimals": args.decimals,
        "cap_pct": args.cap_pct,
        "cap_base": cap_base,
        "floor_lamports": args.floor_lamports,
        "window_start": data.get("window_start"),
        "window_end": data.get("window_end"),
        "vault": args.vault,
        "dust_mint": args.dust_mint,
        "community_wallet": args.community_wallet,
    }
    inputs_hash = hashlib.sha256(
        json.dumps(inputs, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()

    doc = {
        "schema": "dust-plan/1",
        "inputs": inputs,
        "inputs_hash": inputs_hash,
        "stats": stats,
        "plan": plan,
        "community_remainder_base": community_remainder,
    }
    canonical = json.dumps(doc, sort_keys=True, separators=(",", ":"))
    with open(args.out, "w") as f:
        f.write(canonical + "\n")
    print(f"plan: {len(plan)} sweepers, distributed={stats['distributed_base']}, "
          f"community_remainder={community_remainder}, capped={stats.get('capped_wallets', 0)}")
    print(f"inputs_hash: {inputs_hash}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
