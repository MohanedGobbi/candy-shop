// Syncs the local event log with a Google Apps Script "web app" published
// from inside the store's Google Sheet - see apps-script/SETUP.md.
// No service account, no Google Cloud project, no key file: just an HTTPS
// URL and a shared password, both pasted into Settings.
//
// Push: send unsynced local events as rows.
// Pull: ask for every row after the last one we've already read, apply any
//       we haven't applied yet.
// Any error (offline, bad URL, wrong key, script not deployed) is caught
// and reported as a status object - it never throws up into the app.
"use strict";
const https = require("https");
const http = require("http");
const { URL } = require("url");

function httpRequest(urlStr, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const transport = url.protocol === "http:" ? http : https; // Apps Script is always https; http: only used by local tests
    const data = body ? JSON.stringify(body) : null;
    const req = transport.request(
      url,
      {
        method,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
          : {}
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          // Apps Script replies with a redirect to a content-delivery URL that only
          // serves GET, regardless of the original method - so the follow-up is
          // always a bodyless GET, never a repeat of the original POST.
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            httpRequest(res.headers.location, { method: "GET" }).then(resolve, reject);
            return;
          }
          try {
            resolve({ status: res.statusCode, json: JSON.parse(chunks) });
          } catch (err) {
            reject(new Error("invalid_response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    if (data) req.write(data);
    req.end();
  });
}

async function runSync(store) {
  const { webAppUrl, syncKey } = store.settings;
  if (!webAppUrl || !syncKey) return { ok: false, reason: "not_configured" };

  // --- PULL first, so our own push below doesn't get re-applied as "remote" ---
  let pulled = 0;
  try {
    const after = store.settings.lastPulledRow || 2;
    const pullUrl = `${webAppUrl}?key=${encodeURIComponent(syncKey)}&action=pull&after=${after}`;
    const res = await httpRequest(pullUrl);
    if (!res.json.ok) return { ok: false, reason: "remote_error", detail: res.json.error };

    for (const row of res.json.rows) {
      const [id, ts, pc, type, payloadJson] = row;
      if (!id) continue;
      let payload = {};
      try { payload = JSON.parse(payloadJson); } catch { payload = {}; }
      const applied = store.applyEvent({ id, ts: Number(ts), pc, type, payload });
      if (applied) pulled++;
    }
    store.saveSettings({ lastPulledRow: res.json.lastRow + 1 });
  } catch (err) {
    return { ok: false, reason: "pull_failed", detail: String(err.message || err) };
  }

  // --- PUSH our unsynced events ---
  let pushed = 0;
  try {
    const unsynced = store.getUnsyncedEvents();
    if (unsynced.length > 0) {
      const rows = unsynced.map((e) => [e.id, e.ts, e.pc, e.type, JSON.stringify(e.payload)]);
      const res = await httpRequest(webAppUrl, { method: "POST", body: { key: syncKey, events: rows } });
      if (!res.json.ok) return { ok: false, reason: "remote_error", detail: res.json.error, pulled };
      store.markEventsSynced(unsynced.map((e) => e.id));
      pushed = unsynced.length;
      // our own rows are now in the sheet too; advance lastPulledRow so we don't re-pull them as "remote"
      store.saveSettings({ lastPulledRow: res.json.lastRow + 1 });
    }
  } catch (err) {
    return { ok: false, reason: "push_failed", detail: String(err.message || err), pulled };
  }

  return { ok: true, pulled, pushed };
}

module.exports = { runSync };
