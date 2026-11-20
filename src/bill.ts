import { pipeline, type Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { extractText, getDocumentProxy } from 'unpdf';
import { readCodes, readCsvRows, readPrice } from './csv.ts';
import { readJsonItems, readJsonPrices } from './json.ts';

type Price = Awaited<ReturnType<typeof findBillPrices>>[number];

// CPT (5 digits) or HCPCS (letter + 4 digits), then quantity and line total at line end.
// Quantity starts at 1: a voided line with qty 0 is skipped, not divided by zero.
const PDF_LINE_WITH_QTY = /\b([A-Z]\d{4}|\d{5})\b.*\s([1-9]\d{0,2})\s+\$?([\d,]+\.\d{2})$/;
// No quantity: "LVL 3 $310.00" is not 3 units; the empty () keeps the total in slot 3.
const PDF_LINE_NO_QTY = /\b([A-Z]\d{4}|\d{5})\b.*()\s\$?([\d,]+\.\d{2})$/;
// A QTY, UNITS or QUANTITY header means every charge line has a quantity column.
const QTY_HEADER = /\b(QTY|UNITS|QUANTITY)\b/i;
// Bills write amounts as "$3,250.00"; Number() needs "3250.00".
const MONEY_MARKS = /[$,]/g;

const BILL_COLUMNS = ['code', 'amount', 'qty'];

// "Code" and "code" are the same column; a missing one stops here instead of reading as NaN.
function readBillColumns(names: string[]) {
    const columns = names.map((name) => name.trim().toLowerCase());
    const missing = BILL_COLUMNS.filter((column) => !columns.includes(column));

    if (missing.length > 0) {
        throw new Error(`The bill needs the columns code, amount and qty; missing ${missing.join(', ')}`);
    }

    return columns;
}

// A bad cell names its line; a NaN amount would never flag and look like a fair price.
function readBillNumber(cell: string, column: string, line: number) {
    const value = Number(cell.replace(MONEY_MARKS, ''));

    if (!cell || !Number.isFinite(value)) {
        throw new Error(`Bill line ${line}: ${column} "${cell}" is not a number`);
    }

    return value;
}

export async function readBill(input: Readable) {
    const lines = [];
    const rows = pipeline(input, parse({ columns: readBillColumns, bom: true, trim: true }), () => {});
    // Line 1 holds the column names.
    let line = 1;

    for await (const row of rows) {
        line++;
        lines.push({
            // Price files write HCPCS codes in capitals: "j7121" must still find J7121.
            code: String(row.code).toUpperCase(),
            amount: readBillNumber(row.amount, 'amount', line),
            qty: readBillNumber(row.qty, 'qty', line),
        });
    }

    return lines;
}

// Only text PDFs: a scanned bill is a picture and gives no text.
export async function readPdfBill(bytes: Uint8Array) {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const billLine = QTY_HEADER.test(text) ? PDF_LINE_WITH_QTY : PDF_LINE_NO_QTY;
    const lines = [];

    for (const textLine of text.split('\n')) {
        const match = textLine.trim().match(billLine);

        if (match) {
            const qty = Number(match[2] || 1);
            // PDF shows the line total; the hospital file prices one unit.
            lines.push({ code: match[1], amount: Number(match[3].replace(MONEY_MARKS, '')) / qty, qty });
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

function planName(rate: { payer: string; plan: string }) {
    return `${rate.payer} ${rate.plan}`;
}

// "aetna" matches 29 NYU plans that pay from $26.51 to $325.51 for one test, so the patient picks one.
// An exact name wins, as "Aetna AETNA PPO 1010" is also part of longer plan names.
export function findPlans(prices: Price[], payerText: string) {
    const text = payerText.trim().toLowerCase();

    if (!text) {
        return [];
    }

    const names = new Set(prices.flatMap((price) => price.payers.map(planName)));
    const matches = [...names].filter((name) => name.toLowerCase().includes(text)).sort();
    const exact = matches.find((name) => name.toLowerCase() === text);

    return exact ? [exact] : matches;
}

// Takes the highest listed price, so a flag never rests on a cheaper row.
// plan is one full name from findPlans, or '' to compare with the cash price only.
export function compareLine(line: { code: string; amount: number; qty: number }, prices: Price[], plan: string) {
    const matches = prices.filter((price) => price.codes.some(({ code }) => code === line.code));
    const yourRates = matches.flatMap((price) => price.payers).filter((rate) => plan && planName(rate) === plan);
    const cash = highestInCents(matches.map((price) => price.cash));
    const planPrice = highestInCents(yourRates.map((rate) => rate.dollar));
    const limits = [cash, planPrice].filter((limit) => limit !== null);
    const isAboveAll = limits.length > 0 && limits.every((limit) => line.amount > limit);
    // Names only the prices the hospital lists; many files have no rate for your plan.
    const flagText = planPrice === null ? 'ABOVE CASH' : cash === null ? 'ABOVE PLAN' : 'ABOVE BOTH';

    return {
        code: line.code,
        qty: line.qty,
        billed: line.amount,
        hospital: matches[0]?.description ?? 'not in file',
        cash,
        plan: planPrice,
        flag: isAboveAll ? flagText : '',
    };
}
