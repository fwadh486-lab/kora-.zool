import {spawnSync} from 'node:child_process';

// Cloudflare Workers Builds provides its own deployment credentials.
// Never print secret values or rotate an existing VAPID keypair.
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
if(count === 0) {
  const setup = spawnSync(process.execPath, ['setup-keys.mjs','--create-new-keypair'], {stdio:'inherit'});
  if(setup.status !== 0) process.exit(1);
}
console.log('Worker deployed; existing VAPID keys preserved or initial keys configured.');
