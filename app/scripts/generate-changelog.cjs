"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const version = process.argv[2] || "1.0.0";
const changelogPath = path.join(__dirname, "../src/changelog.json");
const releaseNotesPath = path.join(__dirname, "../release-notes.md");

let existing = [];
try {
  existing = JSON.parse(fs.readFileSync(changelogPath, "utf8"));
} catch {}

let gitCommits = [];
try {
  const raw = execSync('git log -n 12 --pretty=format:"%h---%s---%b===END==="', { encoding: "utf8" });
  const entries = raw.split("===END===").map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const [hash, subject, body] = entry.split("---");
    const sub = (subject || "").trim();
    if (!sub) continue;
    if (/^(bump|merge|chore|ci|ignore|set version)/i.test(sub)) continue;
    gitCommits.push({ hash, subject: sub, body: (body || "").trim() });
  }
} catch {
  // git may not be available in some environments
}

// Generate user-friendly bullet points
const itemsFr = [];
const itemsAr = [];

for (const c of gitCommits.slice(0, 7)) {
  const s = c.subject;
  if (/safeConfirm|window focus/i.test(s)) {
    itemsFr.push("Correction du focus clavier sous Windows après les fenêtres de confirmation");
    itemsAr.push("إصلاح استجابة لوحة المفاتيح في ويندوز بعد رسائل التأكيد");
  } else if (/error alert|loud beep|scanned product/i.test(s)) {
    itemsFr.push("Alerte sonore et cadre rouge en caisse si produit introuvable");
    itemsAr.push("تنبيه صوتي وإطار أحمر في شاشة الصندوق عند مسح منتج غير مسجل");
  } else if (/f11|opening cash|safe/i.test(s)) {
    itemsFr.push("Raccourci F11 en caisse et suivi du fond de caisse dans l'Analytique");
    itemsAr.push("اختصار F11 في الصندوق ومتابعة رصيد الصندوق في التحليلات");
  } else if (/alertes page|out of stock/i.test(s)) {
    itemsFr.push("Page Alertes : produits en rupture, stocks faibles et crédits");
    itemsAr.push("صفحة التنبيهات: نفاد المخزون، والديون المتأخرة");
  } else if (/warn when the cart/i.test(s)) {
    itemsFr.push("Avertissement lorsque la quantité dépasse le stock disponible");
    itemsAr.push("تحذير عند تجاوز الكمية في السلة للمخزون المتوفر");
  } else if (/update/i.test(s) && /pop/i.test(s)) {
    itemsFr.push("Fenêtre d'information automatique après chaque mise à jour");
    itemsAr.push("نافذة توضيحية لجديد البرنامج تظهر تلقائياً بعد كل تحديث");
  } else {
    itemsFr.push(s);
    itemsAr.push(s);
  }
}

// Ensure unique items
const uniqueFr = [...new Set(itemsFr)];
const uniqueAr = [...new Set(itemsAr)];

const newEntry = {
  version,
  date: new Date().toISOString().slice(0, 10),
  title_fr: "Mise à jour v" + version,
  title_ar: "تحديث v" + version,
  items_fr: uniqueFr.length > 0 ? uniqueFr : (existing[0] && existing[0].items_fr) || ["Améliorations et corrections générales"],
  items_ar: uniqueAr.length > 0 ? uniqueAr : (existing[0] && existing[0].items_ar) || ["تحسينات وإصلاحات عامة"]
};

// Filter out identical version if already present
const filtered = existing.filter((e) => e.version !== version);
const updated = [newEntry, ...filtered];

fs.writeFileSync(changelogPath, JSON.stringify(updated, null, 2), "utf8");

// Also output release-notes.md for electron-builder / GitHub Release
const mdContent = `## Nouveautés / What's New (v${version})

${newEntry.items_fr.map((i) => `- ${i}`).join("\n")}
`;
fs.writeFileSync(releaseNotesPath, mdContent, "utf8");

console.log("Changelog generated for version " + version);
