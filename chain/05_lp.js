/** DUST devnet E2E — step 5: LP-seeding rehearsal.
 *
 * Rehearses the POST-SWEEP founder LP seed on DEVNET:
 *   1. founder wallet is funded with the disclosed seed amounts
 *      (devnet SOL + test DUST from the distributor)
 *   2. amounts move to a PUBLICLY LABELED vault wallet
 *   3. vault balances are verified on-chain to the base unit
 *   4. a disclosure record is emitted (<workdir>/lp_disclosure.json) in the
 *      exact shape docs/LP_PLAN.md requires before mainnet trading opens
 *
 * Honest scope: this rehearses custody + amounts + disclosure mechanics.
 * The production AMM pool forms on mainnet via the launchpad; no AMM is
 * simulated here and none is claimed.
 *
 * DEVNET ONLY.
 */
const fs = require("fs");
const path = require("path");
require("./fund"); // polling confirmation patch (no WebSocket dependency)
const {
  Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction,
} = require("@solana/web3.js");
const {
  getOrCreateAssociatedTokenAccount, createTransferInstruction, getAccount,
} = require("@solana/spl-token");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const WORKDIR = process.env.DUST_WORKDIR || path.join(__dirname, "..", "devnet");

// Rehearsal amounts (devnet; the ~$50 mainnet figure is in docs/LP_PLAN.md)
const SEED_SOL_LAMPORTS = 500_000_000;          // 0.5 devnet SOL
const SEED_DUST_WHOLE = 50_000;                 // 50k test DUST

async function main() {
  const RPC_OK = RPC.includes("devnet") || RPC.includes("testnet") || RPC.includes("localhost") || RPC.includes("127.0.0.1");
if (RPC.includes("mainnet") || !RPC_OK) throw new Error(`REFUSING: RPC must be devnet/testnet or a localhost test validator, got (${RPC}) — mainnet is never allowed`);
  const conn = new Connection(RPC, "confirmed");
  const loadOrCreate = (p) => {
    if (fs.existsSync(p)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
    const kp = Keypair.generate();
    fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  };

  const mintInfo = JSON.parse(fs.readFileSync(path.join(WORKDIR, "mint.json"), "utf8"));
  const mint = new PublicKey(mintInfo.mint);
  const distributor = loadOrCreate(path.join(WORKDIR, "distributor.json"));
  const founder = loadOrCreate(path.join(WORKDIR, "founder.json"));
  const lpVault = loadOrCreate(path.join(WORKDIR, "lp_vault.json"));
  console.log("founder:", founder.publicKey.toBase58());
  console.log("lp vault (public label: DUST-LP-SEED devnet rehearsal):", lpVault.publicKey.toBase58());

  // fund founder with SOL (via distributor to save faucet hits)
  const need = SEED_SOL_LAMPORTS + 50_000_000;
  if (await conn.getBalance(founder.publicKey) < need) {
    const sig = await sendAndConfirmTransaction(
      conn,
      new Transaction().add(SystemProgram.transfer({
        fromPubkey: distributor.publicKey, toPubkey: founder.publicKey, lamports: need,
      })),
      [distributor]
    );
    console.log("founder funded:", sig.slice(0, 16) + "…");
  }

  // founder receives test DUST from distributor
  const seedDustBase = BigInt(SEED_DUST_WHOLE) * 10n ** BigInt(mintInfo.decimals);
  const distAta = await getOrCreateAssociatedTokenAccount(conn, distributor, mint, distributor.publicKey);
  const founderAta = await getOrCreateAssociatedTokenAccount(conn, founder, mint, founder.publicKey);
  const fundTx = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(createTransferInstruction(distAta.address, founderAta.address, distributor.publicKey, seedDustBase)),
    [distributor]
  );
  console.log("founder DUST funded:", fundTx.slice(0, 16) + "…");

  // move both sides into the public LP vault
  const vaultAta = await getOrCreateAssociatedTokenAccount(conn, founder, mint, lpVault.publicKey);
  const dustTx = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(createTransferInstruction(founderAta.address, vaultAta.address, founder.publicKey, seedDustBase)),
    [founder]
  );
  const solTx = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(SystemProgram.transfer({
      fromPubkey: founder.publicKey, toPubkey: lpVault.publicKey, lamports: SEED_SOL_LAMPORTS,
    })),
    [founder]
  );
  console.log("vault DUST tx:", dustTx.slice(0, 16) + "…");
  console.log("vault SOL tx:", solTx.slice(0, 16) + "…");

  // verify on-chain to the base unit
  const vaultSol = await conn.getBalance(lpVault.publicKey);
  const vaultDustAcct = await getAccount(conn, vaultAta.address);
  const solOk = vaultSol === SEED_SOL_LAMPORTS;
  const dustOk = vaultDustAcct.amount === seedDustBase;
  console.log(`vault SOL: ${vaultSol} (expect ${SEED_SOL_LAMPORTS}) ${solOk ? "OK" : "MISMATCH"}`);
  console.log(`vault DUST: ${vaultDustAcct.amount} (expect ${seedDustBase}) ${dustOk ? "OK" : "MISMATCH"}`);
  if (!solOk || !dustOk) { console.log("LP REHEARSAL: FAIL — vault balances wrong"); process.exit(1); }

  const disclosure = {
    schema: "dust-lp-disclosure/1",
    network: "devnet (REHEARSAL — no mainnet pool exists)",
    vault_address: lpVault.publicKey.toBase58(),
    vault_label: "DUST-LP-SEED (devnet rehearsal)",
    dust_base: seedDustBase.toString(),
    dust_whole: SEED_DUST_WHOLE,
    sol_lamports: SEED_SOL_LAMPORTS,
    dust_source: `distributor wallet ${distributor.publicKey.toBase58()} (devnet test DUST)`,
    fund_tx: fundTx,
    dust_to_vault_tx: dustTx,
    sol_to_vault_tx: solTx,
    vault_verified_onchain: true,
    checklist: {
      dust_amount: true, sol_amount: true, dust_source: true,
      vault_address: true, fund_tx: true, checklist_published: true,
    },
    explorer: `https://explorer.solana.com/address/${lpVault.publicKey.toBase58()}?cluster=devnet`,
  };
  fs.writeFileSync(path.join(WORKDIR, "lp_disclosure.json"), JSON.stringify(disclosure, null, 2));
  console.log("wrote lp_disclosure.json — LP REHEARSAL chain steps PASS");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
