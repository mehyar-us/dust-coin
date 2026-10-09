#!/usr/bin/env python3
"""Dust Census — leaderboard renderer.

Reads contributions + plan and renders the Census: biggest dust piles and
'funniest dust' labels. Labels come from a LOCAL JSON file (labels.json) —
never doxxing; a label is only attached if someone voluntarily claims it.

Usage:
    python3 dust_census.py --contributions devnet/contributions.json \
        --plan devnet/plan.json --labels labels.json --out devnet/census.md
"""
from __future__ import annotations

import argparse
import json
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--contributions", required=True)
    ap.add_argument("--plan", required=False, default=None)
    ap.add_argument("--labels", required=False, default=None)
    ap.add_argument("--out", required=False, default=None)
    ap.add_argument("--top", type=int, default=10)
    args = ap.parse_args()

    with open(args.contributions) as f:
        data = json.load(f)
    contribs = data["contributions"]

    shares = {}
    if args.plan:
        with open(args.plan) as f:
            plan = json.load(f)
        shares = {e["wallet"]: e["share_base"] for e in plan["plan"]}

    labels = {}
    if args.labels:
        try:
            with open(args.labels) as f:
                labels = json.load(f).get("labels", {})
        except FileNotFoundError:
            pass

    ranked = sorted(contribs, key=lambda c: -c["lamports"])
    lines = []
    lines.append("# Dust Census")
    lines.append("")
    lines.append(f"Sweepers: {len(ranked)} · "
                 f"Total dust: {sum(c['lamports'] for c in ranked)} lamports")
    lines.append("")
    lines.append("## Biggest dust piles")
    lines.append("")
    lines.append("| Rank | Wallet | Dust (lamports) | DUST share (base units) | Label |")
    lines.append("|---|---|---|---|---|")
    for i, c in enumerate(ranked[: args.top], 1):
        w = c["wallet"]
        short = w[:6] + "…" + w[-4:]
        share = shares.get(w, "—")
        label = labels.get(w, "")
        lines.append(f"| {i} | `{short}` | {c['lamports']} | {share} | {label} |")
    lines.append("")
    funny = [(w, l) for w, l in labels.items() if l]
    if funny:
        lines.append("## Funniest dust (community labels)")
        lines.append("")
        for w, l in sorted(funny):
            lines.append(f"- `{w[:6]}…{w[-4:]}` — {l}")
        lines.append("")

    out = "\n".join(lines)
    if args.out:
        with open(args.out, "w") as f:
            f.write(out + "\n")
        print(f"census written: {args.out} ({len(ranked)} sweepers)")
    else:
        print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
