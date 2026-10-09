#!/usr/bin/env bash
# DUST full devnet E2E. Every step appends timestamped results + tx evidence
# to tests/TEST_LOG.md. Exits non-zero on the first failure.
#
#   RPC_URL=https://api.devnet.solana.com bash tests/devnet_e2e.sh
#
# DEVNET ONLY — every chain script refuses non-devnet RPCs.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
export DUST_WORKDIR="${DUST_WORKDIR:-$REPO/devnet}"
export NODE_PATH="${NODE_PATH:-$HOME/workspace/crypto-venture/dust/devnet/node_modules}"
export RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"
# Local test validator: fund from its faucet keypair (requestAirdrop is flaky there)
if [[ "$RPC_URL" == *"localhost"* || "$RPC_URL" == *"127.0.0.1"* ]]; then
  export DUST_FAUCET_KEYPAIR="${DUST_FAUCET_KEYPAIR:-$HOME/workspace/crypto-venture/dust/validator-ledger/test-ledger/faucet-keypair.json}"
fi
LOG="$REPO/tests/TEST_LOG.md"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$DUST_WORKDIR"

log() { echo "$1" | tee -a "$LOG"; }
fail() { log "## RESULT: FAIL — $1"; exit 1; }

log ""
log "=================================================================="
log "## DUST devnet E2E run — $TS"
log "RPC: $RPC_URL"
log ""

log "### step 0: unit tests (pro-rata + cap math)"
python3 tests/unit_test.py 2>&1 | tail -3 | tee -a "$LOG"
log ""

log "### step 1: mint (create DUST test mint, revoke mint+freeze, metadata)"
node chain/01_mint.js 2>&1 | tee -a "$LOG" || fail "01_mint.js"
MINT="$(python3 -c "import json;print(json.load(open('$DUST_WORKDIR/mint.json'))['mint'])")"
log "mint: $MINT"
log ""

log "### step 2: sweepers (25 wallets sweep dust to vault)"
node chain/02_sweepers.js 2>&1 | tee -a "$LOG" || fail "02_sweepers.js"
log ""

log "### step 3: plan (sweep.py computes plan.json)"
python3 scripts/sweep.py \
  --contributions "$DUST_WORKDIR/contributions.json" \
  --supply 1000000000 --decimals 9 --cap-pct 0.5 --floor-lamports 10000 \
  --vault "$(python3 -c "import json;print(json.load(open('$DUST_WORKDIR/contributions.json'))['vault'])")" \
  --dust-mint SOL-devnet \
  --community-wallet TBD-at-distribution \
  --out "$DUST_WORKDIR/plan.json" 2>&1 | tee -a "$LOG" || fail "sweep.py"
log ""

log "### step 4: independent verification (verify_plan.py must agree byte-identically)"
python3 scripts/verify_plan.py --plan "$DUST_WORKDIR/plan.json" \
  --contributions "$DUST_WORKDIR/contributions.json" 2>&1 | tee -a "$LOG" || fail "verify_plan.py"
log ""

log "### step 5: FAILURE DRILL — SIGKILL-equivalent crash mid-distribution, then resume"
log "first pass with --fail-after 7 (expected exit 42 = simulated crash):"
set +e
node chain/03_distribute.js --fail-after 7 2>&1 | tee -a "$LOG"
CRASH_RC=$?
set -e
[ "$CRASH_RC" -eq 42 ] || fail "failure drill did not crash as scripted (rc=$CRASH_RC)"
log "resuming distribution (must skip the 7 already paid — no double-pays):"
node chain/03_distribute.js 2>&1 | tee -a "$LOG" || fail "03_distribute.js resume"
log ""

log "### step 6: balance verification (every ATA must match plan exactly)"
node chain/03_distribute.js --verify 2>&1 | tee -a "$LOG" || fail "balance verification"
log ""

log "### step 7: dust census"
node chain/04_census.js 2>&1 | tee -a "$LOG" || fail "04_census.js"
python3 scripts/dust_census.py --contributions "$DUST_WORKDIR/contributions.json" \
  --plan "$DUST_WORKDIR/plan.json" --out "$DUST_WORKDIR/census.md" 2>&1 | tee -a "$LOG"
log ""

log "### step 8: LP-seeding rehearsal"
node chain/05_lp.js 2>&1 | tee -a "$LOG" || fail "05_lp.js"
python3 scripts/lp_rehearsal.py --disclosure "$DUST_WORKDIR/lp_disclosure.json" \
  --expect-dust-base 50000000000000 --expect-sol-lamports 500000000 2>&1 | tee -a "$LOG" \
  || fail "lp_rehearsal.py"
log ""

log "## RESULT: PASS — full devnet E2E green ($TS)"
log "explorer: https://explorer.solana.com/address/$MINT?cluster=devnet"
log "=================================================================="
