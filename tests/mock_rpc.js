/** DUST E2E — mock Solana JSON-RPC server for the failure drill.
 *
 * WHY THIS EXISTS: the sandbox cannot reach any Solana test cluster
 * (devnet SNI-blocked + CF-IP-blocked; testnet faucet dead; local validator
 * cannot ingest transactions without UDP). See tests/TEST_LOG.md for the full
 * diagnosis. This mock lets us validate the DISTRIBUTOR'S OWN LOGIC —
 * idempotent resume after a mid-run crash — which is pure script behavior
 * independent of the chain. It does NOT prove on-chain execution.
 *
 * Implements just enough JSON-RPC to satisfy @solana/web3.js +
 * @solana/spl-token for 03_distribute.js:
 *   getLatestBlockhash, getAccountInfo, sendTransaction,
 *   getSignatureStatuses, getMinimumBalanceForRentExemption
 *
 * Token accounting is faithful: ATA creation and SPL transfers update an
 * in-memory ledger; getAccountInfo returns correctly-encoded token account
 * data so getAccount() works. Failure injection via FAIL_TX_INDEX env var
 * (1-based index of the sendTransaction call that should return an error).
 *
 * Usage:
 *   RPC_URL=http://localhost:18999 FAIL_TX_INDEX=3 node tests/mock_rpc.js &
 *   RPC_URL=http://localhost:18999 DUST_WORKDIR=... node chain/03_distribute.js --fail-after 5
 */
const http = require("http");
const {
  PublicKey, Transaction,
} = require("@solana/web3.js");

const PORT = parseInt(process.env.MOCK_RPC_PORT || "18999", 10);
const FAIL_TX_INDEX = parseInt(process.env.FAIL_TX_INDEX || "0", 10); // 0 = never fail

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

// ---- in-memory ledger ----
const accounts = new Map(); // base58 -> { owner: base58, lamports: number, tokenData?: {mint, owner, amount: bigint} }
let txCounter = 0;
let sigCounter = 0;
const sigStatus = new Map();

function fakeSig() {
  sigCounter++;
  // deterministic 64-byte-ish base58-ish signature
  return "5".repeat(20) + String(sigCounter).padStart(10, "0") + "9".repeat(58);
}

// Encode a token Account struct (165 bytes) for getAccountInfo
function encodeTokenAccount(mint, owner, amount) {
  const buf = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(buf, 0);
  new PublicKey(owner).toBuffer().copy(buf, 32);
  buf.writeBigUInt64LE(BigInt(amount), 64);
  buf.writeUInt32LE(0, 72); // delegate_option = none
  // delegate (32) zeroed
  buf.writeUInt8(1, 108); // state = initialized
  buf.writeUInt32LE(0, 109); // is_native_option = none
  // is_native (8) zeroed
  buf.writeBigUInt64LE(0n, 121); // delegated_amount
  buf.writeUInt32LE(0, 129); // close_authority_option = none
  return buf;
}

function rpcAccountInfo(addr) {
  const a = accounts.get(addr);
  if (!a) return null;
  let data;
  if (a.tokenData) {
    data = [encodeTokenAccount(a.tokenData.mint, a.tokenData.owner, a.tokenData.amount).toString("base64"), "base64"];
  } else {
    data = ["", "base64"];
  }
  return {
    lamports: a.lamports, owner: a.owner, executable: false,
    rentEpoch: 999999, data, space: data[0] ? Buffer.from(data[0], "base64").length : 0,
  };
}

// Decode and apply a transaction. Returns { ok: true } or { ok: false, err }.
function applyTransaction(tx) {
  txCounter++;
  if (FAIL_TX_INDEX > 0 && txCounter === FAIL_TX_INDEX) {
    return { ok: false, err: "INJECTED FAILURE (mock)" };
  }
  for (const ix of tx.instructions) {
    const prog = ix.programId.toBase58();
    if (prog === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
      // accounts: [payer, ata, owner, mint, system, token, rent]
      const ata = ix.keys[1].pubkey.toBase58();
      const owner = ix.keys[2].pubkey.toBase58();
      const mint = ix.keys[3].pubkey.toBase58();
      if (!accounts.has(ata)) {
        accounts.set(ata, {
          owner: TOKEN_PROGRAM_ID.toBase58(), lamports: 2039280,
          tokenData: { mint, owner, amount: 0n },
        });
      }
    } else if (prog === TOKEN_PROGRAM_ID.toBase58()) {
      const data = ix.data;
      if (data[0] === 3) { // Transfer
        const amount = data.readBigUInt64LE(1);
        const src = ix.keys[0].pubkey.toBase58();
        const dst = ix.keys[1].pubkey.toBase58();
        const s = accounts.get(src), d = accounts.get(dst);
        if (!s || !s.tokenData) return { ok: false, err: "source token account missing" };
        if (!d || !d.tokenData) return { ok: false, err: "dest token account missing" };
        if (s.tokenData.amount < amount) return { ok: false, err: "insufficient funds" };
        s.tokenData.amount -= amount;
        d.tokenData.amount += amount;
      } else if (data[0] === 7) { // MintTo
        const amount = data.readBigUInt64LE(1);
        const dst = ix.keys[1].pubkey.toBase58();
        const d = accounts.get(dst);
        if (!d || !d.tokenData) return { ok: false, err: "mint dest missing" };
        d.tokenData.amount += amount;
      } else if (data[0] === 0) { // InitializeMint — no-op for mock
      }
    } else if (prog === SYSTEM_PROGRAM_ID.toBase58()) {
      // createAccount (u32 tag 0): accounts [payer, newAccount]
      if (ix.data.readUInt32LE(0) === 0) {
        const fresh = ix.keys[1].pubkey.toBase58();
        if (!accounts.has(fresh)) {
          accounts.set(fresh, { owner: SYSTEM_PROGRAM_ID.toBase58(), lamports: ix.data.readBigUInt64LE(4).toString() * 1 });
        }
      }
    }
  }
  return { ok: true };
}

// Seed helper: create a token account with a balance (used by the test harness
// to set up the distributor's ATA with the full supply).
function seedTokenAccount(address, mint, owner, amount) {
  accounts.set(address, {
    owner: TOKEN_PROGRAM_ID.toBase58(), lamports: 2039280,
    tokenData: { mint, owner, amount: BigInt(amount) },
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(404); res.end(); return; }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let rpc;
    try { rpc = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
    const { method, params, id } = rpc;
    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    let out;
    try {
      switch (method) {
        case "getHealth": out = ok("ok"); break;
        case "getSlot": out = ok(1000 + txCounter); break;
        case "getLatestBlockhash":
          out = ok({ context: { slot: 1000 }, value: { blockhash: "4".repeat(43) + "x", lastValidBlockHeight: 99999 } });
          break;
        case "getMinimumBalanceForRentExemption": out = ok(2039280); break;
        case "getAccountInfo": {
          const info = rpcAccountInfo(params[0]);
          out = ok({ context: { slot: 1000 }, value: info });
          break;
        }
        case "sendTransaction": {
          const tx = Transaction.from(Buffer.from(params[0], "base64"));
          const r = applyTransaction(tx);
          if (!r.ok) { out = err(-32002, "Transaction simulation failed: " + r.err); break; }
          const sig = fakeSig();
          sigStatus.set(sig, { slot: 1000, confirmations: null, err: null, confirmationStatus: "confirmed" });
          out = ok(sig);
          break;
        }
        case "getSignatureStatuses": {
          const value = params[0].map((s) => sigStatus.get(s) || null);
          out = ok({ context: { slot: 1000 }, value });
          break;
        }
        case "getTokenAccountBalance": {
          const a = accounts.get(params[0]);
          const amt = a && a.tokenData ? a.tokenData.amount : 0n;
          out = ok({ context: { slot: 1000 }, value: { amount: amt.toString(), decimals: 6, uiAmount: Number(amt) / 1e6 } });
          break;
        }
        default: out = err(-32601, "Method not found: " + method);
      }
    } catch (e) { out = err(-32603, "Internal error: " + e.message); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
  });
});

// Control endpoint: POST /__seed {address, mint, owner, amount}
const origHandler = server.listeners("request")[0];
server.removeAllListeners("request");
server.on("request", (req, res) => {
  if (req.url === "/__seed" && req.method === "POST") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const s = JSON.parse(b);
      seedTokenAccount(s.address, s.mint, s.owner, s.amount);
      res.writeHead(200); res.end("seeded");
    });
    return;
  }
  if (req.url === "/__dump" && req.method === "GET") {
    const dump = {};
    for (const [k, v] of accounts) dump[k] = v.tokenData ? { mint: v.tokenData.mint, owner: v.tokenData.owner, amount: v.tokenData.amount.toString() } : { lamports: v.lamports };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(dump));
    return;
  }
  origHandler(req, res);
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock RPC on 127.0.0.1:${PORT} (FAIL_TX_INDEX=${FAIL_TX_INDEX})`));
