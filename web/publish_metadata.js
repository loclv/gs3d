export function validatePublishMetadata(manifest, licenseFileExists) {
  if (typeof manifest.license !== 'string' || manifest.license.trim() === '') {
    throw new Error('Choose and set the package license in package.json before publishing.');
  }

  if (manifest.license !== 'UNLICENSED') {
    if (!manifest.files?.includes('LICENSE')) {
      throw new Error('Add LICENSE to the package files allowlist before publishing an open-source package.');
    }
    if (!licenseFileExists) {
      throw new Error('Add web/LICENSE before publishing an open-source package.');
    }
  }
  return manifest.license;
}
