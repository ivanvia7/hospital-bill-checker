import { createReadStream } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonItems, readJsonPrices } from '../src/json.ts';

// standard-charges.json = CMS V3 JSON example: 22 items in standard_charge_information.
const JSON_FILE = 'test/fixtures/standard-charges.json';
const JSON_ITEMS = 22;
// Same 29 dollar rates as tall.csv, the CMS tall example of the same prices.
const JSON_DOLLAR_RATES = 29;

test('reads every item from the JSON file', async () => {
    const items = [];

    for await (const item of readJsonItems(createReadStream(JSON_FILE))) {
        items.push(item);
    }

    assert.equal(items.length, JSON_ITEMS);
    assert.equal(items[0].description, 'MRI of brain (no contrast)');
});

test('turns a JSON item into the same price shape as the CSV', async () => {
    const prices = [];

    for await (const item of readJsonItems(createReadStream(JSON_FILE))) {
        prices.push(...readJsonPrices(item));
    }

    assert.equal(prices.length, JSON_ITEMS);
    assert.equal(prices.flatMap((price) => price.payers).length, JSON_DOLLAR_RATES);
    assert.deepEqual(prices[0], {
        codes: [{ code: '611', type: 'RC' }, { code: '70551', type: 'CPT' }],
        description: 'MRI of brain (no contrast)',
        cash: 1080,
        payers: [
            { payer: 'Platform Health Insurance', plan: 'PPO', dollar: 400 },
            { payer: 'Region Health Insurance', plan: 'HMO', dollar: 250 },
        ],
    });
});
