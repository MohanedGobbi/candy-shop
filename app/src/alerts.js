// Pure logic for the Alertes page and the menu badge. No DOM, unit-tested.
//
// Most imported products are old items that never sell again, with stock 0
// or below. Listing all of them would bury the useful alerts, so by default
// only "active" products count: sold in the last 60 days, or given a
// minimum stock. `showAll` lifts that filter.

const DAY = 24 * 3600 * 1000;

export function computeAlerts({ products, sales, notes = [], threshold = 3, now = Date.now(), showAll = false, daysAhead = 7, overdueDays = 30 }) {
  const sold30 = new Map(), sold60 = new Map(), lastSold = new Map();
  for (const s of sales) {
    if (s.cancelled) continue;
    const age = now - s.date;
    if (age < 0 || age > 60 * DAY) continue;
    for (const l of s.lines || []) {
      sold60.set(l.code, (sold60.get(l.code) || 0) + l.qty);
      if (age <= 30 * DAY) sold30.set(l.code, (sold30.get(l.code) || 0) + l.qty);
      lastSold.set(l.code, Math.max(lastSold.get(l.code) || 0, s.date));
    }
  }

  const out = [], low = [], check = [];
  let hiddenOut = 0, hiddenLow = 0;
  for (const p of products) {
    if (p.deleted) continue;
    const stock = Number(p.stock) || 0;
    // A few imported products have a barcode in the minimum field; ignore absurd values.
    const rawMin = Number(p.minStock) || 0;
    const min = rawMin > 0 && rawMin < 100000 ? rawMin : 0;
    const s30 = sold30.get(p.code) || 0;
    const s60 = sold60.get(p.code) || 0;
    const perDay = s30 / 30;
    const daysLeft = perDay > 0 ? stock / perDay : null;
    const active = s60 > 0 || min > 0;
    const row = { code: p.code, name: p.name, barcode: p.barcode, stock, min, sold30: s30, daysLeft, lastSold: lastSold.get(p.code) || null, price: p.price };

    if (p.price == null || p.price === "" || Number(p.price) === 0) check.push({ ...row, reason: "no_price" });

    if (stock <= 0) {
      if (active || showAll) out.push({ ...row, negative: stock < 0 });
      else hiddenOut++;
      continue;
    }
    const underMin = min > 0 ? stock <= min : stock <= threshold;
    const soon = daysLeft !== null && daysLeft <= daysAhead;
    if (underMin || soon) {
      if (active || showAll) low.push({ ...row, soon });
      else hiddenLow++;
    }
  }

  out.sort((a, b) => b.sold30 - a.sold30 || (a.name || "").localeCompare(b.name || ""));
  low.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.stock - b.stock || (a.name || "").localeCompare(b.name || ""));

  const credits = notes
    .filter((n) => !n.deleted)
    .map((n) => ({ ...n, remaining: Math.max(0, (Number(n.amount) || 0) - (Number(n.paid) || 0)), ageDays: Math.floor((now - (n.createdAt || n.updatedAt || now)) / DAY) }))
    .filter((n) => n.remaining > 0 && n.ageDays >= overdueDays)
    .sort((a, b) => b.ageDays - a.ageDays);

  return {
    out, low, check, credits,
    hidden: { out: hiddenOut, low: hiddenLow },
    // The menu badge counts what needs action, not the data-quality list.
    badge: (showAll ? 0 : out.length + low.length) + credits.length
  };
}

export const SALES_WINDOW_MS = 60 * DAY;
