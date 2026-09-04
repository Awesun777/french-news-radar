const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Railway sets RAILWAY_VOLUME_MOUNT_PATH automatically when a volume is attached.
const DATA_DIR =
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.env.DATA_DIR ||
  path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "ledger.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

let state = { version: 1, expenses: [], batches: [] };
try {
  const loaded = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (loaded && Array.isArray(loaded.expenses) && Array.isArray(loaded.batches)) {
    state = loaded;
  }
} catch {}

function save() {
  state.version++;
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE);
}

// Amounts are integer cents throughout; the client enforces the same.
function cleanExpense(body) {
  if (!body || typeof body !== "object") return null;
  const amount = body.amount;
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000000) return null;
  const parts = Array.isArray(body.parts)
    ? body.parts.filter((p) => typeof p === "string" && p.length <= 40).slice(0, 20)
    : [];
  if (!parts.length || typeof body.payer !== "string") return null;
  const exp = {
    desc: typeof body.desc === "string" ? body.desc.slice(0, 120) : "",
    amount,
    payer: body.payer.slice(0, 40),
    parts,
    mode: body.mode === "custom" ? "custom" : "equal",
  };
  if (exp.mode === "custom") {
    const shares = {};
    let sum = 0;
    for (const id of parts) {
      const v = body.shares && body.shares[id];
      if (!Number.isInteger(v) || v < 0) return null;
      shares[id] = v;
      sum += v;
    }
    if (sum !== amount) return null;
    exp.shares = shares;
  }
  return exp;
}

const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (req, res) => {
  if (Number(req.query.v) === state.version) return res.status(304).end();
  res.json(state);
});

app.post("/api/expenses", (req, res) => {
  const exp = cleanExpense(req.body);
  if (!exp) return res.status(400).json({ error: "invalid expense" });
  exp.id = crypto.randomUUID();
  exp.at = new Date().toISOString();
  exp.settled = false;
  state.expenses.push(exp);
  save();
  res.json({ ok: true, id: exp.id });
});

app.put("/api/expenses/:id", (req, res) => {
  const cur = state.expenses.find((e) => e.id === req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  if (cur.settled) return res.status(409).json({ error: "already settled" });
  const exp = cleanExpense(req.body);
  if (!exp) return res.status(400).json({ error: "invalid expense" });
  Object.assign(cur, exp); // keeps id, at, settled
  if (cur.mode !== "custom") delete cur.shares;
  save();
  res.json({ ok: true });
});

app.delete("/api/expenses/:id", (req, res) => {
  const i = state.expenses.findIndex((e) => e.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "not found" });
  if (state.expenses[i].settled) return res.status(409).json({ error: "already settled" });
  state.expenses.splice(i, 1);
  save();
  res.json({ ok: true });
});

app.post("/api/settle", (req, res) => {
  const active = state.expenses.filter((e) => !e.settled);
  if (!active.length) return res.status(400).json({ error: "nothing to settle" });
  const transfers = Array.isArray(req.body && req.body.transfers)
    ? req.body.transfers
        .filter(
          (t) =>
            t &&
            typeof t.from === "string" &&
            typeof t.to === "string" &&
            Number.isInteger(t.amount) &&
            t.amount > 0
        )
        .slice(0, 20)
        .map((t) => ({ from: t.from.slice(0, 40), to: t.to.slice(0, 40), amount: t.amount }))
    : [];
  const batch = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    transfers,
    count: active.length,
    total: active.reduce((s, e) => s + e.amount, 0),
  };
  for (const e of active) {
    e.settled = true;
    e.batch = batch.id;
  }
  state.batches.push(batch);
  save();
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("split-ledger listening on " + port + ", data at " + FILE);
});
