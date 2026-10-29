import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const [command] = process.argv.slice(2);

if (command === '--version') {
  console.log(pkg.version);
} else {
  console.log('usage: hospital-bill-checker <find|check> [options]');
  process.exitCode = 1;
}
