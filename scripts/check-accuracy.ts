// Checks the tool against a hospital price file on a seeded sample of bill lines.
// It reads the file a second way, with plain csv-parse or JSON.parse, and reports every line where the two disagree.
// usage: node scripts/check-accuracy.ts <price file> <plan> [--seed 7] [--lines 80]
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'csv-parse';
import { compareLine, findBillPrices, findPlans } from '../src/bill.ts';

type Listed = { cash: number[]; plan: number[]; gross: number[] };

const BILLABLE_TYPES = new Set(['CPT', 'HCPCS']);
// A bill line priced at a random amount, so lines fall on both sides of the listed prices.
const RANDOM_LOW = 5;
const RANDOM_HIGH = 3000;

// Same seed, same sample: mulberry32.
function seededRandom(seed: number) {
    let state = seed;

    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Plan names in NYU's file carry byte 0xA0, so spacing is compared loosely.
function sameName(a: string, b: string) {
    const loose = (text: string) => text.replace(/[\s�]+/g, ' ').trim().toLowerCase();

    return loose(a) === loose(b);
}

function dollars(cell: unknown) {
    const value = Number(cell);

    return cell !== '' && cell !== null && cell !== undefined && Number.isFinite(value) ? [value] : [];
}

function add(listed: Map<string, Listed>, code: string, entry: Listed) {
    const known = listed.get(code) ?? { cash: [], plan: [], gross: [] };

    known.cash.push(...entry.cash);
    known.plan.push(...entry.plan);
    known.gross.push(...entry.gross);
    listed.set(code, known);
}

async function readCsv(path: string, plan: string) {
    const listed = new Map<string, Listed>();
    // The CMS tall example writes "code | 1"; only the spacing is evened out, as files differ in it.
    const columns = (names: string[]) => names.map((name) => name.replace(/[\s\uFFFD]+/g, ' ').replace(/\s*\|\s*/g, '|'));
    const rows = createReadStream(path).pipe(parse({ from_line: 3, columns, bom: true, relax_column_count: true }));

    for await (const row of rows as AsyncIterable<Record<string, string>>) {
        const planCells = 'payer_name' in row
            ? sameName(`${row.payer_name} ${row.plan_name}`, plan) ? [row['standard_charge|negotiated_dollar']] : []
            : Object.keys(row)
                  .filter((column) => {
                      const [kind, payer, planName, field] = column.split('|');
                      return kind === 'standard_charge' && field === 'negotiated_dollar' && sameName(`${payer} ${planName}`, plan);
                  })
                  .map((column) => row[column]);

        for (let slot = 1; `code|${slot}` in row; slot++) {
            if (BILLABLE_TYPES.has(row[`code|${slot}|type`])) {
                add(listed, row[`code|${slot}`], {
                    cash: dollars(row['standard_charge|discounted_cash']),
                    plan: planCells.flatMap(dollars),
                    gross: dollars(row['standard_charge|gross']),
                });
            }
        }
    }

    return listed;
}

type JsonFile = {
    standard_charge_information: {
        code_information: { code: string; type: string }[];
        standard_charges: {
            gross_charge?: number;
            discounted_cash?: number;
            payers_information?: { payer_name: string; plan_name: string; standard_charge_dollar?: number }[];
        }[];
    }[];
};

async function readJson(path: string, plan: string) {
    const listed = new Map<string, Listed>();
    const file: JsonFile = JSON.parse(await readFile(path, 'utf8'));

    for (const item of file.standard_charge_information) {
        for (const charge of item.standard_charges) {
            const planDollars = (charge.payers_information ?? [])
                .filter((payer) => sameName(`${payer.payer_name} ${payer.plan_name}`, plan))
                .flatMap((payer) => dollars(payer.standard_charge_dollar));

            for (const { code, type } of item.code_information) {
                if (BILLABLE_TYPES.has(type)) {
                    add(listed, code, { cash: dollars(charge.discounted_cash), plan: planDollars, gross: dollars(charge.gross_charge) });
                }
            }
        }
    }

    return listed;
}

function highest(values: number[]) {
    return values.length > 0 ? Math.round(Math.max(...values) * 100) / 100 : null;
}

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { seed: { type: 'string', default: '7' }, lines: { type: 'string', default: '80' } },
});
const [path, plan] = positionals;

if (!path || !plan) {
    console.log('usage: node scripts/check-accuracy.ts <price file> <plan> [--seed 7] [--lines 80]');
    process.exit(1);
}

const format = extname(path).toLowerCase() === '.json' ? 'json' : 'csv';
const listed = format === 'json' ? await readJson(path, plan) : await readCsv(path, plan);

if (listed.size === 0) {
    console.log(`The second reading found no CPT or HCPCS codes in ${path}, so there is nothing to compare`);
    process.exit(1);
}

const random = seededRandom(Number(values.seed));
const codes = [...listed.keys()].sort();
const sample = [];

while (sample.length < Number(values.lines) && codes.length > 0) {
    const [code] = codes.splice(Math.floor(random() * codes.length), 1);
    const { gross } = listed.get(code) as Listed;
    // Half the lines at a list price, what an uninsured bill shows.
    const amount = gross.length > 0 && random() < 0.5
        ? gross[Math.floor(random() * gross.length)]
        : Math.round((RANDOM_LOW + random() * (RANDOM_HIGH - RANDOM_LOW)) * 100) / 100;

    sample.push({ code, amount, qty: 1 });
}

const prices = await findBillPrices(createReadStream(path), format, new Set(sample.map((line) => line.code)));
const plans = findPlans(prices, plan);
let wrong = 0;

// The second reading matches the plan by its full name, so part of a name would compare two different things.
if (plans.length !== 1 || !sameName(plans[0], plan)) {
    console.log(`Pass the full name of one plan. "${plan}" matches: ${plans.join('; ') || 'none'}`);
    process.exit(1);
}

for (const line of sample) {
    const known = listed.get(line.code) as Listed;
    const cash = highest(known.cash);
    const planPrice = highest(known.plan);
    const limits = [cash, planPrice].filter((limit) => limit !== null);
    const flagged = limits.length > 0 && limits.every((limit) => line.amount > limit);
    const tool = compareLine(line, prices, plans[0]);

    if (tool.cash !== cash || tool.plan !== planPrice || Boolean(tool.flag) !== flagged) {
        wrong++;
        console.log(`${line.code} billed ${line.amount}: file cash ${cash} plan ${planPrice} flag ${flagged}; tool cash ${tool.cash} plan ${tool.plan} flag "${tool.flag}"`);
    }
}

console.log(`${sample.length - wrong} of ${sample.length} lines match ${path} for ${plans[0]}, seed ${values.seed}`);
process.exitCode = wrong > 0 ? 1 : 0;
