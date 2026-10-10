/** Retry + pacing helper for the public devnet RPC.
 *
 * api.devnet.solana.com rate-limits aggressively per IP/method (429 "Too many
 * requests for a specific RPC call"). Every transaction send in the E2E suite
 * goes through withRetry(), which paces calls and retries transient failures
 * with exponential backoff. Non-transient errors throw immediately.
 *
 * Double-execution note: if a 429 hits during confirmation polling (after the
 * tx landed), a retry could re-send. The suite's verification steps
 * (supply check, --verify balance reconciliation, idempotent resume via
 * state.json) catch any such skew instead of silently accepting it.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isTransient(e) {
  const msg = String((e && e.message) || e);
  return /429|too many requests|rate limit|502|503|504|timeout|timed out|econnreset|socket hang up/i.test(msg);
}

async function withRetry(fn, label, tries = 10) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (i > 0) {
      // pace: keep us comfortably under the per-method rate limit
      await sleep(2000);
    }
    try {
      const out = await fn();
      // gentle pacing between successful sends too
      await sleep(1200);
      return out;
    } catch (e) {
      last = e;
      if (isTransient(e) && i < tries - 1) {
        const wait = Math.min(30000, 1500 * 2 ** i);
        console.log(`transient ${label}: ${String(e.message || e).slice(0, 90)} — retry ${i + 1}/${tries} in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
  throw last;
}

module.exports = { withRetry, sleep, isTransient };
