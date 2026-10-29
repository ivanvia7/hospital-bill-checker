import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { extractText, getDocumentProxy } from 'unpdf';
import { readCodes, readCsvRows, readPrice } from './csv.ts';
import { readJsonItems, readJsonPrices } from './json.ts';

type Price = Awaited<ReturnType<typeof findBillPrices>>[number];

// CPT (5 digits) or HCPCS (letter + 4 digits), then quantity and line total at line end.
const PDF_LINE_WITH_QTY = /\b([A-Z]\d{4}|\d{5})\b.*\s(\d{1,3})\s+\$?([\d,]+\.\d{2})$/;
// No quantity: "LVL 3 $310.00" is not 3 units; the empty () keeps the total in slot 3.
const PDF_LINE_NO_QTY = /\b([A-Z]\d{4}|\d{5})\b.*()\s\$?([\d,]+\.\d{2})$/;
// A QTY header means every charge line has a quantity column.
const QTY_HEADER = /\bQTY\b/i;

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
    const billLine = QTY_HEADER.test(text) ? PDF_LINE_WITH_QTY : PDF_LINE_NO_QTY;
    const lines = [];

    for (const textLine of text.split('\n')) {
        const match = textLine.trim().match(billLine);

        if (match) {
            const qty = Number(match[2] || 1);
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
export async function findBillPrices(input: Readable, format: 'csv' | 'json', billCodes: Set<string>) {
    const matches = [];

    if (format === 'json') {
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

// Hospital files carry prices like 1042.7998; a bill is in cents.
function highestInCents(values: (number | null)[]) {
    const known = values.filter((value) => value !== null);

    return known.length > 0 ? Math.round(Math.max(...known) * 100) / 100 : null;
}

// Takes the highest listed price, so a flag never rests on a cheaper row.
export function compareLine(line: { code: string; amount: number; qty: number }, prices: Price[], payerName: string) {
    const matches = prices.filter((price) => price.codes.some(({ code }) => code === line.code));
    const payer = payerName.toLowerCase();
    const allRates = matches.flatMap((price) => price.payers);
    const yourRates = allRates.filter((rate) => payer && `${rate.payer} ${rate.plan}`.toLowerCase().includes(payer));
    const cash = highestInCents(matches.map((price) => price.cash));
    const plan = highestInCents(yourRates.map((rate) => rate.dollar));
    const limits = [cash, plan].filter((limit) => limit !== null);
    const isAboveAll = limits.length > 0 && limits.every((limit) => line.amount > limit);
    // Names only the prices the hospital lists; many files have no rate for your plan.
    const flagText = plan === null ? 'ABOVE CASH' : cash === null ? 'ABOVE PLAN' : 'ABOVE BOTH';

    return {
        code: line.code,
        qty: line.qty,
        billed: line.amount,
        hospital: matches[0]?.description ?? 'not in file',
        cash,
        plan,
        flag: isAboveAll ? flagText : '',
    };
}
