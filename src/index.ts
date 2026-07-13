import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { StitchProject } from './project.js';
import { installFlockMiddleware } from './server.js';
import type { FlockOptions } from './types.js';

export type {
  FlockOptions,
  FlockProjectSummary,
  FlockSectionContext,
  FlockSectionSummary,
  GenerateSection,
  GenerateSectionInput,
} from './types.js';
export { StitchProject } from './project.js';

export default function flock(options: FlockOptions = {}): AstroIntegration {
  let astroRoot = process.cwd();

  return {
    name: '@flock/capsule',
    hooks: {
      'astro:config:setup': ({ command, injectScript }) => {
        if (command === 'dev') {
          injectScript('page', `import '@flock/capsule/client';`);
        }
      },
      'astro:config:done': ({ config }) => {
        astroRoot = fileURLToPath(config.root);
      },
      'astro:server:setup': async ({ server, logger }) => {
        const root = path.resolve(options.root ?? server.config.root ?? astroRoot);
        const project = await StitchProject.open(root);
        installFlockMiddleware(server, project, options.generateSection);
        logger.info(`Owner capsule active for ${root}`);
      },
    },
  };
}
