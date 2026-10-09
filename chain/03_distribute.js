/** DUST devnet E2E — step 3: execute the distribution plan.
 *
 * Reads <workdir>/plan.json (must already exist and be verify_plan.py-clean)
 * and transfers each sweeper's DUST share. IDEMPOTENT: completed transfers are
 * recorded in <workdir>/state.json and skipped on re-run — kill this script
 * mid-run and re-run it; no wallet is ever paid twice.
 *
 * Flags:
 *   --fail-after N   simulate a crash after N transfers (failure drill)
 *   --verify         don't send; verify every ATA balance matches the plan exactly
 *
 * DEVNET ONLY. Exits non-zero if not pointed at devnet.
 */
const fs = require("fs");
const path = require("path");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const {
  getOrCreateAssociatedTokenAccount, createTransferInstruction, getAccount,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const WORKDIR = process.env.DUST_WORKDIR || path.join(__dirname, "..", "devnet");

const args = process.argv.slice(2);
const failAfter = (() => {
  const i = args.indexOf("--fail-after");
  return i >= 0 ? parseInt(args[i + 1], 10) : -1;
})();
const verifyOnly = args.includes("--verify");

function loadJson(p, fallback) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;
}

async function main() {
  const RPC_OK = RPC.includes("devnet") || RPC.includes("localhost") || RPC.includes("127.0.0.1");
if (RPC.includes("mainnet") || !RPC_OK) throw new Error(`REFUSING: RPC must be devnet or a localhost test validator, got (${RPC}) — mainnet is never allowed`);
  const conn = new Connection(RPC, "confirmed");

  const mintInfo = loadJson(path.join(WORKDIR, "mint.json"));
  if (!mintInfo.mint) throw new Error("mint.json missing — run 01_mint.js first");
  const mint = new PublicKey(mintInfo.mint);
  const distributor = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.join(WORKDIR, "distributor.json"), "utf8")))
  );
  const plan = loadJson(path.join(WORKDIR, "plan.json"));
  if (!plan.plan) throw new Error("plan.json missing — run scripts/sweep.py first");

  const statePath = path.join(WORKDIR, "state.json");
  const state = loadJson(statePath, { completed: {}, community: null });
  const saveState = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  // distributor's DUST account
  const distAta = await getOrCreateAssociatedTokenAccount(conn, distributor, mint, distributor.publicKey);

  let done = 0;
  for (const entry of plan.plan) {
    const w = entry.wallet;
    if (state.completed[w]) { done++; continue; }
    const dest = new PublicKey(w);
    const ata = await getOrCreateAssociatedTokenAccount(conn, distributor, mint, dest);
    if (!verifyOnly) {
      const ix = createTransferInstruction(distAta.address, ata.address, distributor.publicKey, BigInt(entry.share_base));
      const { Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(conn, tx, [distributor]);
      state.completed[w] = sig;
      saveState();
      done++;
      console.log(`paid ${w.slice(0, 8)}… ${entry.share_base} (capped=${entry.capped}) ${sig.slice(0, 12)}…`);
      if (failAfter >= 0 && done >= failAfter) {
        console.log(`SIMULATED CRASH after ${done} transfers (failure drill)`);
        process.exit(42);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // community remainder
  if (plan.community_remainder_base > 0 && !state.community) {
    const cw = Keypair.generate();
    fs.writeFileSync(path.join(WORKDIR, "community.json"), JSON.stringify(Array.from(cw.secretKey)));
    const ata = await getOrCreateAssociatedTokenAccount(conn, distributor, mint, cw.publicKey);
    if (!verifyOnly) {
      const { Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
      const ix = createTransferInstruction(distAta.address, ata.address, distributor.publicKey, BigInt(plan.community_remainder_base));
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [distributor]);
      state.community = { wallet: cw.publicKey.toBase58(), tx: sig, amount: plan.community_remainder_base };
      saveState();
      console.log(`community remainder ${plan.community_remainder_base} -> ${cw.publicKey.toBase58().slice(0, 8)}… ${sig.slice(0, 12)}…`);
    }
  }

  if (verifyOnly) {
    // verify every balance matches the plan EXACTLY
    let bad = 0;
    for (const entry of plan.plan) {
      const ata = await getOrCreateAssociatedTokenAccount(conn, distributor, mint, new PublicKey(entry.wallet));
      const acct = await getAccount(conn, ata.address);
      if (acct.amount !== BigInt(entry.share_base)) {
        console.log(`MISMATCH ${entry.wallet}: on-chain ${acct.amount}, plan ${entry.share_base}`);
        bad++;
      }
    }
    if (plan.community_remainder_base > 0 && state.community) {
      const ata = await getOrCreateAssociatedTokenAccount(conn, distributor, mint, new PublicKey(state.community.wallet));
      const acct = await getAccount(conn, ata.address);
      if (acct.amount !== BigInt(plan.community_remainder_base)) {
        console.log(`MISMATCH community: on-chain ${acct.amount}, plan ${plan.community_remainder_base}`);
        bad++;
      }
    }
    // no double-pays: total out of distributor == distributed + remainder
    const distAcct = await getAccount(conn, distAta.address);
    const expectedLeft = BigInt(plan.inputs.supply_whole) * 10n ** BigInt(plan.inputs.decimals)
      - BigInt(plan.stats.distributed_base) - BigInt(plan.community_remainder_base);
    if (distAcct.amount !== expectedLeft) {
      console.log(`MISMATCH distributor leftover: on-chain ${distAcct.amount}, expected ${expectedLeft}`);
      bad++;
    }
    if (bad > 0) { console.log(`VERIFY: FAIL (${bad} mismatches)`); process.exit(1); }
    console.log(`VERIFY: PASS — all ${plan.plan.length} balances match plan exactly, no double-pays`);
    return;
  }

  console.log(`distribution complete: ${done}/${plan.plan.length} sweepers paid`);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
