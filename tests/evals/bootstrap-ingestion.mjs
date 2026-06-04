import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { parseMigrationBootstrap, validateMigrationBootstrap } from "@stitch/contract";
import { compileProjectToExportArtifact, createStitchProjectFromBootstrap } from "@stitch/compiler";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../fixtures/migration-bootstrap.v0.1.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const bootstrap = parseMigrationBootstrap(fixture);
const validation = validateMigrationBootstrap(bootstrap);
assert.equal(validation.status, "accepted", validation.warnings.join("; "));

const project = createStitchProjectFromBootstrap(bootstrap, { buildProfile: "owner" });
assert.equal(project.state.spec.sections.length, 3);
assert.ok(project.bundle.files.some((file) => file.path === "stitch/migration.bootstrap.json"));

const production = compileProjectToExportArtifact(project, "production");
const paths = production.files.map((file) => file.path);
assert.equal(paths.some((path) => path.includes("/_stitch") || path.includes("public/_stitch")), false);
assert.equal(paths.some((path) => path.endsWith("project.state.json")), false);
assert.equal(paths.some((path) => path.endsWith("events.json")), false);
assert.equal(paths.some((path) => path.endsWith("migration.bootstrap.json")), false);
assert.equal(production.validation.status === "blocked", false);

console.log("bootstrap ingestion eval passed", {
  projectId: project.id,
  sections: project.state.spec.sections.length,
  productionFiles: production.files.length
});
