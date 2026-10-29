import { readFileSync } from 'node:fs';

const USAGE = 'usage: hospital-bill-checker <find|check> [options]';
const PRICE_INDEX_FILE = 'cms-hpt.txt';
const INDEX_FIELDS = ['location-name:', 'mrf-url:'];
// Matches Unix and Windows line ends.
const LINE_BREAK = /\r?\n/;

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const [command, domain] = process.argv.slice(2);

async function findPriceFiles(hospitalDomain: string) {
    const indexUrl = new URL(PRICE_INDEX_FILE, `https://${hospitalDomain}`);
    const response = await fetch(indexUrl);

    if (!response.ok) {
        throw new Error(`${indexUrl} answered ${response.status}`);
    }

    const text = await response.text();
    const priceFileLines = text
        .split(LINE_BREAK)
        .filter((line) => INDEX_FIELDS.some((field) => line.startsWith(field)));

    console.log(priceFileLines.join('\n'));
}

if (command === '--version') {
    console.log(pkg.version);
} else if (command === 'find' && domain) {
    await findPriceFiles(domain);
} else {
    console.log(USAGE);
    process.exitCode = 1;
}
