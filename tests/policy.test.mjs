import assert from 'node:assert/strict';
import {catalog, serverConfig, rulesFor, selected, render} from '../src/render.mjs';
const all = rulesFor(Object.keys(catalog));
for (const name of ['cursor.sh', 'api2.cursor.sh', 'us-eu.gcpp.cursor.sh', 'chatgpt.com', 'auth.openai.com', 'api.anthropic.com', 'platform.claude.com', 'api.x.ai']) assert(selected(name, all), name);
for (const name of ['evilcursor.sh', 'cursor.sh.evil.example', 'evilopenai.com', 'evil.api.anthropic.com', 'cursorvm.com', 'www.youtube.com', 'video.googlevideo.com', 'storage.googleapis.com', 'github.com', serverConfig.dohHostname]) assert(!selected(name, all), name);
assert(selected('API2.CURSOR.SH.', all));
assert(!selected('sub.www.wikipedia.org', all));
assert.throws(() => rulesFor(['unknown']));
const output = render(Object.keys(catalog));
const map = output['nginx-stream.conf'];
const patterns = [...map.matchAll(/^    ~\*(\S+) /gm)].map(m => new RegExp(m[1], 'i'));
for (const name of ['cursor.sh', 'nested.api.cursor.sh', 'openai.com']) assert(patterns.some(p => p.test(name)));
for (const name of ['evilcursor.sh', 'cursor.sh.evil.example', 'youtube.com']) assert(!patterns.some(p => p.test(name)));
assert(output['YogaDNS-SmartDNS.xml'].includes('action="bypass"'));
assert(output['YogaDNS-SmartDNS.xml'].includes(`ip="${serverConfig.ipv4}"`));
assert(!output['YogaDNS-SmartDNS.xml'].includes(`ip="${serverConfig.ipv4}:443"`));
assert(output['YogaDNS-hostnames.txt'].includes('cursor.sh\n*.cursor.sh'));
assert(output['dnsdist.conf'].includes('SuffixMatchNodeRule(suffix)'));
assert(map.includes(`    ${serverConfig.dohHostname} 127.0.0.1:8443;`));
assert(map.includes('default 127.0.0.1:9;'));
assert(output['dnsdist.conf'].includes(`SpoofAction("${serverConfig.ipv4}"`));
// Configuration changes must reach DNS, nginx, YogaDNS and the guide together.
const original = {...serverConfig};
try {
  serverConfig.ipv4 = '203.0.113.7';
  serverConfig.dohHostname = 'dns.example.net';
  const changed = render(Object.keys(catalog));
  for (const file of ['dnsdist.conf', 'YogaDNS-SmartDNS.xml', 'setup.html']) assert(changed[file].includes(serverConfig.ipv4), file);
  for (const file of ['nginx-stream.conf', 'YogaDNS-SmartDNS.xml', 'setup.html']) assert(changed[file].includes(serverConfig.dohHostname), file);
  serverConfig.dohHostname = 'nested.openai.com';
  assert.throws(() => render(Object.keys(catalog)), /must not redirect itself/);
} finally { Object.assign(serverConfig, original); }
console.log('Service policy boundary and generated SNI/YogaDNS checks passed');
