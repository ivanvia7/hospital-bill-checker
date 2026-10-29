import { createReadStream, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';
import { findBillPrices, readBill } from './bill.ts';
import { BLOCKED_STATUS, downloadInBrowser, readTextInBrowser } from './browser.ts';

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

    if (!response.ok && response.status !== BLOCKED_STATUS) {
        throw new Error(`${indexUrl} answered ${response.status}`);
    }

    const text = response.ok ? await response.text() : await readTextInBrowser(indexUrl);
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
    const isJson = file.url.pathname.endsWith('.json');
    const billCodes = new Set(bill.map((line) => line.code));
    const response = await fetch(file.url);
    let prices;

    if (response.ok && response.body) {
        prices = await findBillPrices(Readable.from(response.body), isJson, billCodes);
    } else if (response.status === BLOCKED_STATUS) {
        console.error('Blocked by the site, downloading through a browser');
        const filePath = await downloadInBrowser(file.url);

        try {
            prices = await findBillPrices(createReadStream(filePath), isJson, billCodes);
        } finally {
            await rm(dirname(filePath), { recursive: true });
        }
    } else {
        throw new Error(`${file.url} answered ${response.status}`);
    }

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
