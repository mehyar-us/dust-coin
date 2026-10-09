#!/usr/bin/env python3
"""LP-seeding rehearsal (devnet).

Rehearses the POST-SWEEP founder LP seed on devnet: custody of the disclosed
amounts, the disclosure checklist mechanics, and balance verification.

Honest scope: devnet has no production AMM wired here, so this rehearses
what CAN be rehearsed — custody, exact amounts, public labeling, and the
disclosure checklist from docs/LP_PLAN.md. The actual mainnet pool forms via
the launchpad graduation on mainnet; the checklist is what makes it honest.

The rehearsal:
  1. Founder wallet receives the disclosed seed amounts (devnet SOL + test DUST).
  2. Amounts are moved to a PUBLICLY LABELED vault wallet ("DUST-LP-SEED (devnet rehearsal)").
  3. Balances are verified on-chain to the base unit.
  4. A disclosure record is emitted (amounts, tx sigs, checklist) — the same
     shape that must be published before mainnet trading opens.

The chain moves are executed by chain/05_lp.js; this script verifies the
emitted disclosure record against the plan.
"""
from __future__ import annotations

import argparse
import json
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--disclosure", required=True,
                    help="disclosure JSON emitted by chain/05_lp.js")
    ap.add_argument("--expect-dust-base", type=int, required=True)
    ap.add_argument("--expect-sol-lamports", type=int, required=True)
    args = ap.parse_args()

    with open(args.disclosure) as f:
        d = json.load(f)

    errors = []
    checklist = d.get("checklist", {})
    for item in ("dust_amount", "sol_amount", "dust_source", "vault_address",
                 "fund_tx", "checklist_published"):
        if not d.get(item) and not checklist.get(item):
            errors.append(f"missing disclosure field: {item}")

    if d.get("dust_base") != args.expect_dust_base:
        errors.append(f"dust amount mismatch: got {d.get('dust_base')}, "
                      f"expected {args.expect_dust_base}")
    if d.get("sol_lamports") != args.expect_sol_lamports:
        errors.append(f"SOL amount mismatch: got {d.get('sol_lamports')}, "
                      f"expected {args.expect_sol_lamports}")
    if not d.get("vault_verified_onchain"):
        errors.append("vault balances not verified on-chain")

    if errors:
        print("LP REHEARSAL: FAIL")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("LP REHEARSAL: PASS — custody + amounts + disclosure checklist verified")
    print(f"  vault: {d.get('vault_address')}")
    print(f"  dust:  {d.get('dust_base')} base units")
    print(f"  sol:   {d.get('sol_lamports')} lamports")
    return 0


if __name__ == "__main__":
    sys.exit(main())
