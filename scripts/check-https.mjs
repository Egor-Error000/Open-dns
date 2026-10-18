import {serverConfig, requireDeploymentConfig} from '../src/render.mjs';
import https from 'node:https';
requireDeploymentConfig();
const names = process.argv.slice(2);
if (!names.length) throw new Error('Provide hostnames');
for (const name of names) {
  await new Promise(resolve => {
    const start = Date.now();
    const req = https.request({host: serverConfig.ipv4, port:443, servername:name, method:'HEAD', path:'/', headers:{Host:name, 'User-Agent':'SmartDNS/1.0'}, rejectUnauthorized:true, agent:false, maxHeaderSize:131072, timeout:18000}, res => {
      console.log(JSON.stringify({name, tls:res.socket.authorized, peer:res.socket.remoteAddress, http:res.statusCode, location:res.headers.location, ms:Date.now()-start}));
      res.resume(); res.on('end', resolve);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', error => {console.log(JSON.stringify({name,error:error.message})); process.exitCode=1; resolve();});
    req.end();
  });
}
