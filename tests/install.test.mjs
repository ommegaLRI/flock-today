import assert from 'node:assert/strict';
import test from 'node:test';
import { patchAstroConfig } from '../dist/install.js';

test('patches the Stitch Astro config and remains idempotent', () => {
  const source = `import { defineConfig } from 'astro/config';\nimport tailwindcss from '@tailwindcss/vite';\n\nexport default defineConfig({\n  output: 'static',\n  vite: { plugins: [tailwindcss()] },\n});\n`;
  const first = patchAstroConfig(source);
  const second = patchAstroConfig(first);
  assert.match(first, /import flock from '@flock\/capsule';/);
  assert.match(first, /integrations: \[flock\(\)\]/);
  assert.equal(second, first);
});
