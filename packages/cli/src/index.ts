export type StitchJob = "migrate" | "capture" | "generate" | "validate" | "publish" | "adopt";

export type CliPlan = {
  job: StitchJob;
  description: string;
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

function inferJob(args: string[]): StitchJob {
  const [first] = args;
  if (first === "capture") return "capture";
  if (first === "generate") return "generate";
  if (first === "validate") return "validate";
  if (first === "publish") return "publish";
  if (first === "adopt") return "adopt";
  return "migrate";
}

function describeJob(job: StitchJob): string {
  switch (job) {
    case "capture": return "Capture page evidence into a PageCapture file.";
    case "generate": return "Compile an existing CampaignPageSpec into a React campaign bundle.";
    case "validate": return "Validate contract, spec, pins, and safety policies.";
    case "publish": return "Publish a generated site to a user-owned deployment target.";
    case "adopt": return "Adopt an existing React site into Stitch review/patch workflows.";
    case "migrate": return "Migrate a simple marketing page into a portable React campaign site.";
  }
}

function nextStepsForJob(job: StitchJob): string[] {
  if (job === "migrate") return ["Capture URL or HTML", "Normalize into the design contract", "Generate React bundle", "Export or publish"];
  if (job === "adopt") return ["Detect framework", "Install review runtime", "Create stitch config", "Keep code patches as fallback"];
  return ["Load inputs", "Run deterministic checks", "Write report"];
}
