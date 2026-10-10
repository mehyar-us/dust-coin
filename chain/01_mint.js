/** DUST devnet E2E — step 1: mint.
 *
 * Creates the DUST test mint on Solana DEVNET, mints the full 1B supply to the
 * distributor wallet, sets on-chain metadata, then REVOKES both mint and
 * freeze authorities. Emits <workdir>/mint.json.
 *
 * DEVNET ONLY. Exits non-zero if not pointed at devnet.
 */
const fs = require("fs");
const path = require("path");
const {
  Connection, Keypair, PublicKey, LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const {
  createMint, mintTo, setAuthority, getMint, AuthorityType, TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const WORKDIR = process.env.DUST_WORKDIR || path.join(__dirname, "..", "devnet");
const SKIP_METADATA = process.env.DUST_SKIP_METADATA === "1";
const SUPPLY_WHOLE = 1_000_000_000n;
const DECIMALS = 9;

function loadOrCreateKeypair(p) {
  if (fs.existsSync(p)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

const { fund } = require("./fund");
require("./patch-connection");

async function airdropWithRetry(conn, pubkey, lamports, label) {
  return fund(conn, pubkey, lamports, label);
}

async function main() {
  const RPC_OK = RPC.includes("devnet") || RPC.includes("testnet") || RPC.includes("localhost") || RPC.includes("127.0.0.1");
if (RPC.includes("mainnet") || !RPC_OK) throw new Error(`REFUSING: RPC must be devnet/testnet or a localhost test validator, got (${RPC}) — mainnet is never allowed`);
  fs.mkdirSync(WORKDIR, { recursive: true });
  const conn = new Connection(RPC, "confirmed");

  const distributor = loadOrCreateKeypair(path.join(WORKDIR, "distributor.json"));
  console.log("distributor:", distributor.publicKey.toBase58());

  let bal = await conn.getBalance(distributor.publicKey);
  if (bal < 1.5 * LAMPORTS_PER_SOL) {
    await airdropWithRetry(conn, distributor.publicKey, 2 * LAMPORTS_PER_SOL, "distributor");
  }

  // 1. create mint (distributor is mint + freeze authority for now)
  const mint = await createMint(conn, distributor, distributor.publicKey, distributor.publicKey, DECIMALS);
  console.log("mint:", mint.toBase58());

  // 2. mint full supply to the distributor's associated token account
  // (mintTo requires a TOKEN account as destination, not a wallet address)
  const { getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");
  const distAta = await getOrCreateAssociatedTokenAccount(conn, distributor, mint, distributor.publicKey);
  console.log("distributor ATA:", distAta.address.toBase58());
  const supplyBase = SUPPLY_WHOLE * 10n ** BigInt(DECIMALS);
  const mintSig = await mintTo(conn, distributor, mint, distAta.address, distributor, supplyBase);
  console.log("mintTo sig:", mintSig);

  // 3. on-chain metadata (devnet; clearly labeled as a test token).
  // Skipped when DUST_SKIP_METADATA=1 (e.g. local test validator without the
  // Metaplex program). Non-fatal either way.
  let metadataSig = null;
  if (!SKIP_METADATA) {
  try {
    const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
    const { keypairIdentity } = require("@metaplex-foundation/umi");
    const {
      fromWeb3JsKeypair, fromWeb3JsPublicKey,
    } = require("@metaplex-foundation/umi-web3js-adapters");
    const { createMetadataAccountV3 } = require("@metaplex-foundation/mpl-token-metadata");
    const umi = createUmi(RPC);
    const umiKp = fromWeb3JsKeypair(distributor);
    umi.use(keypairIdentity(umiKp));
    const res = await createMetadataAccountV3(umi, {
      mint: fromWeb3JsPublicKey(mint),
      mintAuthority: umiKp,
      data: {
        name: "DUST (devnet test)",
        symbol: "DUSTt",
        uri: "https://github.com/mehyar-us/dust-coin",
        sellerFeeBasisPoints: 0,
        creators: null,
        collection: null,
        uses: null,
      },
      isMutable: true,
      collectionDetails: null,
    }).sendAndConfirm(umi);
    metadataSig = Buffer.from(res.signature).toString("hex");
    console.log("metadata sig (hex):", metadataSig);
  } catch (e) {
    console.log("metadata step skipped/failed (non-fatal):", e.message.split("\n")[0]);
  }
  } else {
    console.log("metadata step skipped (DUST_SKIP_METADATA=1)");
  }

  // 4. REVOKE mint authority
  const revokeMintSig = await setAuthority(conn, distributor, mint, distributor, AuthorityType.MintTokens, null);
  console.log("revoke mint authority sig:", revokeMintSig);

  // 5. REVOKE freeze authority
  const revokeFreezeSig = await setAuthority(conn, distributor, mint, distributor, AuthorityType.FreezeAccount, null);
  console.log("revoke freeze authority sig:", revokeFreezeSig);

  // 6. verify on-chain
  const info = await getMint(conn, mint);
  const mintRevoked = info.mintAuthority === null;
  const freezeRevoked = info.freezeAuthority === null;
  console.log("mintAuthority:", info.mintAuthority ? info.mintAuthority.toBase58() : "null (REVOKED)");
  console.log("freezeAuthority:", info.freezeAuthority ? info.freezeAuthority.toBase58() : "null (REVOKED)");
  console.log("supply:", info.supply.toString(), "| decimals:", info.decimals);
  if (!mintRevoked || !freezeRevoked) throw new Error("authority revocation FAILED");
  if (info.supply !== supplyBase) throw new Error("supply mismatch");

  const out = {
    mint: mint.toBase58(),
    distributor: distributor.publicKey.toBase58(),
    decimals: DECIMALS,
    supply_base: supplyBase.toString(),
    txs: { mintTo: mintSig, metadata: metadataSig, revokeMint: revokeMintSig, revokeFreeze: revokeFreezeSig },
    authorities_revoked: { mint: mintRevoked, freeze: freezeRevoked },
    explorer: `https://explorer.solana.com/address/${mint.toBase58()}?cluster=devnet`,
  };
  fs.writeFileSync(path.join(WORKDIR, "mint.json"), JSON.stringify(out, null, 2));
  console.log("wrote mint.json");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
