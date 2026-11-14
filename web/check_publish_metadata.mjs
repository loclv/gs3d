import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('.', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

if (typeof manifest.license !== 'string' || manifest.license.trim() === '') {
  throw new Error('Choose and set the package license in package.json before publishing.');
}

if (manifest.license !== 'UNLICENSED') {
  if (!manifest.files?.includes('LICENSE')) {
    throw new Error('Add LICENSE to the package files allowlist before publishing an open-source package.');
  }
  try {
    await access(new URL('./LICENSE', import.meta.url));
  } catch {
    throw new Error('Add web/LICENSE before publishing an open-source package.');
  }
}

console.log(`publish metadata check passed (${manifest.license})`);
