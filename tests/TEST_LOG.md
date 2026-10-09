# DUST — Test Log

Every test run appends timestamped results with transaction evidence.
Network: Solana devnet preferred; local test validator fallback documented in
[`docs/TESTNET.md`](docs/TESTNET.md). Explorer: https://explorer.solana.com/?cluster=devnet

**Rule:** no test is marked PASS without on-chain evidence (tx signature or
queried account state). Failed runs are logged too — a red log is data.

---

==================================================================
## DUST devnet E2E run — 2026-10-09T18:15:23Z
RPC: http://localhost:8899

### step 0: unit tests (pro-rata + cap math)
  PASS just-under-cap conservation

26 passed, 0 failed

### step 1: mint (create DUST test mint, revoke mint+freeze, metadata)
bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)
distributor: 4ZbVMpMfHNVNkcdBWgqv1666NB9U9PwYxBPoeQ4iRFX1
airdrop distributor attempt 1 failed: airdrop to 4ZbVMpMfHNVNkcdBWgqv1666NB9U9PwYxBPoeQ4iRFX1 failed: Internal error; retrying in 10s
airdrop distributor attempt 2 failed: airdrop to 4ZbVMpMfHNVNkcdBWgqv1666NB9U9PwYxBPoeQ4iRFX1 failed: Internal error; retrying in 10s
airdrop distributor attempt 3 failed: airdrop to 4ZbVMpMfHNVNkcdBWgqv1666NB9U9PwYxBPoeQ4iRFX1 failed: Internal error; retrying in 10s
airdrop distributor attempt 4 failed: airdrop to 4ZbVMpMfHNVNkcdBWgqv1666NB9U9PwYxBPoeQ4iRFX1 failed: Internal error; retrying in 10s
airdrop distributor attempt 5 failed: airdrop to 4ZbVMpMfHNVNkcdBWgqv1666NB9U9PwYxBPoeQ4iRFX1 failed: Internal error; retrying in 10s
airdrop distributor attempt 6 failed: airdrop to 4ZbVMpMfHNVNkcdBWgqv1666NB9U9PwYxBPoeQ4iRFX1 failed: Internal error; retrying in 10s
airdrop distributor attempt 7 failed: airdrop to 4ZbVMpMfHNVNkcdBWgqv1666NB9U9PwYxBPoeQ4iRFX1 failed: Internal error; retrying in 10s
airdrop distributor attempt 8 failed: airdrop to 4ZbVMpMfHNVNkcdBWgqv1666NB9U9PwYxBPoeQ4iRFX1 failed: Internal error; retrying in 10s
FATAL: airdrop failed for distributor
## RESULT: FAIL — 01_mint.js

==================================================================
## DUST devnet E2E run — 2026-10-09T18:21:35Z
RPC: http://localhost:8899

### step 0: unit tests (pro-rata + cap math)
  PASS just-under-cap conservation

26 passed, 0 failed

### step 1: mint (create DUST test mint, revoke mint+freeze, metadata)
bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)
distributor: 4ZbVMpMfHNVNkcdBWgqv1666NB9U9PwYxBPoeQ4iRFX1
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 
ws error: 

==================================================================
## DUST devnet E2E run — 2026-10-09T18:29:00Z
RPC: http://localhost:18999

### step 0: unit tests (pro-rata + cap math)
  PASS just-under-cap conservation

26 passed, 0 failed

### step 1: mint (create DUST test mint, revoke mint+freeze, metadata)
bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)
distributor: 4ZbVMpMfHNVNkcdBWgqv1666NB9U9PwYxBPoeQ4iRFX1
FATAL: failed to get signature status: Invalid params: invalid type: map, expected a string.
## RESULT: FAIL — 01_mint.js
