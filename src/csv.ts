import type { Readable } from 'node:stream';
import { parse } from 'csv-parse';

const COLUMN_NAMES_LINE = 3;
// Matches "code | 1" spacing from the CMS tall example, so it reads as NYU's "code|1".
const SPACES_AROUND_PIPE = /\s*\|\s*/g;
// NYU plan names carry byte 0xA0, read as U+FFFD; it and runs of spaces become one space.
const ODD_SPACES = /[\s\uFFFD]+/g;
// Wide files give each plan its own column: standard_charge|<payer>|<plan>|negotiated_dollar.
const WIDE_DOLLAR_COLUMN = /^standard_charge\|(.+)\|(.+)\|negotiated_dollar$/;

function cleanColumnNames(names: string[]) {
    return names.map((name) => name.replace(ODD_SPACES, ' ').replace(SPACES_AROUND_PIPE, '|'));
}

export function readCsvRows(input: Readable) {
    const csvParser = parse({ from_line: COLUMN_NAMES_LINE, columns: cleanColumnNames, bom: true });

    return input.pipe(csvParser);
}

// Codes sit in slots code|1..code|n, each with its type in code|n|type; empty slots are skipped.
export function readCodes(row: Record<string, string>) {
    const codes = [];

    for (let slot = 1; `code|${slot}` in row; slot++) {
        const code = row[`code|${slot}`];

        if (code) {
            codes.push({ code, type: row[`code|${slot}|type`] });
        }
    }

    return codes;
}

// An empty cell means the hospital posted no price; Number('') would turn it into a fake $0.
function readDollar(cell: string) {
    return cell ? Number(cell) : null;
}

function readWidePayers(row: Record<string, string>) {
    const payers = [];

    for (const [column, cell] of Object.entries(row)) {
        const match = column.match(WIDE_DOLLAR_COLUMN);

        if (match && cell) {
            payers.push({ payer: match[1], plan: match[2], dollar: Number(cell) });
        }
    }

    return payers;
}

// Tall files give one plan per row, in payer_name, plan_name and one dollar column.
function readTallPayers(row: Record<string, string>) {
    const dollar = row['standard_charge|negotiated_dollar'];

    return dollar ? [{ payer: row['payer_name'], plan: row['plan_name'], dollar: Number(dollar) }] : [];
}

export function readPrice(row: Record<string, string>) {
    return {
        codes: readCodes(row),
        description: row['description'],
        setting: row['setting'].toLowerCase(),
        gross: readDollar(row['standard_charge|gross']),
        cash: readDollar(row['standard_charge|discounted_cash']),
        payers: 'payer_name' in row ? readTallPayers(row) : readWidePayers(row),
    };
}
