// Spins up a tiny local HTTP server that behaves like the Apps Script web
// app (sync.cjs picks http/https by URL scheme; Apps Script itself is
// always https - this test only uses http to avoid needing a TLS cert),
// then runs a real push+pull cycle through sync.cjs against it.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Store } = require("../electron/db.cjs");
const { runSync } = require("../electron/sync.cjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "magasin-sync-"));

const SECRET = "test-key";
let sheetRows = []; // mimics the Sheet's Events rows (after the header)

const server = http.createServer(
  (req, res) => {
    const url = new URL(req.url, "https://localhost");
    if (req.method === "GET") {
      const key = url.searchParams.get("key");
      const after = parseInt(url.searchParams.get("after") || "2", 10);
      if (key !== SECRET) { res.end(JSON.stringify({ ok: false, error: "bad_key" })); return; }
      const idx = after - 2;
      const rows = sheetRows.slice(Math.max(idx, 0));
      res.end(JSON.stringify({ ok: true, rows, lastRow: sheetRows.length + 1 }));
    } else {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        if (parsed.key !== SECRET) { res.end(JSON.stringify({ ok: false, error: "bad_key" })); return; }
        sheetRows.push(...parsed.events);
        res.end(JSON.stringify({ ok: true, appended: parsed.events.length, lastRow: sheetRows.length + 1 }));
      });
    }
  }
);

server.listen(0, async () => {
  const port = server.address().port;
  const url = `http://localhost:${port}/exec`;

  const storeA = new Store(fs.mkdtempSync(path.join(tmp, "pcA-")));
  const storeB = new Store(fs.mkdtempSync(path.join(tmp, "pcB-")));
  storeA.saveSettings({ webAppUrl: url, syncKey: SECRET, pcName: "Caisse" });
  storeB.saveSettings({ webAppUrl: url, syncKey: SECRET, pcName: "Stock" });

  // PC A creates a product and syncs (push).
  const p = storeA.upsertProduct({ name: "Savon Test", barcode: "999", price: 200, stock: 20 });
  const r1 = await runSync(storeA);
  console.assert(r1.ok && r1.pushed >= 1, "PC A push failed: " + JSON.stringify(r1));

  // PC B syncs (pull) and should now see the product.
  const r2 = await runSync(storeB);
  console.assert(r2.ok && r2.pulled >= 1, "PC B pull failed: " + JSON.stringify(r2));
  console.assert(storeB.products[p.code] && storeB.products[p.code].name === "Savon Test", "PC B did not receive product");

  // PC B sells 3, syncs (push); PC A syncs (pull) and stock should drop on A too.
  storeB.confirmSale({ lines: [{ code: p.code, name: p.name, qty: 3, price: 200 }], total: 600, given: 600, change: 0 });
  const r3 = await runSync(storeB);
  console.assert(r3.ok, "PC B sale push failed: " + JSON.stringify(r3));
  const r4 = await runSync(storeA);
  console.assert(r4.ok && r4.pulled >= 1, "PC A pull of sale failed: " + JSON.stringify(r4));
  console.assert(storeA.products[p.code].stock === 17, "PC A stock should be 17 after remote sale, got " + storeA.products[p.code].stock);

  console.log("SYNC SMOKE TEST PASSED (push, pull, cross-PC stock update all verified over real HTTPS)");
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
