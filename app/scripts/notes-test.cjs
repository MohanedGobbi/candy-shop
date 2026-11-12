// Credit / debt notes: create, pay, edit, delete, undo, and two-PC replay.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Store } = require("../electron/db.cjs");

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), "notes-" + n + "-"));
const a = new Store(tmp("a"));
const lastOf = (s, type) => [...s.events].reverse().find((e) => e.type === type && !(e.payload || {}).undoOf);

const n = a.upsertNote({ kind: "credit", person: "Ahmed", phone: "0555", amount: 1500, note: "biscuits + jus" });
assert.strictEqual(a.listNotes().length, 1);
assert.strictEqual(n.paid, 0);

a.addNotePayment(n.id, 500);
a.addNotePayment(n.id, 300);
assert.strictEqual(a.notes[n.id].paid, 800);

// Undo a payment.
assert.ok(a.undo(lastOf(a, "note_payment").id).ok);
assert.strictEqual(a.notes[n.id].paid, 500);

// Edit keeps payments; undo edit restores text and keeps payments.
a.upsertNote({ id: n.id, kind: "credit", person: "Ahmed B.", phone: "0555", amount: 2000, note: "biscuits + jus + lait", paid: 9999 });
assert.strictEqual(a.notes[n.id].amount, 2000);
assert.strictEqual(a.notes[n.id].paid, 500, "an edit never changes what was paid");
assert.ok(a.undo(lastOf(a, "note_upsert").id).ok);
assert.strictEqual(a.notes[n.id].person, "Ahmed");
assert.strictEqual(a.notes[n.id].amount, 1500);
assert.strictEqual(a.notes[n.id].paid, 500);

// Delete and undo delete.
a.deleteNote(n.id);
assert.strictEqual(a.listNotes().length, 0);
assert.ok(a.undo(lastOf(a, "note_delete").id).ok);
assert.strictEqual(a.listNotes().length, 1);

// Undo creation removes it.
const d = a.upsertNote({ kind: "debt", person: "Fournisseur X", amount: 30000, note: "" });
assert.ok(a.undo(a.events.find((e) => e.type === "note_upsert" && e.payload.id === d.id).id).ok);
assert.ok(a.notes[d.id].deleted);

// Journal shows notes.
const log = a.listActivity();
assert.ok(log.some((x) => x.note && x.note.person === "Ahmed"));

// Second PC replays the log and takes a payment at the same time as PC A.
const b = new Store(tmp("b"));
for (const ev of a.events) b.applyEvent({ id: ev.id, ts: ev.ts, pc: ev.pc, type: ev.type, payload: ev.payload });
assert.deepStrictEqual(
  b.listNotes().map((x) => [x.id, x.person, x.amount, x.paid]),
  a.listNotes().map((x) => [x.id, x.person, x.amount, x.paid])
);
const pa = a.addNotePayment(n.id, 100);
const pb = b.addNotePayment(n.id, 200);
const evA = a.events[a.events.length - 1], evB = b.events[b.events.length - 1];
a.applyEvent({ ...evB, synced: undefined });
b.applyEvent({ ...evA, synced: undefined });
assert.strictEqual(a.notes[n.id].paid, 800);
assert.strictEqual(b.notes[n.id].paid, 800, "concurrent payments on two PCs both count");

console.log("ALL NOTES TESTS PASSED");
