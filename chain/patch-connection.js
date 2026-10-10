/** Devnet RPC armor for the DUST E2E suite (TEST ONLY).
 *
 * api.devnet.solana.com rate-limits per IP/method (429 "Too many requests for
 * a specific RPC call"). Every transaction this suite sends — direct
 * sendAndConfirmTransaction calls AND @solana/spl-token internals (createMint,
 * mintTo, setAuthority, getOrCreateAssociatedTokenAccount) — funnels through
 * Connection.prototype.sendTransaction, so patching it once here covers all
 * scripts. Require this module at the top of every chain script.
 *
 * The patch adds gentle pacing (1.2s after each send) and retries transient
 * failures (429/5xx/timeouts) with exponential backoff (up to 10 tries).
 * Non-transient errors throw immediately — no silent swallowing.
 */
const { Connection } = require("@solana/web3.js");
const { withRetry } = require("./retry");

if (!Connection.prototype.__dustPatched) {
  const origSend = Connection.prototype.sendTransaction;
  Connection.prototype.sendTransaction = async function (...args) {
    return withRetry(() => origSend.apply(this, args), "sendTransaction");
  };
  Connection.prototype.__dustPatched = true;
}
