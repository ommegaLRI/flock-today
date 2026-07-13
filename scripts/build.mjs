import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });

await new Promise((resolve, reject) => {
  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc'], {
    cwd: new URL('..', import.meta.url),
    stdio: 'inherit',
  });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`tsc exited with ${code}`)));
});
