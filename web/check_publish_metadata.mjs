import { access, readFile } from 'node:fs/promises';
import { validatePublishMetadata } from './publish_metadata.js';

const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
let licenseFileExists = true;
try {
  await access(new URL('./LICENSE', import.meta.url));
} catch {
  licenseFileExists = false;
}

const license = validatePublishMetadata(manifest, licenseFileExists);
console.log(`publish metadata check passed (${license})`);
