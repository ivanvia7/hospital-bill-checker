import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';
import { findBillPrices, readBill } from './bill.ts';

const USAGE = 'usage: hospital-bill-checker find <domain> | check --bill <bill.csv> --hospital <domain> [--location <name>]';
const PRICE_INDEX_FILE = 'cms-hpt.txt';
const LOCATION_FIELD = 'location-name:';
const FILE_FIELD = 'mrf-url:';
// Matches Unix and Windows line ends.
const LINE_BREAK = /\r?\n/;

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
        version: { type: 'boolean' },
        bill: { type: 'string' },
        hospital: { type: 'string' },
        location: { type: 'string', default: '' },
    },
});
const [command, domain] = positionals;

// In cms-hpt.txt each location-name line comes before that location's mrf-url line.
async function readPriceFiles(hospitalDomain: string) {
    const indexUrl = new URL(PRICE_INDEX_FILE, `https://${hospitalDomain}`);
    const response = await fetch(indexUrl);

    if (!response.ok) {
        throw new Error(`${indexUrl} answered ${response.status}`);
    }

    const text = await response.text();
    const files = [];
    let location = '';

    for (const line of text.split(LINE_BREAK)) {
        if (line.startsWith(LOCATION_FIELD)) {
            location = line.slice(LOCATION_FIELD.length).trim();
        } else if (line.startsWith(FILE_FIELD)) {
            files.push({ location, url: new URL(line.slice(FILE_FIELD.length).trim()) });
        }
    }

    return files;
}

async function printPriceFiles(hospitalDomain: string) {
    for (const file of await readPriceFiles(hospitalDomain)) {
        console.log(`${LOCATION_FIELD} ${file.location}\n${FILE_FIELD} ${file.url}`);
    }
}

async function checkBill(billPath: string, hospitalDomain: string, locationName: string) {
    const bill = await readBill(billPath);
    const files = await readPriceFiles(hospitalDomain);
    const file = files.find((candidate) => candidate.location.toLowerCase().includes(locationName.toLowerCase()));

    if (!file) {
        throw new Error(`${hospitalDomain} lists no location matching "${locationName}"`);
    }

    console.error(`Reading ${file.location}: ${file.url}`);
    const response = await fetch(file.url);

    if (!response.ok || !response.body) {
        throw new Error(`${file.url} answered ${response.status}`);
    }

    const isJson = file.url.pathname.endsWith('.json');
    const prices = await findBillPrices(Readable.from(response.body), isJson, new Set(bill.map((line) => line.code)));

    console.table(bill.map((line) => {
        const matches = prices.filter((price) => price.codes.some(({ code }) => code === line.code));
        // Hospitals often list a code twice; the row with a cash price is the hospital's own fee.
        const price = matches.find((match) => match.cash !== null) ?? matches[0];

        return {
            code: line.code,
            qty: line.qty,
            billed: line.amount,
            hospital: price?.description ?? 'not in file',
            gross: price?.gross ?? '',
            cash: price?.cash ?? '',
        };
    }));
}

if (values.version) {
    console.log(pkg.version);
} else if (command === 'find' && domain) {
    await printPriceFiles(domain);
} else if (command === 'check' && values.bill && values.hospital) {
    await checkBill(values.bill, values.hospital, values.location);
} else {
    console.log(USAGE);
    process.exitCode = 1;
}
