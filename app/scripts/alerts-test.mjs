import assert from "assert";
import { computeAlerts } from "../src/alerts.js";

const DAY = 86400000, now = 100 * DAY;
const products = [
  { code: "A", name: "Sold out, sells", stock: 0, minStock: 0, price: 50 },
  { code: "B", name: "Old dead item", stock: 0, minStock: 0, price: 20 },
  { code: "C", name: "Negative, sells", stock: -2, minStock: 0, price: 30 },
  { code: "D", name: "Under its minimum", stock: 4, minStock: 5, price: 10 },
  { code: "E", name: "Sells fast, 20 left", stock: 20, minStock: 0, price: 10 },
  { code: "F", name: "Plenty, sells slowly", stock: 50, minStock: 0, price: 10 },
  { code: "G", name: "No price", stock: 10, minStock: 0, price: null },
  { code: "H", name: "Low but never sold", stock: 2, minStock: 0, price: 5 },
  { code: "I", name: "Barcode in minimum field", stock: 0, minStock: 4005808305995, price: 5 }
];
const sale = (daysAgo, code, qty, cancelled = false) => ({ date: now - daysAgo * DAY, cancelled, lines: [{ code, qty }] });
const sales = [
  sale(3, "A", 4), sale(10, "C", 2), sale(1, "F", 1),
  ...Array.from({ length: 10 }, (_, i) => sale(i + 1, "E", 9)), // 90 in 30 days = 3/day -> ~6.7 days left
  sale(2, "H", 1, true) // cancelled sale does not count
];
const notes = [
  { id: "n1", person: "Ahmed", amount: 1000, paid: 200, createdAt: now - 45 * DAY },
  { id: "n2", person: "Karima", amount: 500, paid: 0, createdAt: now - 5 * DAY },
  { id: "n3", person: "Paid", amount: 300, paid: 300, createdAt: now - 90 * DAY }
];

let r = computeAlerts({ products, sales, notes, threshold: 3, now });
assert.deepStrictEqual(r.out.map((x) => x.code), ["A", "C"], "only selling products are out-of-stock alerts");
assert.ok(r.out.find((x) => x.code === "C").negative);
assert.strictEqual(r.hidden.out, 2, "old dead item and absurd minimum hidden");
assert.deepStrictEqual(r.low.map((x) => x.code), ["E", "D"], "fast seller first, then under minimum");
assert.ok(r.low[0].soon && Math.round(r.low[0].daysLeft) === 7);
assert.strictEqual(r.hidden.low, 1, "low but never sold is hidden");
assert.deepStrictEqual(r.check.map((x) => x.code), ["G"]);
assert.deepStrictEqual(r.credits.map((x) => x.id), ["n1"], "only unpaid notes older than 30 days");
assert.strictEqual(r.credits[0].remaining, 800);
assert.strictEqual(r.badge, 2 + 2 + 1);

r = computeAlerts({ products, sales, notes, threshold: 3, now, showAll: true });
assert.deepStrictEqual(r.out.map((x) => x.code).sort(), ["A", "B", "C", "I"]);
assert.ok(r.low.some((x) => x.code === "H"));

console.log("ALERTS TESTS PASSED");
