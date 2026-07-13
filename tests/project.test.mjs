import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { StitchProject } from '../dist/project.js';

const hash = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const visualIntent = {
  goals: ['improve hierarchy'],
  mayChangeContent: false,
  mayChangeLinks: false,
  mayChangeAssets: false,
  mayChangeStructure: true,
};

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flock-'));
  await mkdir(path.join(root, '.stitch', 'visuals', 'sections'), { recursive: true });
  await mkdir(path.join(root, 'src', 'components'), { recursive: true });
  const source = `<section data-section-id="section_01" data-stitch-role="section" class="hero">
  <h1>Hello world</h1>
  <a href="/start"><img src="/hero.jpg" alt="" />Start now</a>
</section>\n`;
  await writeFile(path.join(root, 'src', 'components', 'Section.astro'), source);
  await writeFile(path.join(root, '.stitch', 'manifest.json'), JSON.stringify({
    projectId: 'project_1',
    target: { framework: 'astro', rendererTarget: 'astroStatic.v0' },
    source: { contractHash: 'contract', runHash: 'run' },
    files: [{ path: 'src/components/Section.astro', hash: hash(source) }],
  }));
  await writeFile(path.join(root, '.stitch', 'contract.json'), JSON.stringify({
    version: '0.3.0',
    project: { name: 'Fixture' },
    origin: { sourceUrl: 'https://example.com' },
    pages: [{ route: '/', sections: [{ id: 'section_01', label: 'Hero', intent: 'intro', treatment: { density: 'airy' } }] }],
    facts: { items: [{ id: 'fact_1', sectionId: 'section_01', text: 'Hello world' }], occurrences: [] },
    designSystem: { tokens: { spacing: { section: 'py-24' } }, recipes: { items: [] } },
  }));
  await writeFile(path.join(root, '.stitch', 'run.json'), JSON.stringify({ status: 'passed', projection: { status: 'passed' }, publication: { status: 'ready' } }));
  await writeFile(path.join(root, '.stitch', 'provenance.json'), JSON.stringify({ review: { items: [] } }));
  await writeFile(path.join(root, '.stitch', 'visuals', 'sections.json'), JSON.stringify({ sections: [] }));
  return { root, source };
}

test('compiles a focused section packet', async () => {
  const { root } = await fixture();
  const project = await StitchProject.open(root);
  const packet = await project.packet('section_01');
  assert.equal(packet.section.label, 'Hero');
  assert.equal(packet.section.file, 'src/components/Section.astro');
  assert.equal(packet.facts.length, 1);
  assert.ok(packet.visibleContent.includes('Hello world'));
  assert.ok(packet.links.includes('/start'));
  assert.ok(packet.assets.includes('/hero.jpg'));
  assert.match(packet.section.baseHash, /^sha256:/);
});

test('previews atomically, keeps one baseline across refinements, and reverts', async () => {
  const { root, source } = await fixture();
  const project = await StitchProject.open(root);
  const firstPacket = await project.packet('section_01');
  const firstCandidate = firstPacket.section.source.replace('class="hero"', 'class="hero compact"');
  const first = await project.previewSection('section_01', {
    baseHash: firstPacket.section.baseHash,
    source: firstCandidate,
    intent: visualIntent,
  });
  assert.equal(first.canRevert, true);
  assert.equal(first.modified, true);

  const secondPacket = await project.packet('section_01');
  const secondCandidate = secondPacket.section.source.replace('compact', 'compact polished');
  await project.previewSection('section_01', {
    baseHash: secondPacket.section.baseHash,
    source: secondCandidate,
    intent: visualIntent,
  });
  assert.match(await readFile(path.join(root, secondPacket.section.file), 'utf8'), /polished/);

  const reverted = await project.revertSection('section_01');
  assert.equal(reverted.canRevert, false);
  assert.equal(reverted.modified, false);
  assert.equal(await readFile(path.join(root, reverted.file), 'utf8'), source);
});

test('keep commits the preview to the filesystem session', async () => {
  const { root } = await fixture();
  const project = await StitchProject.open(root);
  const packet = await project.packet('section_01');
  await project.previewSection('section_01', {
    baseHash: packet.section.baseHash,
    source: packet.section.source.replace('class="hero"', 'class="hero dense"'),
    intent: visualIntent,
  });
  const kept = await project.keepSection('section_01');
  assert.equal(kept.canRevert, false);
  await assert.rejects(project.revertSection('section_01'), /No in-session preview/);
});

test('rejects stale, destructive, unsafe, and identity-changing candidates', async () => {
  const { root } = await fixture();
  const project = await StitchProject.open(root);
  const packet = await project.packet('section_01');

  await assert.rejects(
    project.previewSection('section_01', {
      baseHash: 'sha256:stale',
      source: packet.section.source,
      intent: visualIntent,
    }),
    (error) => error.code === 'stale_source' && error.status === 409,
  );

  await assert.rejects(
    project.previewSection('section_01', {
      baseHash: packet.section.baseHash,
      source: packet.section.source.replace('Hello world', 'Gone'),
      intent: visualIntent,
    }),
    (error) => error.code === 'candidate_invalid' && error.failures.some((failure) => failure.includes('Visible content disappeared')),
  );

  await assert.rejects(
    project.previewSection('section_01', {
      baseHash: packet.section.baseHash,
      source: packet.section.source.replace('</section>', '<script src="https://evil.example/x.js"></script></section>'),
      intent: visualIntent,
    }),
    (error) => error.code === 'candidate_invalid' && error.failures.some((failure) => failure.includes('External scripts')),
  );

  await assert.rejects(
    project.previewSection('section_01', {
      baseHash: packet.section.baseHash,
      source: packet.section.source.replace('section_01', 'section_02'),
      intent: visualIntent,
    }),
    (error) => error.code === 'candidate_invalid' && error.failures.some((failure) => failure.includes('data-section-id')),
  );
});
