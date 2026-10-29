import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { readCodes, readCsvRows, readPrice } from './csv.ts';
import { readJsonItems, readJsonPrices } from './json.ts';

export async function readBill(filePath: string) {
    const lines = [];
    const rows = createReadStream(filePath).pipe(parse({ columns: true, bom: true, trim: true }));

    for await (const row of rows) {
        lines.push({ code: row.code, amount: Number(row.amount), qty: Number(row.qty) });
    }

    return lines;
}

function isOnBill(codes: { code: string }[], billCodes: Set<string>) {
    return codes.some(({ code }) => billCodes.has(code));
}

// Streams the hospital file once; only prices for codes on the bill stay in memory.
export async function findBillPrices(input: Readable, isJson: boolean, billCodes: Set<string>) {
    const matches = [];

    if (isJson) {
        for await (const item of readJsonItems(input)) {
            if (isOnBill(item.code_information, billCodes)) {
                matches.push(...readJsonPrices(item));
            }
        }
    } else {
        for await (const row of readCsvRows(input)) {
            if (isOnBill(readCodes(row), billCodes)) {
                matches.push(readPrice(row));
            }
        }
    }

    return matches;
}
