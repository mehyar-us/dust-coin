/** DUST E2E — failure drill harness (mocked RPC).
 *
 * 1. Generates a REAL distribution plan via scripts/sweep.py (real math).
 * 2. Starts tests/mock_rpc.js (in-memory Solana JSON-RPC).
 * 3. Seeds the distributor's ATA with the full supply.
 * 4. Runs chain/03_distribute.js --fail-after 5  -> simulated crash (exit 42).
 * 5. Asserts state.json recorded exactly 5 completions.
 * 6. Re-runs chain/03_distribute.js (no flags) -> resumes, completes.
 * 7. Asserts: every sweeper paid EXACTLY their plan share, no double-pays,
 *    distributor leftover == supply - distributed - remainder.
 * 8. Runs chain/03_distribute.js --verify -> expects VERIFY: PASS.
 *
 * All assertions are real checks against the mock ledger. What this proves:
 * the distributor's idempotent-resume logic. What it does NOT prove:
 * on-chain execution (blocked; see tests/TEST_LOG.md).
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const REPO = path.join(__dirname, "..");
const WORKDIR = process.env.DUST_WORKDIR || path.join(REPO, "devnet");
const MOCK_PORT = "18999";
const RPC_URL = `http://127.0.0.1:${MOCK_PORT}`;
const NODE_PATH = process.env.NODE_PATH;

function sh(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd: REPO, encoding: "utf8", timeout: 120000,
    env: { ...process.env, RPC_URL, DUST_WORKDIR: WORKDIR, NODE_PATH, DUST_TX_DELAY_MS: "10", ...env },
  });
  return r;
}
const post = (p, data) => new Promise((resolve, reject) => {
  const b = data ? JSON.stringify(data) : "";
  const req = http.request({ host: "127.0.0.1", port: MOCK_PORT, path: p, method: data ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "Content-Length": b.length } },
    (res) => { let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => resolve(s)); });
  req.on("error", reject); req.write(b); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, cond, extra = "") {
  console.log((cond ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));
  if (!cond) failures++;
}

async function main() {
  fs.rmSync(WORKDIR, { recursive: true, force: true });
  fs.mkdirSync(WORKDIR, { recursive: true });

  // 1. real plan via sweep.py (25 sweepers incl. whale-over-cap, tinies, zero)
  console.log("== generating contributions + plan with scripts/sweep.py");
  const web3a = require("@solana/web3.js");
  // deterministic PRNG (mulberry32)
  let _s = 7;
  const rnd = () => { _s |= 0; _s = (_s + 0x6d2b79f5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const contribs = [];
  for (let i = 0; i < 25; i++) {
    const w = web3a.Keypair.generate().publicKey.toBase58();
    let lamports;
    if (i === 0) lamports = 50_000_000_000;          // whale: way over the 5% cap
    else if (i <= 3) lamports = Math.floor(rnd() * 5000); // tinies (below floor -> ineligible)
    else if (i === 4) lamports = 0;                   // zero dust
    else lamports = 20_000 + Math.floor(rnd() * 5_000_000); // normal dust
    contribs.push({ wallet: w, lamports, tx: "9".repeat(87) + String(i).padStart(1, "0") });
  }
  const cpath = path.join(WORKDIR, "contributions.json");
  fs.writeFileSync(cpath, JSON.stringify({ contributions: contribs }));
  const N_PLAN = contribs.filter((c) => c.lamports >= 10000).length;
  let r = sh("python3", ["scripts/sweep.py", "--contributions", cpath,
    "--supply", "1000000000", "--decimals", "6", "--cap-pct", "5",
    "--vault", web3a.Keypair.generate().publicKey.toBase58(),
    "--dust-mint", web3a.Keypair.generate().publicKey.toBase58(),
    "--community-wallet", web3a.Keypair.generate().publicKey.toBase58(),
    "--out", path.join(WORKDIR, "plan.json")]);
  if (r.status !== 0) { console.log(r.stdout, r.stderr); throw new Error("sweep.py failed"); }
  const plan = JSON.parse(fs.readFileSync(path.join(WORKDIR, "plan.json"), "utf8"));
  check("plan generated", plan.plan.length === N_PLAN, `${plan.plan.length} eligible entries`);

  // independent cross-check
  r = sh("python3", ["scripts/verify_plan.py", "--plan", path.join(WORKDIR, "plan.json"),
    "--contributions", cpath]);
  check("verify_plan.py cross-check", r.status === 0 && /independently verified/.test(r.stdout), (r.stdout || "").trim().split("\n").pop());

  // 2. mint + distributor keypairs (local keygen — no chain needed)
  const web3 = require("@solana/web3.js");
  const mint = web3.Keypair.generate();
  const distributor = web3.Keypair.generate();
  fs.writeFileSync(path.join(WORKDIR, "mint.json"), JSON.stringify({ mint: mint.publicKey.toBase58(), decimals: 6 }));
  fs.writeFileSync(path.join(WORKDIR, "distributor.json"), JSON.stringify(Array.from(distributor.secretKey)));
  const planInputs = plan.inputs;

  // 3. start mock RPC
  console.log("== starting mock RPC");
  const mock = spawn("node", [path.join(REPO, "tests", "mock_rpc.js")],
    { env: { ...process.env, MOCK_RPC_PORT: MOCK_PORT, NODE_PATH }, stdio: ["ignore", "pipe", "pipe"] });
  mock.stdout.on("data", (d) => process.stdout.write("[mock] " + d));
  mock.stderr.on("data", (d) => process.stdout.write("[mock:err] " + d));
  await sleep(1500);

  // compute distributor ATA and seed it with the full supply
  const spl = require("@solana/spl-token");
  const mintPk = mint.publicKey;
  const distAta = (await spl.getAssociatedTokenAddress(mintPk, distributor.publicKey)).toBase58();
  const supplyBase = BigInt(planInputs.supply_whole) * 10n ** BigInt(planInputs.decimals);
  await post("/__seed", { address: distAta, mint: mintPk.toBase58(), owner: distributor.publicKey.toBase58(), amount: supplyBase.toString() });
  console.log("seeded distributor ATA", distAta.slice(0, 8) + "… with", supplyBase.toString());

  const runDist = (args) => sh("node", [path.join(REPO, "chain", "03_distribute.js"), ...args]);

  // 4. crash drill: fail after 5
  console.log("== run 1: --fail-after 5 (simulated crash)");
  r = runDist(["--fail-after", "5"]);
  console.log((r.stdout || "").trim().split("\n").slice(-3).join("\n"));
  check("simulated crash exit code 42", r.status === 42, "exit=" + r.status);
  const state1 = JSON.parse(fs.readFileSync(path.join(WORKDIR, "state.json"), "utf8"));
  check("exactly 5 completions recorded", Object.keys(state1.completed).length === 5,
    Object.keys(state1.completed).length + " recorded");

  // 5. resume
  console.log("== run 2: resume (no flags)");
  r = runDist([]);
  check("resume run exits 0", r.status === 0, "exit=" + r.status + " " + ((r.stderr || "").trim().split("\n").pop() || ""));
  const state2 = JSON.parse(fs.readFileSync(path.join(WORKDIR, "state.json"), "utf8"));
  check("all sweepers recorded complete", Object.keys(state2.completed).length === plan.plan.length,
    Object.keys(state2.completed).length + " recorded");

  // 6. ledger audit via /__dump
  const dump = JSON.parse(await post("/__dump"));
  let bad = 0;
  for (const e of plan.plan) {
    const ata = (await spl.getAssociatedTokenAddress(mintPk, new web3.PublicKey(e.wallet))).toBase58();
    const acct = dump[ata];
    if (!acct || acct.amount !== String(e.share_base)) { bad++; console.log("  MISMATCH", e.wallet.slice(0, 8), "ledger", acct && acct.amount, "plan", e.share_base); }
  }
  check("every sweeper balance == plan share exactly", bad === 0, bad + " mismatches");
  // no double-pays: sum of payouts == distributed
  let paidSum = 0n;
  for (const e of plan.plan) {
    const ata = (await spl.getAssociatedTokenAddress(mintPk, new web3.PublicKey(e.wallet))).toBase58();
    paidSum += BigInt(dump[ata].amount);
  }
  check("sum(payouts) == plan distributed", paidSum === BigInt(plan.stats.distributed_base),
    paidSum.toString() + " vs " + plan.stats.distributed_base);
  // distributor leftover
  const distLeft = BigInt(dump[distAta].amount);
  const expectedLeft = supplyBase - BigInt(plan.stats.distributed_base) - BigInt(plan.community_remainder_base);
  check("distributor leftover exact", distLeft === expectedLeft, distLeft.toString());
  // whale capped?
  const whale = plan.plan.find((e) => e.capped);
  check("whale entry was capped", !!whale, whale ? whale.wallet.slice(0, 8) + " share=" + whale.share_base : "none capped?!");
  if (whale) {
    const wata = (await spl.getAssociatedTokenAddress(mintPk, new web3.PublicKey(whale.wallet))).toBase58();
    check("whale on-ledger == capped share", dump[wata].amount === String(whale.share_base));
  }

  // 7. --verify mode
  console.log("== run 3: --verify");
  r = runDist(["--verify"]);
  check("--verify PASS", r.status === 0 && /VERIFY: PASS/.test(r.stdout),
    (r.stdout || "").trim().split("\n").pop());

  // 8. rerun full distribute again: must be a no-op (idempotent)
  console.log("== run 4: rerun (must be no-op)");
  const dumpBefore = await post("/__dump");
  r = runDist([]);
  const dumpAfter = await post("/__dump");
  check("rerun exits 0", r.status === 0);
  check("rerun changes no balances (idempotent)", dumpBefore === dumpAfter);

  mock.kill();
  console.log(failures === 0 ? "\nALL FAILURE-DRILL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS FATAL:", e); process.exit(1); });
