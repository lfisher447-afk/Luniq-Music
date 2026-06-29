import { fileURLToPath } from 'node:url';
import path from 'node:path';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);


globalThis.__filename = filename;
globalThis.__dirname = dirname;

process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    return;
  }
  console.warn(warning.message);
});
