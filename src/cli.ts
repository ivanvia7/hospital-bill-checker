import { createReadStream, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { compareLine, findBillPrices, readBill, readPdfBill } from './bill.ts';
import { BLOCKED_STATUS, downloadInBrowser, readTextInBrowser } from './browser.ts';

const USAGE = 'usage: hospital-bill-checker find <domain> | check --bill <bill.csv|bill.pdf> --hospital <domain> [--location <name>] [--payer <name and plan>]';
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
        payer: { type: 'string', default: '' },
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

// Reading a PDF is a guess, so the user sees the lines found and confirms them first.
async function readBillFile(billPath: string) {
    if (!billPath.toLowerCase().endsWith('.pdf')) {
        return readBill(billPath);
    }

    const bill = await readPdfBill(billPath);
    console.table(bill);
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question(`Found ${bill.length} lines in the PDF. Check these against the hospital? [y/N] `);
    prompt.close();

    return answer.trim().toLowerCase() === 'y' ? bill : [];
}

async function checkBill(billPath: string, hospitalDomain: string, locationName: string, payerName: string) {
    const bill = await readBillFile(billPath);

    if (bill.length === 0) {
        console.error('No bill lines to check');
        return;
    }

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

    console.table(bill.map((line) => compareLine(line, prices, payerName)));
}

if (values.version) {
    console.log(pkg.version);
} else if (command === 'find' && domain) {
    await printPriceFiles(domain);
} else if (command === 'check' && values.bill && values.hospital) {
    await checkBill(values.bill, values.hospital, values.location, values.payer);
} else {
    console.log(USAGE);
    process.exitCode = 1;
}
