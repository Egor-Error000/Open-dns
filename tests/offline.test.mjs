import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

// With no local configuration, every operational entry point must stop before I/O.
// If the developer has configured their own server, leave those settings untouched.
const local = new URL('../config/server.json', import.meta.url);
function assertBlocked(message) {
  for (const script of ['check-dns.mjs', 'check-https.mjs', 'check-client.mjs', 'check-boundaries.mjs', 'soak.mjs']) {
    const result = spawnSync(process.execPath, [`scripts/${script}`], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.error, undefined, `${script} must stop promptly`);
    assert.notEqual(result.status, 0, `${script} must require configuration`);
    assert.match(result.stderr, message, script);
  }
}
if (!fs.existsSync(local)) {
  assertBlocked(/Create config\/server.json/);
  fs.copyFileSync(new URL('../config/server.example.json', import.meta.url), local, fs.constants.COPYFILE_EXCL);
  try { assertBlocked(/Replace example\/private addresses/); }
  finally { fs.unlinkSync(local); }
}
console.log('Operational commands require explicit local configuration');
