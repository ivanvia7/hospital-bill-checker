import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { extractText, getDocumentProxy } from 'unpdf';
import { readCodes, readCsvRows, readPrice } from './csv.ts';
import { readJsonItems, readJsonPrices } from './json.ts';

// CPT (5 digits) or HCPCS (letter + 4 digits), then quantity and line total at line end.
const PDF_BILL_LINE = /\b([A-Z]\d{4}|\d{5})\b.*\s(\d{1,3})\s+\$?([\d,]+\.\d{2})$/;

export async function readBill(filePath: string) {
    const lines = [];
    const rows = createReadStream(filePath).pipe(parse({ columns: true, bom: true, trim: true }));

    for await (const row of rows) {
        lines.push({ code: row.code, amount: Number(row.amount), qty: Number(row.qty) });
    }

    return lines;
}

// Only text PDFs: a scanned bill is a picture and gives no text.
export async function readPdfBill(filePath: string) {
    const bytes = await readFile(filePath);
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const lines = [];

    for (const textLine of text.split('\n')) {
        const match = textLine.trim().match(PDF_BILL_LINE);

        if (match) {
            const qty = Number(match[2]);
            // PDF shows the line total; the hospital file prices one unit.
            lines.push({ code: match[1], amount: Number(match[3].replaceAll(',', '')) / qty, qty });
        }
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
