import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertDeploymentEndpoint, validateServerConfig} from '../src/config.mjs';

const example = JSON.parse(fs.readFileSync(new URL('../config/server.example.json', import.meta.url), 'utf8'));
assert.equal(validateServerConfig(example), example);
assert.throws(() => assertDeploymentEndpoint(example), /Replace example/);
for (const ipv4 of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
  '172.16.0.1', '192.0.2.1', '192.168.0.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255']) {
  assert.throws(() => assertDeploymentEndpoint({...example, ipv4, dohHostname: 'dns.operator-domain.tld'}), /Replace example/, ipv4);
}
for (const dohHostname of ['dns.example.com', 'dns.example.org', 'dns.example.net', 'dns.invalid', 'dns.test', 'dns.localhost', 'dns.local']) {
  assert.throws(() => assertDeploymentEndpoint({...example, ipv4: '1.1.1.1', dohHostname}), /Replace example/, dohHostname);
}
for (const change of [{ipv4: '999.0.0.1'}, {dohHostname: 'bad;host.example.com'}, {dohHostname: '<bad>.com'}, {sshUser: 'root;command'}]) {
  assert.throws(() => validateServerConfig({...example, ...change}), /Invalid server configuration/);
}
assert.equal(assertDeploymentEndpoint({...example, ipv4: '1.1.1.1', dohHostname: 'dns.operator-domain.tld'}).ipv4, '1.1.1.1');
console.log('Configuration validation rejects documentation endpoints, private networks and unsafe fields');
