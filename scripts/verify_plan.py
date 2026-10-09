#!/usr/bin/env python3
"""Independent cross-check of plan.json.

Deliberately written as a separate code path from sweep.py (different
structure, Fraction-based reasoning, set-based cap loop) so that a bug in
one implementation is unlikely to exist in the other. Exits non-zero unless
the recomputed plan matches plan.json EXACTLY (canonical JSON comparison).

Usage:
    python3 verify_plan.py --plan devnet/plan.json --contributions devnet/contributions.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from fractions import Fraction


def recompute(contributions, supply_base: int, cap_base: int, floor_lamports: int):
    eligible = sorted(
        (c for c in contributions if c["lamports"] >= floor_lamports),
        key=lambda c: c["wallet"],
    )
    ineligible = [c for c in contributions if c["lamports"] < floor_lamports]
    total = sum(c["lamports"] for c in eligible)
    stats = {
        "eligible_sweepers": len(eligible),
        "ineligible_below_floor": len(ineligible),
        "total_dust_lamports": total,
    }
    if not eligible or total == 0:
        return [], supply_base, stats

    # raw pro-rata via exact fractions
    fracs = {c["wallet"]: Fraction(c["lamports"], total) * supply_base for c in eligible}
    shares = {w: int(f) for w, f in fracs.items()}
    # largest remainder with deterministic tiebreak
    shortfall = supply_base - sum(shares.values())
    order = sorted(fracs, key=lambda w: (fracs[w] - shares[w], w), reverse=True)
    # careful: sort by (fractional part desc, wallet asc)
    order = sorted(fracs.keys(), key=lambda w: (-(fracs[w] - shares[w]), w))
    for w in order[:shortfall]:
        shares[w] += 1

    dust_of = {c["wallet"]: c["lamports"] for c in eligible}
    capped = set()
    # water-fill: cap violators, redistribute excess among the rest
    while True:
        violators = sorted(w for w in shares if w not in capped and shares[w] > cap_base)
        if not violators:
            break
        excess = sum(shares[w] - cap_base for w in violators)
        for w in violators:
            shares[w] = cap_base
            capped.add(w)
        rest = sorted(w for w in shares if w not in capped)
        if not rest:
            break
        rest_dust = sum(dust_of[w] for w in rest)
        efracs = {w: Fraction(dust_of[w], rest_dust) * excess for w in rest}
        adds = {w: int(f) for w, f in efracs.items()}
        left = excess - sum(adds.values())
        for w in sorted(efracs, key=lambda w: (-(efracs[w] - adds[w]), w))[:left]:
            adds[w] += 1
        for w in rest:
            shares[w] += adds[w]

    remainder = supply_base - sum(shares.values())
    assert remainder >= 0
    assert all(v <= cap_base for v in shares.values())
    plan = [
        {"wallet": w, "dust_lamports": dust_of[w], "share_base": shares[w],
         "capped": w in capped}
        for w in sorted(shares)
    ]
    stats["capped_wallets"] = len(capped)
    stats["community_remainder_base"] = remainder
    stats["distributed_base"] = sum(shares.values())
    return plan, remainder, stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--contributions", required=True)
    args = ap.parse_args()

    with open(args.plan) as f:
        claimed = json.load(f)
    with open(args.contributions) as f:
        data = json.load(f)

    inp = claimed["inputs"]
    supply_base = inp["supply_whole"] * (10 ** inp["decimals"])
    plan, remainder, stats = recompute(
        data["contributions"], supply_base, inp["cap_base"], inp["floor_lamports"]
    )

    expected_inputs_hash = hashlib.sha256(
        json.dumps(inp, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    if expected_inputs_hash != claimed["inputs_hash"]:
        print(f"FAIL: inputs hash mismatch (claimed file may be tampered)")
        return 1

    rebuilt = {
        "schema": "dust-plan/1",
        "inputs": inp,
        "inputs_hash": claimed["inputs_hash"],
        "stats": stats,
        "plan": plan,
        "community_remainder_base": remainder,
    }
    if json.dumps(rebuilt, sort_keys=True, separators=(",", ":")) != \
       json.dumps(claimed, sort_keys=True, separators=(",", ":")):
        print("FAIL: recomputed plan does not match plan.json")
        # diff summary
        cp = {e["wallet"]: e["share_base"] for e in claimed["plan"]}
        rp = {e["wallet"]: e["share_base"] for e in plan}
        for w in sorted(set(cp) | set(rp)):
            if cp.get(w) != rp.get(w):
                print(f"  {w}: claimed={cp.get(w)} recomputed={rp.get(w)}")
        return 1

    print(f"OK: plan.json independently verified — {len(plan)} sweepers, "
          f"distributed={stats['distributed_base']}, remainder={remainder}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
