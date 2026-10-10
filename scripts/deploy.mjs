import { spawn } from 'node:child_process';

const env = { ...process.env };
if (!env.CLOUDFLARE_API_TOKEN && env.CF_API_TOKEN) {
  env.CLOUDFLARE_API_TOKEN = env.CF_API_TOKEN;
}
delete env.CF_API_TOKEN;

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(command, ['--no-install', 'wrangler', 'deploy'], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('error', (error) => {
  console.error(`Could not start Wrangler: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
