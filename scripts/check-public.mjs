// Offline publication guard. Reads only files Git would publish; never contacts a server.
import fs from 'node:fs';
import path from 'node:path';
import {isIPv4} from 'node:net';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean));
const forbiddenPath = /^(?:config\/server\.json$|(?:\.local|build|results|backups|logs|\.ssh)\/)|(?:^|\/)(?:\.env(?:\..*)?|id_rsa.*|id_ed25519.*|known_hosts)$|\.(?:pem|key|crt|csr|p12|pfx|pcap|pcapng|har)$/i;
const secrets = [
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{32,})\b/,
  /\b(?:ssh-ed25519|ssh-rsa) [A-Za-z0-9+/]{40,}/,
  /\b(?:password|token|api[_-]?key|secret)\s*[:=]\s*["'][A-Za-z0-9/_+=.-]{16,}["']/i,
  /[A-Za-z]:\\Users\\[^\\\s]+/,
];
// Public resolvers, local/firewall networks and RFC 5737 documentation addresses.
const allowedAddresses = new Set(['0.0.0.0', '1.1.1.1', '9.9.9.9', '10.0.0.0', '10.0.0.1',
  '100.64.0.0', '127.0.0.0', '127.0.0.1', '169.254.0.0', '169.254.169.254', '172.16.0.0', '172.16.0.1',
  '192.0.0.0', '192.168.0.0', '192.168.0.1', '198.18.0.0', '198.18.0.1', '224.0.0.0', '224.0.0.1',
  '240.0.0.0', '255.255.255.255', '100.64.0.1']);
const problems = [];
for (const file of files) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue; // A staged removal has no content to publish.
  if (forbiddenPath.test(file)) problems.push(`${file}: private/generated path`);
  if (fs.lstatSync(full).isSymbolicLink()) { problems.push(`${file}: symlink requires manual review`); continue; }
  const text = fs.readFileSync(full, 'utf8');
  if (secrets.some(pattern => pattern.test(text))) problems.push(`${file}: credential or personal-path marker`);
  for (const address of new Set(text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [])) {
    if (!isIPv4(address)) continue;
    if (!allowedAddresses.has(address) && !/^(?:192\.0\.2|198\.51\.100|203\.0\.113)\./.test(address)) {
      problems.push(`${file}: non-example IPv4 address (value hidden)`);
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else console.log(`Public-source scan passed: ${files.size} files, no unexpected IPs or credential markers`);
