import assert from 'node:assert/strict';
import { validatePublishMetadata } from './publish_metadata.js';

assert.throws(
  () => validatePublishMetadata({ files: ['LICENSE'] }, true),
  /Choose and set the package license/,
  'publishing requires an explicit package license');
assert.equal(
  validatePublishMetadata({ license: 'UNLICENSED' }, false),
  'UNLICENSED',
  'an explicitly unlicensed package does not need a license file');
assert.throws(
  () => validatePublishMetadata({ license: 'MIT', files: ['LICENSE'] }, false),
  /Add web\/LICENSE/,
  'an open-source license requires its text file');
assert.throws(
  () => validatePublishMetadata({ license: 'MIT' }, true),
  /Add LICENSE to the package files allowlist/,
  'an open-source license file must be shipped in the package');
assert.equal(
  validatePublishMetadata({ license: 'MIT', files: ['LICENSE'] }, true),
  'MIT',
  'open-source metadata passes when the license file is included');

console.log('package publish metadata checks passed');
