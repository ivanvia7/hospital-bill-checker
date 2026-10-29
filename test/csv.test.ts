import { createReadStream } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCodes, readCsvRows, readPrice } from '../src/csv.ts';

// wide.csv = first 13 lines of the NYU Tisch file: 2 hospital-info lines, 1 column-name line, 10 prices.
const WIDE_CSV = 'test/fixtures/wide.csv';
const WIDE_PRICE_ROWS = 10;
// Line 4 of wide.csv: J7121 = "5% DEXTROSE IN LAC RINGERS", gross $63, cash $11.97.
const FIRST_ROW_CODE = 'J7121';

// tall.csv = CMS V3 tall example: 2 hospital-info lines, 1 column-name line, 45 prices.
const TALL_CSV = 'test/fixtures/tall.csv';
const TALL_PRICE_ROWS = 45;
// Line 4 of tall.csv: slot 1 holds revenue code 611, slot 2 holds CPT 70551.
const TALL_CPT_CODE = '70551';

test('reads every price row from the wide CSV', async () => {
    const rows = [];

    for await (const row of readCsvRows(createReadStream(WIDE_CSV))) {
        rows.push(row);
    }

    assert.equal(rows.length, WIDE_PRICE_ROWS);
    // Each row is keyed by the column names on line 3, so 'code|1' is the first billing code.
    assert.equal(rows[0]['code|1'], FIRST_ROW_CODE);
});

test('reads the tall CSV with spaces around the pipes', async () => {
    const rows = [];

    for await (const row of readCsvRows(createReadStream(TALL_CSV))) {
        rows.push(row);
    }

    assert.equal(rows.length, TALL_PRICE_ROWS);
    assert.equal(rows[0]['code|2'], TALL_CPT_CODE);
    assert.equal(rows[0]['code|2|type'], 'CPT');
});

test('collects every code slot of a row', async () => {
    const [wideRow] = await readCsvRows(createReadStream(WIDE_CSV)).toArray();
    const [tallRow] = await readCsvRows(createReadStream(TALL_CSV)).toArray();

    // Wide line 4 fills 3 slots; tall line 4 fills 2, with the CPT in slot 2.
    assert.deepEqual(readCodes(wideRow), [
        { code: 'J7121', type: 'HCPCS' },
        { code: '5010003', type: 'LOCAL' },
        { code: '636', type: 'RC' },
    ]);
    assert.deepEqual(readCodes(tallRow), [
        { code: '611', type: 'RC' },
        { code: '70551', type: 'CPT' },
    ]);
});

test('turns a row into one price shape', async () => {
    const [wideRow] = await readCsvRows(createReadStream(WIDE_CSV)).toArray();
    const [tallRow, , tallRowNoPrice] = await readCsvRows(createReadStream(TALL_CSV)).toArray();

    assert.deepEqual(readPrice(wideRow), {
        codes: readCodes(wideRow),
        description: '5% DEXTROSE IN LAC RINGERS',
        setting: 'inpatient',
        gross: 63,
        cash: 11.97,
        payers: readPrice(wideRow).payers,
    });
    assert.equal(readPrice(tallRow).gross, 1200);
    assert.equal(readPrice(tallRow).cash, 1080);
    // Tall line 6, hernia repair, has empty gross and cash cells: no price, not $0.
    assert.equal(readPrice(tallRowNoPrice).gross, null);
    assert.equal(readPrice(tallRowNoPrice).cash, null);
});

test('reads one payer per filled plan column in the wide CSV', async () => {
    const [wideRow] = await readCsvRows(createReadStream(WIDE_CSV)).toArray();
    const { payers } = readPrice(wideRow);

    // Line 4 has 413 plan columns; 208 hold a dollar amount, the rest are empty.
    assert.equal(payers.length, 208);
    assert.deepEqual(payers[0], { payer: 'Aetna', plan: 'AETNA HMO 1005', dollar: 18.9 });
});

test('reads one payer per row in the tall CSV', async () => {
    const prices = (await readCsvRows(createReadStream(TALL_CSV)).toArray()).map(readPrice);

    assert.deepEqual(prices[0].payers, [{ payer: 'Platform Health Insurance', plan: 'PPO', dollar: 400 }]);
    // 29 of 45 rows give a dollar rate; tall line 14, a C-section, gives only a formula.
    assert.equal(prices.filter((price) => price.payers.length > 0).length, 29);
    assert.deepEqual(prices[10].payers, []);
});

test('cleans the broken space out of NYU plan names', async () => {
    const [wideRow] = await readCsvRows(createReadStream(WIDE_CSV)).toArray();
    const plans = readPrice(wideRow).payers.map((payer) => payer.plan);

    assert.ok(plans.includes('EMBLEM SELECT CARE PPO 3870'));
    assert.ok(plans.every((plan) => !plan.includes('\uFFFD')));
});
