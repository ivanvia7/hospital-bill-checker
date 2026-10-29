// csv-parse and stream-json use Node's global Buffer and process; esbuild injects these where they appear.
export { Buffer } from 'buffer';
export { default as process } from 'process/browser.js';
