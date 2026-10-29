import { createReadStream } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareLine, findBillPrices, readBill, readPdfBill } from '../src/bill.ts';

// bill.csv = a made-up 5-line bill: brain MRI, ER visit, metabolic panel, blood count, blood draw.
const BILL_CSV = 'test/fixtures/bill.csv';
const BILL_LINES = 5;
// $3,250 (written with $ and comma) + 2,840.50 + 412 + 2 x 186.75 + 2 x 45.
const BILL_TOTAL = 6966;

test('reads every line of the bill', async () => {
    const lines = await readBill(BILL_CSV);

    assert.equal(lines.length, BILL_LINES);
    assert.deepEqual(lines[0], { code: '70551', amount: 3250, qty: 1 });
    assert.equal(lines.reduce((sum, line) => sum + line.amount * line.qty, 0), BILL_TOTAL);
});

test('passes a missing file error to the caller', async () => {
    await assert.rejects(readBill('test/fixtures/missing.csv'), { code: 'ENOENT' });
    await assert.rejects(findBillPrices(createReadStream('test/fixtures/missing.csv'), 'csv', new Set()), { code: 'ENOENT' });
    await assert.rejects(findBillPrices(createReadStream('test/fixtures/missing.json'), 'json', new Set()), { code: 'ENOENT' });
});

test('keeps only hospital prices whose code is on the bill', async () => {
    // Brain MRI 70551 and hernia repair 49505 are in both CMS examples.
    const billCodes = new Set(['70551', '49505']);

    // Tall gives one row per payer, 2 per item; JSON gives one price per item with both payers inside.
    const tallPrices = await findBillPrices(createReadStream('test/fixtures/tall.csv'), 'csv', billCodes);
    const jsonPrices = await findBillPrices(createReadStream('test/fixtures/standard-charges.json'), 'json', billCodes);

    assert.equal(tallPrices.length, 4);
    assert.equal(jsonPrices.length, 2);
    assert.deepEqual(jsonPrices.map((price) => price.description), ['MRI of brain (no contrast)', 'Inguinal hernia repair']);
});

test('finds every charge line in a text PDF bill', async () => {
    // bill.pdf = the 5 lines of bill.csv plus J7121; address, total and insurance lines must not match.
    const lines = await readPdfBill('test/fixtures/bill.pdf');
    const csvLines = await readBill(BILL_CSV);

    assert.equal(lines.length, 6);
    assert.deepEqual(lines.slice(0, 5), csvLines);
    assert.deepEqual(lines[5], { code: 'J7121', amount: 63, qty: 1 });
});

test('counts 1 unit per line when the PDF has no quantity column', async () => {
    // 99213 ends in "LVL 3", which must not be read as 3 units.
    const lines = await readPdfBill('test/fixtures/bill-no-qty.pdf');

    assert.deepEqual(lines, [{ code: '99213', amount: 310, qty: 1 }, { code: '36415', amount: 45, qty: 1 }]);
});

test('reads a UNITS header as the quantity column and skips 0-unit lines', async () => {
    // bill-units.pdf: 80053 x1, 85025 x0 at $0.00 (a voided line), 36415 x2 at $90.00.
    const lines = await readPdfBill('test/fixtures/bill-units.pdf');

    assert.deepEqual(lines, [{ code: '80053', amount: 412, qty: 1 }, { code: '36415', amount: 45, qty: 2 }]);
});

test('flags a line billed above both the cash price and the plan rate', async () => {
    // Tall MRI rows: cash $1,080, Platform PPO $400, Region HMO $250.
    const prices = await findBillPrices(createReadStream('test/fixtures/tall.csv'), 'csv', new Set(['70551']));
    const overcharged = compareLine({ code: '70551', amount: 3250, qty: 1 }, prices, 'platform');
    const fair = compareLine({ code: '70551', amount: 900, qty: 1 }, prices, 'platform');

    assert.deepEqual([overcharged.cash, overcharged.plan, overcharged.flag], [1080, 400, 'ABOVE BOTH']);
    assert.equal(fair.flag, '');
    // Prices round to cents: a listed 1042.7998 must print as 1042.8.
    assert.equal(compareLine({ code: '70551', amount: 1, qty: 1 }, [{ ...prices[0], cash: 1042.7998 }], '').cash, 1042.8);
    assert.equal(compareLine({ code: '70551', amount: 3250, qty: 1 }, prices, 'region').plan, 250);
});
