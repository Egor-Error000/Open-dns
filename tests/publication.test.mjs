import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root = new URL('../', import.meta.url);
const fixture = new URL(`publication-probe-${randomUUID()}.txt`, root);
const scan = () => spawnSync(process.execPath, ['scripts/check-public.mjs'], {
  cwd: root, encoding: 'utf8', timeout: 10000,
});
try {
  fs.writeFileSync(fixture, 'Documentation address: 192.0.2.8\n', {flag: 'wx'});
  let result = scan();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  fs.writeFileSync(fixture, ['8', '8', '8', '8'].join('.'));
  result = scan();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-example IPv4/);
  fs.writeFileSync(fixture, 'AKIA' + 'A'.repeat(16));
  result = scan();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /credential or personal-path marker/);
} finally { fs.unlinkSync(fixture); }
console.log('Publication guard detects unexpected IP addresses and credential-shaped values');
