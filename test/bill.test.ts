import { createReadStream } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBillPrices, readBill } from '../src/bill.ts';

// bill.csv = a made-up 5-line bill: brain MRI, ER visit, metabolic panel, blood count, blood draw.
const BILL_CSV = 'test/fixtures/bill.csv';
const BILL_LINES = 5;
// 3,250 + 2,840.50 + 412 + 2 x 186.75 + 2 x 45.
const BILL_TOTAL = 6966;

test('reads every line of the bill', async () => {
    const lines = await readBill(BILL_CSV);

    assert.equal(lines.length, BILL_LINES);
    assert.deepEqual(lines[0], { code: '70551', amount: 3250, qty: 1 });
    assert.equal(lines.reduce((sum, line) => sum + line.amount * line.qty, 0), BILL_TOTAL);
});

test('keeps only hospital prices whose code is on the bill', async () => {
    // Brain MRI 70551 and hernia repair 49505 are in both CMS examples.
    const billCodes = new Set(['70551', '49505']);

    // Tall gives one row per payer, 2 per item; JSON gives one price per item with both payers inside.
    const tallPrices = await findBillPrices(createReadStream('test/fixtures/tall.csv'), false, billCodes);
    const jsonPrices = await findBillPrices(createReadStream('test/fixtures/standard-charges.json'), true, billCodes);

    assert.equal(tallPrices.length, 4);
    assert.equal(jsonPrices.length, 2);
    assert.deepEqual(jsonPrices.map((price) => price.description), ['MRI of brain (no contrast)', 'Inguinal hernia repair']);
});
