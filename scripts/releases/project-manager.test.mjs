import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackedPaths } from './context.mjs';
import { prepareRelease } from './prepare.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const commit = 'a'.repeat(40), hash = 'b'.repeat(64), digest = `sha256:${hash}`;
const appId = 'com.haas.project-manager';

// Exercise the actual recipe and its complete tracked input set, not a simplified Dockerfile.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'project-manager-context-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  for (const path of trackedPaths(repositoryRoot)) {
    const source = join(repositoryRoot, path);
    if (!existsSync(source)) continue;
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    chmodSync(destination, statSync(source).mode);
  }
  const values = new Map(), probes = [];
  const store = { refresh: () => commit, json: (_head, path) => values.get(path) ?? null };
  let sequence = 0;
  const prepare = (overrides = {}) => prepareRelease({ root, output: join(root, '.git', `plan-${sequence++}`),
    sourceCommit: commit, validationRunId: '42', repository: 'alex-de-haas/project-manager', store, resolveExternal: false,
    verify: async (...args) => { probes.push(['graph', ...args]); },
    prove: async (...args) => { probes.push(['provenance', ...args]); }, ...overrides });
  const retain = plan => {
    const image = plan.images[0];
    values.set('artifacts/images/project-manager/current.json', { schemaVersion: 'hosty-image-artifact.0.1',
      repository: image.recipe.repository, digest, inputFingerprint: image.inputFingerprint,
      buildSourceCommit: commit, provenance: 'https://example.test/original-proof', platforms: image.recipe.platforms });
    values.set(`apps/${appId}/candidate.json`, { inputFingerprint: plan.apps[0].inputFingerprint, releaseId: hash });
    values.set(`apps/${appId}/feed-state.json`, { feeds: { daily: { releaseId: hash } } });
  };
  const change = path => { const target = join(root, path); writeFileSync(target, readFileSync(target, 'utf8') + '\n'); };
  return { root, prepare, retain, change, probes };
}

test('ordinary documentation does not select a release or enter the materialized image context', async t => {
  const f = fixture(t), initial = await f.prepare();
  assert.equal(initial.images[0].recipe.reusable, true);
  assert.equal(initial.images[0].recipe.inputFallback, undefined);
  f.retain(initial);
  for (const path of ['README.md', 'AGENTS.md', 'docs/features/ready-releases/feature.md']) f.change(path);
  const plan = await f.prepare();
  assert.equal(plan.apps[0].selected, false);
  assert.equal(plan.images[0].decision, 'unchanged-app');
  assert.equal(plan.images[0].inputFingerprint, initial.images[0].inputFingerprint);
  const context = join(f.root, '.git/plan-1/contexts/project-manager');
  for (const path of ['README.md', 'AGENTS.md', 'docs', 'manifest.json', 'feeds.json', '.github']) {
    assert.equal(existsSync(join(context, path)), false, path);
  }
  for (const path of ['src', 'public', 'test', 'package-lock.json', 'docker/debian.sources', 'docker-entrypoint.sh']) {
    assert.equal(existsSync(join(context, path)), true, path);
  }
  assert.deepEqual(f.probes, []);
});

test('release asset changes reuse the original digest only after graph and provenance verification', async t => {
  const f = fixture(t), initial = await f.prepare();
  f.retain(initial);
  f.change('docs/store.md');
  const plan = await f.prepare();
  assert.equal(plan.apps[0].selected, true);
  assert.equal(plan.images[0].inputFingerprint, initial.images[0].inputFingerprint);
  assert.equal(plan.images[0].decision, 'reuse');
  assert.equal(plan.images[0].previous.digest, digest);
  assert.deepEqual(f.probes.map(p => p[0]), ['graph', 'provenance']);
  assert.deepEqual(f.probes[0].slice(1), ['ghcr.io/alex-de-haas/project-manager', digest, ['linux/amd64', 'linux/arm64']]);
  assert.equal(f.probes[1][1], `oci://ghcr.io/alex-de-haas/project-manager@${digest}`);
  assert.equal(f.probes[1][2].buildSourceCommit, commit);
  for (const failure of ['verify', 'prove']) {
    const rejected = await f.prepare({ [failure]: async () => { throw new Error(`Invalid ${failure}`); } });
    assert.equal(rejected.images[0].decision, 'build');
    assert.match(rejected.images[0].reason, /failed verification/);
  }
});

test('runtime inputs and explicit dependency refreshes invalidate the retained image', async t => {
  const f = fixture(t), initial = await f.prepare();
  f.retain(initial);
  for (const path of ['src/app/globals.css', 'public/favicon.svg', 'package-lock.json', 'next.config.js',
    'tsconfig.json', 'test/server-only-stub.ts', 'vitest.config.ts', 'docker-entrypoint.sh', 'docker/debian.sources', 'Dockerfile']) {
    const target = join(f.root, path), original = readFileSync(target);
    f.change(path);
    const plan = await f.prepare();
    assert.equal(plan.apps[0].selected, true, path);
    assert.equal(plan.images[0].decision, 'build', path);
    assert.notEqual(plan.images[0].inputFingerprint, initial.images[0].inputFingerprint, path);
    writeFileSync(target, original);
  }
});

test('every npm dependency eligible for image reuse has a locked archive and integrity hash', () => {
  const lock = JSON.parse(readFileSync(join(repositoryRoot, 'package-lock.json')));
  for (const [path, dependency] of Object.entries(lock.packages)) {
    if (path === '') continue;
    if (dependency.inBundle) {
      const split = path.lastIndexOf('/node_modules/');
      const parent = lock.packages[path.slice(0, split)];
      assert.ok(parent?.integrity && parent.bundleDependencies?.includes(path.slice(split + '/node_modules/'.length)), path);
      continue;
    }
    assert.match(dependency.resolved ?? '', /^https:\/\/registry\.npmjs\.org\/.*\.tgz$/, path);
    assert.match(dependency.integrity ?? '', /^sha512-[A-Za-z0-9+/]+=*$/, path);
    assert.equal(dependency.link, undefined, path);
  }
});
