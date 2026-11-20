import {spawnSync} from 'node:child_process';

// Cloudflare Workers Builds provides its own deployment credentials.
// The Worker uses an existing secret keypair or its stable private D1 keypair.
// Never create or rotate a keypair during a routine deployment.
const wrangler = args => spawnSync('npx', ['--yes', 'wrangler@4.165.0', ...args], {encoding:'utf8', stdio:['ignore','pipe','pipe']});
const run = args => {
  const result = wrangler(args);
  if(result.status !== 0) {
    console.error('Worker deployment command failed:', args.join(' '));
    process.exit(1);
  }
  return result.stdout;
};

const existing = JSON.parse(run(['secret','list','--format','json']));
if(!Array.isArray(existing)) throw new Error('Could not verify existing Worker secret names');
const names = new Set(existing.map(secret => secret.name));
const required = ['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'];
const count = required.filter(name => names.has(name)).length;
if(count !== 0 && count !== required.length) throw new Error('Incomplete existing VAPID configuration; repair manually without rotating keys');
run(['deploy']);
console.log('Worker deployed; existing signing keys preserved.');
