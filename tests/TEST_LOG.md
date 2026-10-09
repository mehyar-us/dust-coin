# DUST — Test Log

Every test run appends timestamped results with transaction evidence.
Network: Solana devnet preferred; local test validator fallback documented in
[`docs/TESTNET.md`](docs/TESTNET.md). Explorer: https://explorer.solana.com/?cluster=devnet

**Rule:** no test is marked PASS without on-chain evidence (tx signature or
queried account state). Failed runs are logged too — a red log is data.

---
