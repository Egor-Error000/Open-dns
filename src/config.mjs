import fs from 'node:fs';
import {isIPv4} from 'node:net';

const localConfig = new URL('../config/server.json', import.meta.url);
const exampleConfig = new URL('../config/server.example.json', import.meta.url);
const hostnamePattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function validateServerConfig(value) {
  if (!value || typeof value !== 'object' || !isIPv4(value.ipv4) ||
      typeof value.dohHostname !== 'string' || value.dohHostname.length > 253 ||
      !hostnamePattern.test(value.dohHostname) || value.sshUser !== 'root') {
    throw new Error('Invalid server configuration; expected IPv4, DNS hostname and root SSH user');
  }
  return value;
}

export const serverConfig = validateServerConfig(JSON.parse(fs.readFileSync(
  fs.existsSync(localConfig) ? localConfig : exampleConfig, 'utf8')));

export function assertDeploymentEndpoint(value) {
  validateServerConfig(value);
  const [a, b, c] = value.ipv4.split('.').map(Number);
  const nonPublic = a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113);
  const placeholder = /(?:^|\.)(?:example\.(?:com|org|net)|example|invalid|test|localhost|local)$/.test(value.dohHostname);
  if (nonPublic || placeholder) throw new Error('Replace example/private addresses with your own public server endpoint');
  return value;
}

export function requireDeploymentConfig() {
  if (!fs.existsSync(localConfig)) {
    throw new Error('Create config/server.json from config/server.example.json and configure your own server first');
  }
  return assertDeploymentEndpoint(serverConfig);
}
