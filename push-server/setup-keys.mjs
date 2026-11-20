import {createECDH} from 'node:crypto';
import {spawnSync} from 'node:child_process';
// Run once per deployed Worker, after authentication. Rotating VAPID invalidates subscriptions.
if(!process.argv.includes('--create-new-keypair')){
  console.error('Run with --create-new-keypair only for a new Worker. Rotating VAPID will invalidate existing device subscriptions.');
  process.exit(1);
}
const ecdh=createECDH('prime256v1');
ecdh.generateKeys();
const values={
  VAPID_PUBLIC_KEY:ecdh.getPublicKey().toString('base64url'),
  VAPID_PRIVATE_KEY:ecdh.getPrivateKey().toString('base64url'),
  VAPID_SUBJECT:'https://fwadh486-lab.github.io/kora-.zool/'
};
for(const [name,value] of Object.entries(values)){
  const result=spawnSync('npx',['--yes','wrangler@4.165.0','secret','put',name],{input:value,encoding:'utf8',stdio:['pipe','inherit','inherit']});
  if(result.status!==0){console.error('Failed to configure '+name+'; finish setup before connecting the PWA.');process.exit(1)}
}
console.log('VAPID secrets configured. Neither private key nor sports API key belongs in GitHub.');
