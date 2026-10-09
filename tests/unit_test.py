#!/usr/bin/env python3
"""Unit tests for the Great Sweep distribution math (no chain needed).

Covers every edge case in docs/SWEEP_MECHANICS.md. Run: python3 tests/unit_test.py
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from sweep import distribute

SUPPLY = 1_000_000_000 * 10**9
CAP = int(SUPPLY * 0.5 / 100)  # 0.5%
FLOOR = 10_000

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {detail}")


def C(wallet, lamports):
    return {"wallet": wallet, "lamports": lamports, "tx": "t"}


W = [f"Wallet{i:03d}Addr11111111111111111111111111111" for i in range(40)]

# 1. basic pro-rata, no caps hit (300 sweepers -> raw shares well under the 0.5% cap)
cs = [C(W[i % 40] + f"_{i}", 100_000 if i % 2 == 0 else 300_000) for i in range(300)]
plan, rem, stats = distribute(cs, SUPPLY, CAP, FLOOR)
s = {e["wallet"]: e["share_base"] for e in plan}
w100 = [e["share_base"] for e in plan if e["dust_lamports"] == 100_000]
w300 = [e["share_base"] for e in plan if e["dust_lamports"] == 300_000]
check("basic pro-rata sums to supply", sum(s.values()) + rem == SUPPLY)
check("basic pro-rata ratio 1:3", abs(w100[0] * 3 - w300[0]) <= 2, f"{w100[0]} {w300[0]}")
check("no caps hit", all(not e["capped"] for e in plan))

# 2. whale capped, excess redistributed
plan, rem, stats = distribute([C(W[0], 10_000_000_000), C(W[1], 100_000)], SUPPLY, CAP, FLOOR)
s = {e["wallet"]: e["share_base"] for e in plan}
check("whale capped at CAP", s[W[0]] == CAP, str(s[W[0]]))
check("minnow got whale excess", s[W[1]] == CAP, str(s[W[1]]))  # excess fills minnow to cap too
check("whale flagged capped", [e for e in plan if e["wallet"] == W[0]][0]["capped"])
check("remainder to community", rem == SUPPLY - 2 * CAP, str(rem))

# 3. single sweeper
plan, rem, stats = distribute([C(W[0], 500_000)], SUPPLY, CAP, FLOOR)
check("single sweeper capped", plan[0]["share_base"] == CAP)
check("single sweeper remainder to community", rem == SUPPLY - CAP)

# 4. sub-floor excluded
plan, rem, stats = distribute([C(W[0], FLOOR - 1), C(W[1], 200_000)], SUPPLY, CAP, FLOOR)
check("sub-floor excluded", len(plan) == 1 and plan[0]["wallet"] == W[1])
check("ineligible counted", stats["ineligible_below_floor"] == 1)

# 5. zero contributors -> void
plan, rem, stats = distribute([], SUPPLY, CAP, FLOOR)
check("void event: empty plan", plan == [])
check("void event: full supply to community", rem == SUPPLY)

# 6. all below floor -> void
plan, rem, _ = distribute([C(W[0], 1), C(W[1], 2)], SUPPLY, CAP, FLOOR)
check("all-below-floor void", plan == [] and rem == SUPPLY)

# 7. identical contributions -> identical shares
cs = [C(W[i], 123_456) for i in range(5)]
plan, rem, stats = distribute(cs, SUPPLY, CAP, FLOOR)
shares = [e["share_base"] for e in plan]
check("identical dust -> shares differ by <=1", max(shares) - min(shares) <= 1, str(shares))
check("conservation", sum(shares) + rem == SUPPLY)

# 8. 25 sweepers, mixed sizes incl. whale — full conservation + cap enforcement
import random
random.seed(42)
cs = [C(W[i], random.randint(FLOOR, 50_000_000)) for i in range(24)]
cs.append(C(W[25], 5_000_000_000))  # whale
plan, rem, stats = distribute(cs, SUPPLY, CAP, FLOOR)
check("25 sweepers: all eligible", len(plan) == 25, str(len(plan)))
check("25 sweepers: conservation", sum(e["share_base"] for e in plan) + rem == SUPPLY)
check("25 sweepers: cap enforced", all(e["share_base"] <= CAP for e in plan))
check("25 sweepers: whale capped", [e for e in plan if e["wallet"] == W[25]][0]["capped"])

# 9. determinism: same input twice -> identical plan
p1, r1, _ = distribute(cs, SUPPLY, CAP, FLOOR)
p2, r2, _ = distribute(cs, SUPPLY, CAP, FLOOR)
check("deterministic", p1 == p2 and r1 == r2)

# 10. dust exactly at floor -> eligible
plan, _, _ = distribute([C(W[0], FLOOR)], SUPPLY, CAP, FLOOR)
check("floor boundary eligible", len(plan) == 1)

# 11. many tiny sweepers, none near cap — pro-rata precision
cs = [C(W[i % 40] + f"_t{i}", FLOOR + i) for i in range(300)]
plan, rem, _ = distribute(cs, SUPPLY, CAP, FLOOR)
check("tiny sweepers conservation", sum(e["share_base"] for e in plan) + rem == SUPPLY)
check("tiny sweepers uncapped", all(not e["capped"] for e in plan))

# 12. just under the cap boundary: 201 equal sweepers -> each raw share = S/201
#     = 4.975e15 < CAP(5e15), so nobody is flagged capped
cs = [C(W[i % 40] + f"_b{i}", 1_000_000) for i in range(201)]
plan, _, _ = distribute(cs, SUPPLY, CAP, FLOOR)
check("just-under-cap not flagged", all(not e["capped"] for e in plan))
check("just-under-cap conservation", sum(e["share_base"] for e in plan) == SUPPLY)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
