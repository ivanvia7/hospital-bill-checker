import { createReadStream, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { compareLine, findBillPrices, readBill, readPdfBill } from './bill.ts';
import { BLOCKED_STATUS, downloadInBrowser, readTextInBrowser } from './browser.ts';

const USAGE = 'usage: hospital-bill-checker find <domain> | check --bill <bill.csv|bill.pdf> (--hospital <domain> [--location <name>] | --file <price file>) [--payer <name and plan>]';
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
        file: { type: 'string' },
    },
});
const [command, domain] = positionals;
const hasPriceSource = Boolean(values.hospital || values.file);

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
            const url = line.slice(FILE_FIELD.length).trim();

            // One empty or relative mrf-url must not hide the other locations.
            if (URL.canParse(url)) {
                files.push({ location, url: new URL(url) });
            } else {
                console.error(`Skipping ${location}: "${url}" is not a full URL`);
            }
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

// A .zip or .xlsx read as CSV would match nothing and still print a clean-looking table.
function readFormat(path: string) {
    const extension = extname(path).toLowerCase();

    if (extension !== '.csv' && extension !== '.json') {
        throw new Error(`${path}: expected a .csv or .json price file`);
    }

    return extension === '.json' ? 'json' : 'csv';
}

// Downloads the price file listed for the location; falls back to a browser when the site blocks plain requests.
async function findHospitalPrices(hospitalDomain: string, locationName: string, billCodes: Set<string>) {
    const files = await readPriceFiles(hospitalDomain);
    const name = locationName.toLowerCase();
    const matches = files.filter((candidate) => candidate.location.toLowerCase().includes(name));
    // "Stanford Health Care" is also part of "Stanford Health Care Tri-Valley", so an exact name wins.
    const file = files.find((candidate) => candidate.location.toLowerCase() === name) ?? (matches.length === 1 ? matches[0] : undefined);

    if (!file) {
        const names = matches.map((match) => match.location).join('; ');
        throw new Error(`${hospitalDomain} lists ${matches.length} locations matching "${locationName}": ${names || 'none'}. Pass one with --location`);
    }

    console.error(`Reading ${file.location}: ${file.url}`);
    const format = readFormat(file.url.pathname);
    const response = await fetch(file.url);

    if (response.ok && response.body) {
        return findBillPrices(Readable.from(response.body), format, billCodes);
    }

    if (response.status !== BLOCKED_STATUS) {
        throw new Error(`${file.url} answered ${response.status}`);
    }

    console.error('Blocked by the site, downloading through a browser');
    const filePath = await downloadInBrowser(file.url);

    try {
        return await findBillPrices(createReadStream(filePath), format, billCodes);
    } finally {
        await rm(dirname(filePath), { recursive: true });
    }
}

async function checkBill(billPath: string, payerName: string, source: { file?: string; hospital?: string; location: string }) {
    const bill = await readBillFile(billPath);

    if (bill.length === 0) {
        console.error('No bill lines to check');
        return;
    }

    const billCodes = new Set(bill.map((line) => line.code));
    // --file reads a price file already on disk, such as one unzipped from a hospital's .zip download.
    const prices = source.file
        ? await findBillPrices(createReadStream(source.file), readFormat(source.file), billCodes)
        : await findHospitalPrices(source.hospital ?? '', source.location, billCodes);

    console.table(bill.map((line) => compareLine(line, prices, payerName)));
}

// A wrong path, location or 404 prints one line, not a stack.
try {
    if (values.version) {
        console.log(pkg.version);
    } else if (command === 'find' && domain) {
        await printPriceFiles(domain);
    } else if (command === 'check' && values.bill && hasPriceSource) {
        await checkBill(values.bill, values.payer, values);
    } else {
        console.log(USAGE);
        process.exitCode = 1;
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
