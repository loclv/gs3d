import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('.', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const tempDir = await mkdtemp(join(tmpdir(), 'goose-3d-package-'));
const packDir = join(tempDir, 'pack');
const consumerDir = join(tempDir, 'consumer');
const env = { ...process.env, npm_config_cache: join(tempDir, 'npm-cache') };

try {
  await mkdir(packDir);
  await mkdir(consumerDir);
  const packed = JSON.parse(execFileSync('npm', [
    'pack', '--json', '--pack-destination', packDir,
  ], { cwd: packageDir, env, encoding: 'utf8' }))[0];
  const paths = new Set(packed.files.map(file => file.path));
  assert.ok(paths.has('assets.js') && paths.has('assets.d.ts'));
  assert.ok(paths.has('orbit-controls.js') && paths.has('orbit-controls.d.ts'));
  assert.ok(![...paths].some(path => path.endsWith('.glb') || path.startsWith('test_')),
    'the package tarball omits repository tests and sample assets');

  await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
  }));
  const archive = join(packDir, packed.filename);
  execFileSync('npm', [
    'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive,
  ], { cwd: consumerDir, env, stdio: 'pipe' });

  for (const entry of Object.values(manifest.exports)) {
    await access(join(consumerDir, 'node_modules', manifest.name, entry.import));
    await access(join(consumerDir, 'node_modules', manifest.name, entry.types));
  }
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import * as assets from '${manifest.name}';
    import * as controls from '${manifest.name}/orbit-controls';
    assert.equal(typeof assets.loadGLTF, 'function');
    assert.equal(typeof assets.loadImage, 'function');
    assert.equal(typeof controls.createOrbitControls, 'function');
  `], { cwd: consumerDir, env, stdio: 'pipe' });
  console.log(`package tarball install checks passed (${paths.size} files)`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
