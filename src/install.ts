import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StitchProject } from './project.js';

const IMPORT_LINE = `import flock from '@flock/capsule';`;
const CONFIG_FILES = ['astro.config.mjs', 'astro.config.mts', 'astro.config.js', 'astro.config.ts'];

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function patchAstroConfig(source: string): string {
  let next = source;
  if (!next.includes(`from '@flock/capsule'`) && !next.includes(`from "@flock/capsule"`)) {
    const imports = [...next.matchAll(/^import[^\n]*\n/gm)];
    const insertAt = imports.length > 0
      ? (imports.at(-1)?.index ?? 0) + (imports.at(-1)?.[0].length ?? 0)
      : 0;
    next = `${next.slice(0, insertAt)}${IMPORT_LINE}\n${next.slice(insertAt)}`;
  }

  if (/\bintegrations\s*:\s*\[[\s\S]*?\bflock\s*\(/m.test(next)) return next;

  const integrations = /\bintegrations\s*:\s*\[/m.exec(next);
  if (integrations?.index !== undefined) {
    const bracket = next.indexOf('[', integrations.index);
    return `${next.slice(0, bracket + 1)}flock(), ${next.slice(bracket + 1)}`;
  }

  const defineConfig = /defineConfig\s*\(\s*\{/m.exec(next);
  if (!defineConfig?.index && defineConfig?.index !== 0) {
    throw new Error('Unsupported Astro config shape. Expected defineConfig({ ... }).');
  }
  const openingBrace = next.indexOf('{', defineConfig.index);
  return `${next.slice(0, openingBrace + 1)}\n  integrations: [flock()],${next.slice(openingBrace + 1)}`;
}

export async function installFlock(root = process.cwd()): Promise<{ configPath: string; changed: boolean }> {
  const projectRoot = path.resolve(root);
  const configName = (await Promise.all(CONFIG_FILES.map(async (name) => ({ name, present: await exists(path.join(projectRoot, name)) }))))
    .find((entry) => entry.present)?.name;
  if (!configName) throw new Error('Could not find an Astro config file.');
  await StitchProject.open(projectRoot);

  const configPath = path.join(projectRoot, configName);
  const source = await readFile(configPath, 'utf8');
  const patched = patchAstroConfig(source);
  const changed = patched !== source;
  if (changed) await writeFile(configPath, patched, 'utf8');
  return { configPath, changed };
}
