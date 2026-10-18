import {serverConfig, requireDeploymentConfig} from '../src/render.mjs';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';

requireDeploymentConfig();
const server = serverConfig.ipv4;
async function rejectSNI(servername) {
  await new Promise((resolve, reject) => {
    const socket = tls.connect({ host: server, port: 443, servername, rejectUnauthorized: true });
    const deadline = setTimeout(() => { socket.destroy(); reject(new Error('no-SNI connection did not close within 12 seconds')); }, 12000);
    socket.once('secureConnect', () => { clearTimeout(deadline); socket.destroy(); reject(new Error('server accepted TLS without SNI')); });
    socket.once('error', error => {
      clearTimeout(deadline);
      if (error.code === 'ECONNRESET') { console.log(`Rejected ${servername || 'no SNI'}: ${error.code}`); resolve(); }
      else reject(new Error(`Unexpected failure for ${servername || 'no SNI'}: ${error.code}`));
    });
  });
}
async function closedTCP(port) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: server, port });
    socket.setTimeout(3000, () => { socket.destroy(); console.log(`TCP ${port}: no response`); resolve(); });
    socket.once('connect', () => { socket.destroy(); reject(new Error(`unexpected public TCP listener: ${port}`)); });
    socket.once('error', error => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') { console.log(`TCP ${port}: refused`); resolve(); }
      else reject(error);
    });
  });
}
async function closedUDP53() {
  await new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const packet = Buffer.from('4d5301000001000000000000037777770977696b697065646961036f72670000010001', 'hex');
    const deadline = setTimeout(() => { socket.close(); console.log('Public UDP DNS did not respond'); resolve(); }, 3000);
    socket.once('message', () => { clearTimeout(deadline); socket.close(); reject(new Error('public UDP DNS responded')); });
    socket.once('error', error => { clearTimeout(deadline); socket.close(); reject(error); });
    socket.send(packet, 53, server);
  });
}
const skipDNS = process.argv.includes('--skip-dns');
const results = await Promise.allSettled([rejectSNI(), rejectSNI('example.com'), rejectSNI('evilcursor.sh'),
  ...[...(skipDNS ? [] : [53]), 5300, 8053, 8443, 8444].map(closedTCP),
  ...(skipDNS ? [] : [closedUDP53()])]);
for (const result of results) if (result.status === 'rejected') {
  console.error(result.reason);
  process.exitCode = 1;
}
