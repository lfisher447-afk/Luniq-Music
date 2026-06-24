import { fileURLToPath } from 'node:url';
import path from 'node:path';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);


globalThis.__filename = filename;

globalThis.__dirname = dirname;
