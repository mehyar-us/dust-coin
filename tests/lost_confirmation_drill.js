/** DUST E2E — lost-confirmation drill (mocked RPC).
 *
 * The bug this hunts (found in the 2026-10-09 adversarial audit): if a
 * distribution transfer LANDS on-chain but its confirmation is lost
 * (timeout / blip), sendAndConfirmTransaction throws, state.json is never
 * updated, and a naive re-run pays the wallet TWICE. The fix in
 * chain/03_distribute.js reconciles with on-chain balances before paying.
 *
 * Scenario A (sweeper leg):
 *  1. Real plan via scripts/sweep.py; mock RPC; seed distributor.
 *  2. Run 03_distribute.js --fail-after 2 (clean crash; 2 recorded).
 *  3. Hand-send plan[2]'s transfer directly (lands on-chain, state.json
 *     untouched) — this IS the lost-confirmation end state.
 *  4. Re-run 03_distribute.js -> must reconcile plan[2] (skip, no double-pay)
 *     and complete everyone else.
 *  5. Assert every balance == plan share EXACTLY; distributor leftover exact.
 *
 * Scenario B (community leg):
 *  1. Tiny plan where ALL sweepers cap out (10 sweepers, cap 5%) so a
 *     community remainder exists.
 *  2. Run 03_distribute.js fully -> community.json + on-chain remainder.
 *  3. Delete state.community (simulate lost confirmation) but keep
 *     community.json and the on-chain funds.
 *  4. Re-run -> must REUSE the same community wallet, reconcile on-chain,
 *     and NOT double-pay.
 *  5. Assert community balance == remainder exactly (not 2x) and the wallet
 *     address is unchanged.
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const REPO = path.join(__dirname, "..");
const MOCK_PORT = "18999";
const RPC_URL = `http://127.0.0.1:${MOCK_PORT}`;
const NODE_PATH = process.env.NODE_PATH;

// Polling confirmation patch (same as the chain scripts use): the mock RPC
// has no WebSocket endpoint, and raw web3.js confirmations hang retrying ws.
require(path.join(REPO, "chain", "fund.js"));

function sh(cmd, args, env = {}) {
  return spawnSync(cmd, args, {
    cwd: REPO, encoding: "utf8", timeout: 120000,
    env: { ...process.env, RPC_URL, NODE_PATH, DUST_TX_DELAY_MS: "10", ...env },
  });
}
const post = (p, data, retries = 3) => new Promise((resolve, reject) => {
  const attempt = (n) => {
    const b = data ? JSON.stringify(data) : "";
    const req = http.request({ host: "127.0.0.1", port: MOCK_PORT, path: p, method: data ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "Content-Length": b.length, "Connection": "close" } },
      (res) => { let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => resolve(s)); });
    req.on("error", (e) => {
      // The mock is a bare-bones http server; a fresh connection can race its
      // socket teardown ("socket hang up"). Test-harness-only flake: retry.
      if (n < retries) setTimeout(() => attempt(n + 1), 300);
      else reject(e);
    });
    if (b) req.write(b);
    req.end();
  };
  attempt(1);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, cond, extra = "") {
  console.log((cond ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));
  if (!cond) failures++;
}

async function startMock(tag) {
  const mock = spawn("node", [path.join(REPO, "tests", "mock_rpc.js")],
    { env: { ...process.env, MOCK_RPC_PORT: MOCK_PORT, NODE_PATH }, stdio: ["ignore", "pipe", "pipe"] });
  mock.stderr.on("data", (d) => process.stdout.write("[mock:err] " + d));
  mock.on("exit", (code, sig) => console.log(`[mock:${tag}] EXITED code=${code} sig=${sig}`));
  await sleep(1500);
  return mock;
}
async function stopMock(mock) { mock.kill(); await sleep(500); }

function genContribs(n, lamportsFn) {
  const web3 = require("@solana/web3.js");
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ wallet: web3.Keypair.generate().publicKey.toBase58(), lamports: lamportsFn(i), tx: "9".repeat(87) + i });
  }
  return out;
}
function writePlan(workdir, contribs, capPct) {
  const web3 = require("@solana/web3.js");
  const cpath = path.join(workdir, "contributions.json");
  fs.writeFileSync(cpath, JSON.stringify({ contributions: contribs }));
  const r = sh("python3", ["scripts/sweep.py", "--contributions", cpath,
    "--supply", "1000000000", "--decimals", "6", "--cap-pct", String(capPct),
    "--vault", web3.Keypair.generate().publicKey.toBase58(),
    "--dust-mint", web3.Keypair.generate().publicKey.toBase58(),
    "--community-wallet", web3.Keypair.generate().publicKey.toBase58(),
    "--out", path.join(workdir, "plan.json")],
    { DUST_WORKDIR: workdir });
  if (r.status !== 0) throw new Error("sweep.py failed: " + r.stderr);
  return JSON.parse(fs.readFileSync(path.join(workdir, "plan.json"), "utf8"));
}
async function keypairs(workdir) {
  const web3 = require("@solana/web3.js");
  const mint = web3.Keypair.generate();
  const distributor = web3.Keypair.generate();
  fs.writeFileSync(path.join(workdir, "mint.json"), JSON.stringify({ mint: mint.publicKey.toBase58(), decimals: 6 }));
  fs.writeFileSync(path.join(workdir, "distributor.json"), JSON.stringify(Array.from(distributor.secretKey)));
  return { mint, distributor };
}
async function seedDistributor(workdir, plan, mint, distributor) {
  const spl = require("@solana/spl-token");
  const distAta = (await spl.getAssociatedTokenAddress(mint.publicKey, distributor.publicKey)).toBase58();
  const supplyBase = BigInt(plan.inputs.supply_whole) * 10n ** BigInt(plan.inputs.decimals);
  await post("/__seed", { address: distAta, mint: mint.publicKey.toBase58(), owner: distributor.publicKey.toBase58(), amount: supplyBase.toString() });
  return { distAta, supplyBase };
}
// Hand-apply ONE distribution transfer directly (lands on-chain, no state record)
// — the exact end state of "transfer landed, confirmation lost".
async function handSend(workdir, plan, mint, distributor, entry) {
  const web3 = require("@solana/web3.js");
  const spl = require("@solana/spl-token");
  const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = web3;
  const conn = new Connection(RPC_URL, "confirmed");
  const dist = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(workdir, "distributor.json"), "utf8"))));
  const mintPk = new PublicKey(JSON.parse(fs.readFileSync(path.join(workdir, "mint.json"), "utf8")).mint);
  const distAta = await spl.getOrCreateAssociatedTokenAccount(conn, dist, mintPk, dist.publicKey);
  const destAta = await spl.getOrCreateAssociatedTokenAccount(conn, dist, mintPk, new PublicKey(entry.wallet));
  const ix = spl.createTransferInstruction(distAta.address, destAta.address, dist.publicKey, BigInt(entry.share_base));
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [dist]);
  return sig;
}
async function dump() { return JSON.parse(await post("/__dump", null)); }

async function scenarioA() {
  console.log("\n===== Scenario A: sweeper-leg lost confirmation =====");
  const workdir = path.join(REPO, "devnet-lostconf-a");
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.mkdirSync(workdir, { recursive: true });

  const contribs = genContribs(12, (i) => 50_000 + i * 1000);
  const plan = writePlan(workdir, contribs, 5);
  check("A: plan generated", plan.plan.length === 12, plan.plan.length + " eligible");
  const { mint, distributor } = await keypairs(workdir);
  const mock = await startMock("A");
  const { distAta, supplyBase } = await seedDistributor(workdir, plan, mint, distributor);
  try {
    const runDist = (args) => sh("node", [path.join(REPO, "chain", "03_distribute.js"), ...args], { DUST_WORKDIR: workdir });

    let r = runDist(["--fail-after", "2"]);
    check("A: clean crash exit 42", r.status === 42, "exit=" + r.status);

    // simulate the lost confirmation: plan[2] paid on-chain, state.json untouched
    const victim = plan.plan[2];
    const sig = await handSend(workdir, plan, mint, distributor, victim);
    console.log("A: hand-applied transfer for", victim.wallet.slice(0, 8) + "…", sig.slice(0, 12) + "… (state.json NOT updated)");
    const stateBefore = JSON.parse(fs.readFileSync(path.join(workdir, "state.json"), "utf8"));
    check("A: state.json still has 2 completions", Object.keys(stateBefore.completed).length === 2);

    r = runDist([]);
    check("A: resume exits 0", r.status === 0, "exit=" + r.status + " " + (r.stderr || "").trim().split("\n").pop());
    const logged = (r.stdout || "");
    check("A: run logged an on-chain reconciliation skip", /reconciled on-chain/.test(logged));

    const ledger = await dump();
    let bad = 0;
    for (const e of plan.plan) {
      const spl = require("@solana/spl-token");
      const web3 = require("@solana/web3.js");
      const mintPk = new web3.PublicKey(JSON.parse(fs.readFileSync(path.join(workdir, "mint.json"), "utf8")).mint);
      const a = (await spl.getAssociatedTokenAddress(mintPk, new web3.PublicKey(e.wallet))).toBase58();
      const rec = ledger[a];
      const amt = rec ? rec.amount : undefined;
      if (amt !== String(e.share_base)) { console.log(`  MISMATCH ${e.wallet.slice(0,8)}: on-chain ${amt}, plan ${e.share_base}`); bad++; }
    }
    check("A: every sweeper holds EXACTLY plan share (no double-pay)", bad === 0, bad + " mismatches");
    const distRec = ledger[distAta];
    const expectedLeft = supplyBase - plan.plan.reduce((s, e) => s + BigInt(e.share_base), 0n) - BigInt(plan.community_remainder_base || 0);
    check("A: distributor leftover exact", BigInt(distRec.amount) === expectedLeft);

    r = runDist(["--verify"]);
    check("A: --verify PASS", r.status === 0 && /VERIFY: PASS/.test(r.stdout));
  } finally { await stopMock(mock); }
}

async function scenarioB() {
  console.log("\n===== Scenario B: community-leg lost confirmation =====");
  const workdir = path.join(REPO, "devnet-lostconf-b");
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.mkdirSync(workdir, { recursive: true });

  // 10 equal whales + 5% cap -> everyone capped, remainder -> community
  const contribs = genContribs(10, () => 10_000_000_000);
  const plan = writePlan(workdir, contribs, 5);
  check("B: plan has community remainder", (plan.community_remainder_base || 0) > 0, String(plan.community_remainder_base));
  const { mint, distributor } = await keypairs(workdir);
  const mock = await startMock("B");
  await seedDistributor(workdir, plan, mint, distributor);
  try {
    const runDist = (args) => sh("node", [path.join(REPO, "chain", "03_distribute.js"), ...args], { DUST_WORKDIR: workdir });
    let r = runDist([]);
    check("B: full run exits 0", r.status === 0, "exit=" + r.status);
    const cwBefore = JSON.parse(fs.readFileSync(path.join(workdir, "community.json"), "utf8"));
    const web3 = require("@solana/web3.js");
    const cwAddrBefore = web3.Keypair.fromSecretKey(Uint8Array.from(cwBefore)).publicKey.toBase58();

    // simulate lost confirmation on the community leg: drop state.community,
    // keep community.json + the on-chain funds
    const statePath = path.join(workdir, "state.json");
    const st = JSON.parse(fs.readFileSync(statePath, "utf8"));
    delete st.community;
    fs.writeFileSync(statePath, JSON.stringify(st, null, 2));

    r = runDist([]);
    check("B: re-run exits 0", r.status === 0, "exit=" + r.status);
    const cwAfter = JSON.parse(fs.readFileSync(path.join(workdir, "community.json"), "utf8"));
    const cwAddrAfter = web3.Keypair.fromSecretKey(Uint8Array.from(cwAfter)).publicKey.toBase58();
    check("B: SAME community wallet reused (not regenerated)", cwAddrAfter === cwAddrBefore);
    check("B: run logged on-chain reconciliation", /already on-chain/.test(r.stdout || ""));

    const spl = require("@solana/spl-token");
    const mintPk = new web3.PublicKey(JSON.parse(fs.readFileSync(path.join(workdir, "mint.json"), "utf8")).mint);
    const cwAta = (await spl.getAssociatedTokenAddress(mintPk, new web3.PublicKey(cwAddrAfter))).toBase58();
    const ledger = await dump();
    const amt = BigInt(ledger[cwAta].amount);
    check("B: community holds EXACTLY the remainder (not 2x)", amt === BigInt(plan.community_remainder_base), `on-chain ${amt}, plan ${plan.community_remainder_base}`);
  } finally { await stopMock(mock); }
}

(async () => {
  try {
    await scenarioA();
    await scenarioB();
  } catch (e) { console.log("FATAL:", e.message); failures++; }
  console.log(failures === 0 ? "\nLOST-CONFIRMATION DRILL: ALL PASS" : `\nLOST-CONFIRMATION DRILL: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})();
