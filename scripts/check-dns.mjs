import assert from 'node:assert/strict';
import http2 from 'node:http2';
import tls from 'node:tls';
import { randomInt } from 'node:crypto';
import { rulesFor, serverConfig, catalog, requireDeploymentConfig } from '../src/render.mjs';

requireDeploymentConfig();
const server = serverConfig.ipv4;
const hostname = serverConfig.dohHostname;

function query(name, type) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(randomInt(65536), 0);
  header.writeUInt16BE(0x100, 2);
  header.writeUInt16BE(1, 4);
  const labels = name.split('.').map(part => Buffer.concat([Buffer.from([part.length]), Buffer.from(part)]));
  const tail = Buffer.alloc(5);
  tail.writeUInt16BE(type, 1);
  tail.writeUInt16BE(1, 3);
  return Buffer.concat([header, ...labels, tail]);
}

function skipName(packet, offset) {
  for (let count = 0; count < 128; count++) {
    assert(offset < packet.length, 'truncated DNS name');
    const length = packet[offset];
    if ((length & 0xc0) === 0xc0) return offset + 2;
    if (length === 0) return offset + 1;
    assert(length <= 63, 'invalid DNS label');
    offset += 1 + length;
  }
  throw new Error('DNS name too long');
}

function parse(packet, request) {
  assert(packet.length >= 12, 'short DNS packet');
  assert.equal(packet.readUInt16BE(0), request.readUInt16BE(0), 'DNS ID');
  assert(packet.readUInt16BE(2) & 0x8000, 'not a DNS response');
  let offset = 12;
  for (let i = 0; i < packet.readUInt16BE(4); i++) offset = skipName(packet, offset) + 4;
  const records = [];
  for (let i = 0; i < packet.readUInt16BE(6); i++) {
    offset = skipName(packet, offset);
    const type = packet.readUInt16BE(offset);
    const ttl = packet.readUInt32BE(offset + 4);
    const length = packet.readUInt16BE(offset + 8);
    offset += 10;
    assert(offset + length <= packet.length, 'truncated DNS data');
    records.push({ type, ttl, value: type === 1 && length === 4 ? [...packet.subarray(offset, offset + 4)].join('.') : packet.subarray(offset, offset + length).toString('hex') });
    offset += length;
  }
  return { rcode: packet.readUInt16BE(2) & 15, records };
}

const session = http2.connect(`https://${hostname}`, {
  createConnection: () => tls.connect({ host: server, port: 443, servername: hostname, ALPNProtocols: ['h2'], minVersion: 'TLSv1.2', rejectUnauthorized: true }),
});
session.on('error', () => {});
session.setTimeout(12000, () => session.destroy(new Error('HTTP/2 timeout')));

async function requestDNS(name, type) {
  const wire = query(name, type);
  const body = await new Promise((resolve, reject) => {
    const request = session.request({ ':method': 'GET', ':path': `/dns-query?dns=${wire.toString('base64url')}`, accept: 'application/dns-message' });
    const chunks = [];
    request.on('response', headers => {
      if (headers[':status'] !== 200 || !headers['content-type']?.startsWith('application/dns-message')) {
        reject(new Error(`bad DoH headers: ${JSON.stringify(headers)}`));
      }
    });
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
    request.end();
  });
  const result = { name, type, ...parse(body, wire) };
  console.log(JSON.stringify(result));
  return result;
}

try {
  const profileArg = process.argv.find(arg => arg.startsWith('--profiles='));
  {
    const rules = rulesFor(profileArg ? profileArg.slice(11).split(',') : Object.keys(catalog));
    const names = [...rules.exact, ...rules.suffix];
    for (const name of names) {
      const answer = await requestDNS(name, 1);
      assert.equal(answer.rcode, 0, name);
      assert.deepEqual(answer.records.map(r => r.value), [server], name);
      for (const type of [28, 64, 65]) {
        const reply = await requestDNS(name, type);
        assert.equal(reply.rcode, 0, name);
        assert.equal(reply.records.length, 0, name);
      }
    }
    for (const name of ['api2.cursor.sh', 'us-eu.gcpp.cursor.sh', 'auth.openai.com']) {
      if (!rules.suffix.some(s => name.endsWith('.' + s))) continue;
      assert.deepEqual((await requestDNS(name, 1)).records.map(r => r.value), [server]);
    }
    for (const name of ['evilcursor.sh', 'cursor.sh.example.com', 'www.youtube.com', 'cursorvm.com']) {
      assert(!(await requestDNS(name, 1)).records.some(r => r.value === server), name);
    }
  }
  const selected = await requestDNS('www.wikipedia.org', 1);
  assert.equal(selected.rcode, 0);
  assert.deepEqual(selected.records.map(record => record.value), [server]);
  for (const type of [28, 64, 65]) {
    const result = await requestDNS('www.wikipedia.org', type);
    assert.equal(result.rcode, 0);
    assert.equal(result.records.length, 0);
  }
  const ordinary = await requestDNS('example.com', 1);
  assert.equal(ordinary.rcode, 0);
  assert(ordinary.records.some(record => record.type === 1));
  assert(!ordinary.records.some(record => record.value === server));
  const subdomain = await requestDNS('not-listed.www.wikipedia.org', 1);
  assert(!subdomain.records.some(record => record.value === server));
  console.log('DoH HTTP/2, certificate validation, selected/ordinary names and IPv6/SVCB/HTTPS answers passed');
} finally {
  session.destroy();
}
