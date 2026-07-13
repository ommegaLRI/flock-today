#!/usr/bin/env node
import path from 'node:path';
import { installFlock } from './install.js';

const [, , command = 'help', target = '.'] = process.argv;

if (command === 'install') {
  try {
    const result = await installFlock(path.resolve(target));
    console.log(result.changed
      ? `Flock installed in ${result.configPath}`
      : `Flock is already installed in ${result.configPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  console.log(`Flock\n\nUsage:\n  flock install [project-directory]\n`);
}
