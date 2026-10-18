import {serverConfig, requireDeploymentConfig} from '../src/render.mjs';
import dns from 'node:dns/promises';
import https from 'node:https';
requireDeploymentConfig();
let failed = false;
for (const name of ['www.wikipedia.org','gemini.google.com','mail.google.com','chatgpt.com','auth.openai.com','api2.cursor.sh','api.anthropic.com','openrouter.ai','grok.com','api.x.ai','example.com']) {
  try {
    const answers = await dns.lookup(name, {all:true});
    const selected = name !== 'example.com';
    const ok = selected ? answers.length > 0 && answers.every(a => a.address === serverConfig.ipv4) : answers.every(a => a.address !== serverConfig.ipv4);
    console.log(JSON.stringify({kind:'system-dns',name,answers,ok}));
    if (!ok) failed = true;
  } catch (error) { console.log(JSON.stringify({name,error:error.message})); failed = true; }
}
for (const name of ['www.wikipedia.org', 'api.openai.com', 'api2.cursor.sh', 'api.anthropic.com', 'openrouter.ai', 'api.x.ai']) {
  await new Promise(resolve => {
    const req = https.request({hostname:name,method:'HEAD',path:'/',rejectUnauthorized:true,agent:false,maxHeaderSize:131072,timeout:15000}, res => {
      const ok = res.socket.authorized && res.socket.remoteAddress === serverConfig.ipv4;
      console.log(JSON.stringify({kind:'system-https',name,peer:res.socket.remoteAddress,tls:res.socket.authorized,http:res.statusCode,ok}));
      if (!ok) failed = true;
      res.resume();res.on('end',resolve);
    });
    req.on('timeout',()=>req.destroy(new Error('timeout')));
    req.on('error', error=>{console.log(JSON.stringify({name,error:error.message}));failed=true;resolve();});req.end();
  });
}
if (failed) process.exitCode=1;
