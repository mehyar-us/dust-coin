/** Shared funding helper for DUST chain scripts.
 *
 * Prefers a local faucet keypair (DUST_FAUCET_KEYPAIR env -> path to the test
 * validator's faucet-keypair.json) and falls back to the RPC requestAirdrop
 * faucet. Returns the funding signature.
 *
 * Also patches Connection.prototype.confirmTransaction with a POLLING
 * implementation: the default web3.js confirmation uses a WebSocket
 * subscription, which is unavailable on some validators / restricted
 * runtimes (and flaky on devnet). Polling getSignatureStatus over HTTP is
 * slower but works everywhere.
 */
const fs = require("fs");
const {
  Connection, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction,
} = require("@solana/web3.js");

if (!Connection.prototype.__dustPollingPatched) {
  Connection.prototype.__dustPollingPatched = true;
  const ORDER = { processed: 0, confirmed: 1, finalized: 2 };
  Connection.prototype.confirmTransaction = async function (strategy, commitment) {
    // web3.js >=1.90 may pass a strategy object {signature, blockhash, ...}
    // instead of a bare signature string — handle both.
    const signature = typeof strategy === "string" ? strategy : strategy.signature;
    if (typeof signature !== "string" || !signature) {
      throw new Error(`confirmTransaction: unrecognized strategy ${JSON.stringify(strategy)}`);
    }
    const target = typeof commitment === "string" ? commitment
      : (commitment && commitment.commitment) || "confirmed";
    const need = ORDER[target] !== undefined ? ORDER[target] : 1;
    const start = Date.now();
    for (;;) {
      const st = await this.getSignatureStatus(signature);
      const v = st && st.value;
      if (v && v.confirmationStatus && (ORDER[v.confirmationStatus] ?? 0) >= need) {
        if (v.err) throw new Error(`tx ${signature} failed on-chain: ${JSON.stringify(v.err)}`);
        return { context: st.context, value: v };
      }
      if (Date.now() - start > 90000) throw new Error(`confirmTransaction timeout: ${signature}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  };
}

async function airdropWithRetry(conn, pubkey, lamports, label) {
  for (let i = 0; i < 8; i++) {
    try {
      const sig = await conn.requestAirdrop(pubkey, lamports);
      await conn.confirmTransaction(sig, "confirmed");
      console.log(`airdrop ${label}: ${sig.slice(0, 16)}…`);
      return sig;
    } catch (e) {
      console.log(`airdrop ${label} attempt ${i + 1} failed: ${e.message.split("\n")[0]}; retrying in 10s`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  throw new Error(`airdrop failed for ${label}`);
}

async function fund(conn, pubkey, lamports, label) {
  const fkPath = process.env.DUST_FAUCET_KEYPAIR;
  if (fkPath && fs.existsSync(fkPath)) {
    const fk = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(fkPath, "utf8"))));
    const sig = await sendAndConfirmTransaction(
      conn,
      new Transaction().add(SystemProgram.transfer({ fromPubkey: fk.publicKey, toPubkey: pubkey, lamports })),
      [fk]
    );
    console.log(`funded ${label} from local faucet keypair: ${sig.slice(0, 16)}…`);
    return sig;
  }
  return airdropWithRetry(conn, pubkey, lamports, label);
}

module.exports = { fund, airdropWithRetry };
