import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { StitchProject } from '../dist/project.js';

const hash = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flock-'));
  await mkdir(path.join(root, '.stitch', 'visuals', 'sections'), { recursive: true });
  await mkdir(path.join(root, 'src', 'components'), { recursive: true });
  const source = '<section data-section-id="section_01" data-stitch-role="section">Hello</section>\n';
  await writeFile(path.join(root, 'src', 'components', 'Section.astro'), source);
  await writeFile(path.join(root, '.stitch', 'manifest.json'), JSON.stringify({
    projectId: 'project_1',
    target: { framework: 'astro', rendererTarget: 'astroStatic.v0' },
    source: { contractHash: 'contract', runHash: 'run' },
    files: [{ path: 'src/components/Section.astro', hash: hash(source) }],
  }));
  await writeFile(path.join(root, '.stitch', 'contract.json'), JSON.stringify({
    version: '0.3.0', project: { name: 'Fixture' }, origin: { sourceUrl: 'https://example.com' },
    pages: [{ route: '/', sections: [{ id: 'section_01', label: 'Hero', intent: 'intro' }] }],
    facts: { items: [{ id: 'fact_1', sectionId: 'section_01' }], occurrences: [] },
    designSystem: { tokens: {}, recipes: { items: [] } },
  }));
  await writeFile(path.join(root, '.stitch', 'run.json'), JSON.stringify({ status: 'passed', projection: { status: 'passed' }, publication: { status: 'ready' } }));
  await writeFile(path.join(root, '.stitch', 'provenance.json'), JSON.stringify({ review: { items: [] } }));
  await writeFile(path.join(root, '.stitch', 'visuals', 'sections.json'), JSON.stringify({ sections: [] }));
  return { root, source };
}

test('scans Stitch sections, builds context, replaces safely, and reverts', async () => {
  const { root, source } = await fixture();
  const project = await StitchProject.open(root);
  const original = await project.summary(false);
  assert.equal(original.sections.length, 1);
  assert.equal(original.sections[0].modified, false);

  const context = await project.context('section_01');
  assert.equal(context.section.label, 'Hero');
  assert.equal(context.facts.length, 1);

  const changed = '<section data-section-id="section_01" data-stitch-role="section">Changed</section>';
  const changedSummary = await project.replaceSection('section_01', changed);
  assert.equal(changedSummary.modified, true);
  assert.match(await readFile(path.join(root, changedSummary.file), 'utf8'), /Changed/);

  const reverted = await project.revertSection('section_01');
  assert.equal(reverted.modified, false);
  assert.equal(await readFile(path.join(root, reverted.file), 'utf8'), source);
});

test('rejects output that changes the Stitch section identity', async () => {
  const { root } = await fixture();
  const project = await StitchProject.open(root);
  await assert.rejects(
    project.replaceSection('section_01', '<section data-section-id="section_02" data-stitch-role="section"></section>'),
    /must retain data-section-id/,
  );
});
