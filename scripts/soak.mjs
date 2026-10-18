import {serverConfig, requireDeploymentConfig} from '../src/render.mjs';
// A finite 24-hour client-to-VPS experiment. No system DNS changes.
import http2 from 'node:http2';
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

requireDeploymentConfig();
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const samples = Number(option('--samples', '100'));
const duration = Number(option('--duration-seconds', '86400')) * 1000;
const output = path.resolve(option('--output', 'results/soak-24h.json'));
const server = serverConfig.ipv4;
const dohName = serverConfig.dohHostname;
const target = 'www.wikipedia.org';
if (!Number.isInteger(samples) || samples < 2 || !Number.isFinite(duration) || duration < 1000) throw new Error('invalid sample schedule');
if (fs.existsSync(output)) throw new Error('result file already exists; choose a new run');
fs.mkdirSync(path.dirname(output), { recursive: true });

function skipName(packet, offset) {
  for (let i = 0; i < 128 && offset < packet.length; i++) {
    const n = packet[offset];
    if ((n & 0xc0) === 0xc0) return offset + 2;
    if (n === 0) return offset + 1;
    offset += n + 1;
  }
  throw new Error('malformed DNS response');
}

async function resolveSelected() {
  const header = Buffer.from('4d5301000001000000000000', 'hex');
  const labels = target.split('.').map(label => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]));
  const wire = Buffer.concat([header, ...labels, Buffer.from([0, 0, 1, 0, 1])]);
  const session = http2.connect(`https://${dohName}`, {
    createConnection: () => tls.connect({ host: server, port: 443, servername: dohName, ALPNProtocols: ['h2'], rejectUnauthorized: true, minVersion: 'TLSv1.2' }),
  });
  session.on('error', () => {});
  try {
    const packet = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { session.destroy(); reject(new Error('DoH timeout')); }, 12000);
      session.once('error', reject);
      const request = session.request({ ':method': 'GET', ':path': `/dns-query?dns=${wire.toString('base64url')}`, accept: 'application/dns-message' });
      const chunks = [];
      request.on('response', headers => {
        if (headers[':status'] !== 200 || !headers['content-type']?.startsWith('application/dns-message')) reject(new Error('invalid DoH response'));
      });
      request.on('data', chunk => chunks.push(chunk));
      request.on('error', reject);
      request.on('end', () => { clearTimeout(deadline); resolve(Buffer.concat(chunks)); });
      request.end();
    });
    if (packet.length < 12 || packet.readUInt16BE(0) !== 0x4d53 || (packet.readUInt16BE(2) & 0x800f) !== 0x8000) throw new Error('invalid DNS response');
    let offset = 12;
    for (let i = 0; i < packet.readUInt16BE(4); i++) offset = skipName(packet, offset) + 4;
    const addresses = [];
    for (let i = 0; i < packet.readUInt16BE(6); i++) {
      offset = skipName(packet, offset);
      const type = packet.readUInt16BE(offset);
      const length = packet.readUInt16BE(offset + 8);
      offset += 10;
      if (type === 1 && length === 4) addresses.push([...packet.subarray(offset, offset + 4)].join('.'));
      offset += length;
    }
    if (addresses.length !== 1 || addresses[0] !== server) throw new Error('unexpected selected-domain DNS address');
    return addresses[0];
  } finally {
    session.destroy();
  }
}

async function relayHead(address) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: address, port: 443, servername: target, method: 'HEAD', path: '/', headers: { Host: target, 'User-Agent': 'SmartDNS/1.0 (small availability test)' }, agent: false, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, response => {
      const peer = response.socket.remoteAddress;
      const authorized = response.socket.authorized;
      const cert = response.socket.getPeerCertificate();
      response.resume();
      response.on('end', () => resolve({ http_status: response.statusCode, remote_ip: peer, tls_authorized: authorized, certificate_name: cert.subject?.CN }));
      response.on('error', reject);
    });
    const deadline = setTimeout(() => request.destroy(new Error('relay timeout')), 15000);
    request.once('close', () => clearTimeout(deadline));
    request.on('error', reject);
    request.end();
  });
}

const start = Date.now();
const state = { pid: process.pid, started_utc: new Date(start).toISOString(), scheduled_end_utc: new Date(start + duration).toISOString(), server, doh_name: dohName, target, expected_samples: samples, status: 'running', samples: [] };
function save() {
  state.updated_utc = new Date().toISOString();
  state.successes = state.samples.filter(sample => sample.ok).length;
  state.missed = state.samples.filter(sample => sample.missed).length;
  fs.writeFileSync(output + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(output + '.tmp', output);
}
save();
for (let i = 0; i < samples; i++) {
  const due = start + duration * i / (samples - 1);
  if (Date.now() < due) await delay(due - Date.now());
  const sample = { sequence: i + 1, scheduled_utc: new Date(due).toISOString(), actual_utc: new Date().toISOString(), ok: false };
  if (Date.now() - due > 60000) {
    sample.missed = true;
    sample.error = 'sample missed: computer slept or process was paused';
  } else {
    const began = Date.now();
    try {
      sample.dns_address = await resolveSelected();
      Object.assign(sample, await relayHead(sample.dns_address));
      sample.ok = sample.http_status === 200 && sample.remote_ip === server && sample.tls_authorized === true;
    } catch (error) {
      sample.error = String(error.message).slice(0, 300);
      sample.error_code = error.code ?? null;
      sample.certificate_error = /CERT|TLS|ISSUER|VERIFY|SELF_SIGNED/.test(error.code ?? '');
    }
    sample.elapsed_ms = Date.now() - began;
  }
  state.samples.push(sample);
  save();
}
let consecutive = 0;
let maximum = 0;
for (const sample of state.samples) { consecutive = sample.ok ? 0 : consecutive + 1; maximum = Math.max(maximum, consecutive); }
state.maximum_consecutive_failures = maximum;
state.certificate_errors = state.samples.filter(sample => sample.certificate_error).length;
state.status = state.missed ? 'incomplete' : state.successes >= Math.ceil(samples * 0.99) && state.certificate_errors === 0 && maximum < 2 ? 'passed' : 'failed';
state.finished_utc = new Date().toISOString();
save();
console.log(JSON.stringify({ status: state.status, successes: state.successes, expected: samples, output }));
if (state.status !== 'passed') process.exitCode = 1;
