/** DUST devnet E2E — step 2: simulate sweepers.
 *
 * Creates 25 devnet test wallets and simulates the Great Sweep:
 *   - 1 whale (1.5 SOL dust — will hit the per-wallet cap)
 *   - 22 normal sweepers (0.0001 – 0.03 SOL dust)
 *   - 1 sub-floor dust (1000 lamports < 10000 floor — excluded)
 *   - 1 wallet that sends nothing (non-sweeper)
 * Each sweeper sends its dust to the vault. Emits <workdir>/contributions.json.
 *
 * DEVNET ONLY. Exits non-zero if not pointed at devnet.
 */
const fs = require("fs");
const path = require("path");
const {
  Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction,
} = require("@solana/web3.js");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const WORKDIR = process.env.DUST_WORKDIR || path.join(__dirname, "..", "devnet");
const N_SWEEPERS = parseInt(process.env.DUST_N_SWEEPERS || "25", 10); // incl. whale+subfloor+nonsweeper
const TX_DELAY_MS = parseInt(process.env.DUST_TX_DELAY_MS || "400", 10);

function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const { fund } = require("./fund");

async function airdropWithRetry(conn, pubkey, lamports, label) {
  return fund(conn, pubkey, lamports, label);
}

async function main() {
  const RPC_OK = RPC.includes("devnet") || RPC.includes("testnet") || RPC.includes("localhost") || RPC.includes("127.0.0.1");
if (RPC.includes("mainnet") || !RPC_OK) throw new Error(`REFUSING: RPC must be devnet/testnet or a localhost test validator, got (${RPC}) — mainnet is never allowed`);
  fs.mkdirSync(WORKDIR, { recursive: true });
  const conn = new Connection(RPC, "confirmed");
  const rand = seededRand(1337);

  const loadOrCreate = (p) => {
    if (fs.existsSync(p)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
    const kp = Keypair.generate();
    fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  };

  const distributor = loadOrCreate(path.join(WORKDIR, "distributor.json"));
  const vault = loadOrCreate(path.join(WORKDIR, "vault.json"));
  console.log("vault:", vault.publicKey.toBase58());

  // Dust schedule (lamports). Deterministic via seeded RNG.
  const nNormals = Math.max(1, N_SWEEPERS - 3);
  const schedule = [];
  schedule.push({ name: "whale", lamports: Math.floor(1.5 * LAMPORTS_PER_SOL) });
  for (let i = 0; i < nNormals; i++) {
    const lamports = Math.floor((0.0001 + rand() * 0.0299) * LAMPORTS_PER_SOL);
    schedule.push({ name: `sweeper_${i}`, lamports });
  }
  schedule.push({ name: "subfloor", lamports: 1000 }); // below 10k floor -> excluded
  // +1 wallet that sends nothing (non-sweeper)

  const wallets = schedule.map((s, i) => ({ ...s, kp: loadOrCreate(path.join(WORKDIR, `sweeper_${i}.json`)) }));
  const nonSweeper = loadOrCreate(path.join(WORKDIR, "sweeper_nonsweeper.json"));

  // Fund: airdrop once to distributor, then distribute SOL to sweepers (fewer faucet hits)
  const perWalletNeed = 0.05 * LAMPORTS_PER_SOL; // dust + fees headroom
  const totalNeed = Math.floor(perWalletNeed * (wallets.length + 1) + 2.0 * LAMPORTS_PER_SOL);
  let dbal = await conn.getBalance(distributor.publicKey);
  while (dbal < totalNeed) {
    await airdropWithRetry(conn, distributor.publicKey, 2 * LAMPORTS_PER_SOL, "distributor-topup");
    dbal = await conn.getBalance(distributor.publicKey);
  }
  console.log("distributor funded:", dbal / LAMPORTS_PER_SOL, "SOL");

  for (const w of [...wallets, { name: "nonsweeper", kp: nonSweeper }]) {
    const b = await conn.getBalance(w.kp.publicKey);
    if (b < perWalletNeed) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: distributor.publicKey,
          toPubkey: w.kp.publicKey,
          lamports: Math.floor(perWalletNeed - b),
        })
      );
      await sendAndConfirmTransaction(conn, tx, [distributor]);
    }
  }
  console.log(`${wallets.length + 1} wallets funded`);

  // Sweep: each sweeper sends its dust to the vault
  const windowStart = Math.floor(Date.now() / 1000);
  const contributions = [];
  for (const w of wallets) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: w.kp.publicKey,
        toPubkey: vault.publicKey,
        lamports: w.lamports,
      })
    );
    const sig = await sendAndConfirmTransaction(conn, tx, [w.kp]);
    contributions.push({ wallet: w.kp.publicKey.toBase58(), lamports: w.lamports, tx: sig });
    console.log(`sweep ${w.name}: ${w.lamports} lamports -> ${sig.slice(0, 12)}…`);
    await new Promise((r) => setTimeout(r, TX_DELAY_MS));
  }
  const windowEnd = Math.floor(Date.now() / 1000);

  const vaultBal = await conn.getBalance(vault.publicKey);
  const expected = contributions.reduce((a, c) => a + c.lamports, 0);
  console.log(`vault balance: ${vaultBal} (expected ${expected})`);
  if (vaultBal !== expected) throw new Error("vault balance mismatch — sweep accounting broken");

  const out = {
    window_start: windowStart,
    window_end: windowEnd,
    vault: vault.publicKey.toBase58(),
    dust_mint: "SOL (devnet)",
    contributions,
    vault_balance_lamports: vaultBal,
  };
  fs.writeFileSync(path.join(WORKDIR, "contributions.json"), JSON.stringify(out, null, 2));
  console.log(`wrote contributions.json (${contributions.length} contributions)`);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
