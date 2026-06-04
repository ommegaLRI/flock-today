import { safeParseMigrationBootstrap, type MigrationBootstrap } from "@stitch/contract";
import { compileProjectToExportArtifact, createStitchProjectFromBootstrap, type ProjectInstallOptions } from "@stitch/compiler";

export type StitchJob = "migrate" | "capture" | "generate" | "validate" | "publish" | "adopt" | "import";

export type CliPlan = {
  job: StitchJob;
  description: string;
  nextSteps: string[];
};

export type MigrationBootstrapImportOptions = ProjectInstallOptions & {
  exportProduction?: boolean;
};

export type MigrationBootstrapImportResult = {
  status: "ready" | "needsReview" | "blocked";
  bootstrap: MigrationBootstrap;
  project?: ReturnType<typeof createStitchProjectFromBootstrap>;
  productionExport?: ReturnType<typeof compileProjectToExportArtifact>;
  warnings: string[];
  nextSteps: string[];
};

export function createCliPlan(args: string[]): CliPlan {
  const job = inferJob(args);
  return {
    job,
    description: describeJob(job),
    nextSteps: nextStepsForJob(job),
  };
}

export function createMigrationBootstrapImportPlan(input: unknown, options: MigrationBootstrapImportOptions = {}): MigrationBootstrapImportResult {
  const parsed = safeParseMigrationBootstrap(input);
  if (!parsed.ok) {
    return {
      status: "blocked",
      bootstrap: input as MigrationBootstrap,
      warnings: parsed.validation.warnings,
      nextSteps: ["Fix the migration endpoint output or re-run migration before importing."],
    };
  }

  const { bootstrap, validation } = parsed;

  const project = createStitchProjectFromBootstrap(bootstrap, {
    ...options,
    buildProfile: options.buildProfile ?? "owner",
  });
  const productionExport = options.exportProduction
    ? compileProjectToExportArtifact(project, "production")
    : undefined;
  const warnings = [...validation.warnings, ...project.installPlan.warnings.filter((warning) => warning.severity !== "info").map((warning) => warning.message)];

  return {
    status: validation.status === "needsReview" || warnings.length > 0 ? "needsReview" : "ready",
    bootstrap,
    project,
    ...(productionExport ? { productionExport } : {}),
    warnings,
    nextSteps: [
      "Open the owner workbench and inspect migration warnings.",
      "Generate a review build for comment-only feedback if needed.",
      "Generate a production export only after owner review passes.",
    ],
  };
}

function inferJob(args: string[]): StitchJob {
  const [first] = args;
  if (first === "capture") return "capture";
  if (first === "generate") return "generate";
  if (first === "validate") return "validate";
  if (first === "publish") return "publish";
  if (first === "adopt") return "adopt";
  if (first === "import") return "import";
  return "migrate";
}

function describeJob(job: StitchJob): string {
  switch (job) {
    case "capture": return "Capture page evidence into a PageCapture file.";
    case "generate": return "Compile an existing CampaignPageSpec into a React campaign bundle.";
    case "validate": return "Validate contract, spec, pins, and safety policies.";
    case "publish": return "Publish a generated site to a user-owned deployment target.";
    case "adopt": return "Adopt an existing React site into Stitch review/patch workflows.";
    case "import": return "Import a finalized MigrationBootstrap into a user-owned Stitch project.";
    case "migrate": return "Migrate a simple marketing page into a portable React campaign site.";
  }
}

function nextStepsForJob(job: StitchJob): string[] {
  if (job === "migrate") return ["Call the private migration endpoint", "Receive MigrationBootstrap", "Import into Stitch", "Review/export/deploy"];
  if (job === "import") return ["Validate MigrationBootstrap", "Create StitchProject", "Open owner profile", "Review warnings before production export"];
  if (job === "adopt") return ["Detect framework", "Install review runtime", "Create stitch config", "Keep code patches as fallback"];
  return ["Load inputs", "Run deterministic checks", "Write report"];
}
