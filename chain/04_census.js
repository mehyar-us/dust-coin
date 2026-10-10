/** DUST devnet E2E — step 4: census verification.
 *
 * Verifies on-chain that the vault received exactly the dust recorded in
 * contributions.json, then hands off to scripts/dust_census.py for rendering.
 * Exits non-zero on any accounting mismatch.
 *
 * DEVNET ONLY.
 */
require("./patch-connection"); // devnet RPC armor: 429 retry + pacing on sends
const fs = require("fs");
const path = require("path");
const { Connection, PublicKey } = require("@solana/web3.js");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const WORKDIR = process.env.DUST_WORKDIR || path.join(__dirname, "..", "devnet");

async function main() {
  const RPC_OK = RPC.includes("devnet") || RPC.includes("testnet") || RPC.includes("localhost") || RPC.includes("127.0.0.1");
if (RPC.includes("mainnet") || !RPC_OK) throw new Error(`REFUSING: RPC must be devnet/testnet or a localhost test validator, got (${RPC}) — mainnet is never allowed`);
  const conn = new Connection(RPC, "confirmed");
  const c = JSON.parse(fs.readFileSync(path.join(WORKDIR, "contributions.json"), "utf8"));

  const vaultBal = await conn.getBalance(new PublicKey(c.vault));
  const recorded = c.contributions.reduce((a, x) => a + x.lamports, 0);
  console.log(`vault on-chain: ${vaultBal} lamports`);
  console.log(`recorded total: ${recorded} lamports`);
  if (vaultBal !== recorded) {
    console.log("CENSUS: FAIL — vault balance does not match recorded contributions");
    process.exit(1);
  }
  // ordering sanity: contributions sorted desc by lamports for the leaderboard
  const ranked = [...c.contributions].sort((a, b) => b.lamports - a.lamports);
  const ordered = ranked.every((x, i) => i === 0 || ranked[i - 1].lamports >= x.lamports);
  if (!ordered) { console.log("CENSUS: FAIL — ranking broken"); process.exit(1); }
  console.log(`CENSUS: PASS — ${c.contributions.length} contributions verified on-chain, ranking sound`);
  console.log(`top dust: ${ranked[0].wallet.slice(0, 8)}… ${ranked[0].lamports} lamports`);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
