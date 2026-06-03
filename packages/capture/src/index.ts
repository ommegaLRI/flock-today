import type {
  BrandExtraction,
  CapturedElement,
  CapturedElementKind,
  CapturedNode,
  CapturedSection,
  ContentStrategyExtraction,
  PageCapture,
  SectionCandidate,
  SectionType,
  StrategyRole,
  Viewport,
} from "@stitch/contract";

export type HtmlCaptureOptions = {
  url: string;
  title?: string;
  viewport?: Partial<Viewport>;
};

type ParsedTag = {
  tag: string;
  attrs: string;
  inner: string;
  text: string;
  start: number;
  end: number;
};

const BLOCK_TAGS = new Set(["section", "header", "main", "article", "aside", "footer", "nav", "div"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3"]);
const CTA_PATTERN = /\b(get|start|book|contact|download|try|join|learn|audit|demo|sign up|schedule|buy|request)\b/i;
const QUOTE_PATTERN = /[“”"]|testimonial|customer|client|trusted|loved|results|case study/i;
const QUESTION_PATTERN = /\?|how |what |why |when |where |can |does /i;

export function captureFromHtml(html: string, options: HtmlCaptureOptions): PageCapture {
  return createPageCaptureFromHtml(html, options);
}

export function createPageCaptureFromHtml(html: string, options: HtmlCaptureOptions): PageCapture {
  const parsed = parseTags(html);
  const visibleText = extractVisibleText(html);
  const dom = createCapturedNodes(parsed);
  const sections = extractSectionCandidates(html, parsed);
  const brandExtraction = extractBrandHints(html);
  const contentStrategyExtraction = extractContentStrategyHints(visibleText, sections);
  const sectionCandidates = classifySectionCandidates(sections);
  const viewport: Viewport = {
    width: options.viewport?.width ?? 1440,
    height: options.viewport?.height ?? 900,
    label: options.viewport?.label ?? "desktop",
  };
  if (options.viewport?.deviceScaleFactor !== undefined) viewport.deviceScaleFactor = options.viewport.deviceScaleFactor;

  const capture: PageCapture = {
    url: options.url,
    viewport,
    capturedAt: new Date().toISOString(),
    dom,
    visibleText,
    sections,
    sectionCandidates,
    brandExtraction,
    contentStrategyExtraction,
    assets: [
      ...extractImages(html).map((image) => ({ url: image.src, type: "image" as const, ...(image.alt ? { alt: image.alt } : {}) })),
      ...extractStylesheets(html).map((url) => ({ url, type: "style" as const })),
    ],
    styles: {
      colors: brandExtraction.colors,
      fonts: brandExtraction.fonts,
      classNames: brandExtraction.classNames,
    },
    detected: {
      forms: extractForms(html),
      analytics: detectAnalyticsHints(html),
    },
    privacy: {
      cookiesCaptured: false,
      localStorageCaptured: false,
      formValuesCaptured: false,
      networkBodiesCaptured: false,
    },
  };

  if (options.title) capture.title = options.title;
  return capture;
}

export function extractVisibleText(html: string): string[] {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ");
  const texts: string[] = [];
  for (const match of withoutNoise.matchAll(/>([^<>]{2,})</g)) {
    const text = cleanText(match[1] ?? "");
    if (text && !isBoilerplateText(text)) texts.push(decodeEntities(text));
  }
  return unique(texts).slice(0, 120);
}

export function extractHeadings(html: string): Array<{ level: 1 | 2 | 3; text: string }> {
  const headings: Array<{ level: 1 | 2 | 3; text: string }> = [];
  for (const match of html.matchAll(/<h([123])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const level = Number(match[1]) as 1 | 2 | 3;
    const text = cleanText(match[2] ?? "");
    if (text) headings.push({ level, text: decodeEntities(text) });
  }
  return headings;
}

export function extractLinks(html: string): Array<{ label: string; href: string }> {
  const links: Array<{ label: string; href: string }> = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(match[1] ?? "", "href");
    const label = cleanText(match[2] ?? "");
    if (href && label) links.push({ href, label: decodeEntities(label) });
  }
  return links;
}

export function extractImages(html: string): Array<{ src: string; alt?: string }> {
  const images: Array<{ src: string; alt?: string }> = [];
  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const src = attr(attrs, "src");
    if (!src) continue;
    const alt = attr(attrs, "alt");
    images.push(alt ? { src, alt: decodeEntities(alt) } : { src });
  }
  return images;
}

export function extractForms(html: string): Array<{ provider: string; action?: string; method?: string }> {
  const forms: Array<{ provider: string; action?: string; method?: string }> = [];
  for (const match of html.matchAll(/<form\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const action = attr(attrs, "action");
    const method = attr(attrs, "method");
    const provider = action ? inferFormProvider(action) : "html";
    const form: { provider: string; action?: string; method?: string } = { provider };
    if (action) form.action = action;
    if (method) form.method = method.toLowerCase();
    forms.push(form);
  }
  return forms;
}

export function extractSectionCandidates(html: string, parsed: ParsedTag[] = parseTags(html)): CapturedSection[] {
  const blockTags = parsed.filter((tag) => BLOCK_TAGS.has(tag.tag) && cleanText(tag.inner).length > 20);
  const candidates = blockTags.length > 0 ? blockTags : parsed.filter((tag) => HEADING_TAGS.has(tag.tag));
  const sections: CapturedSection[] = [];
  let index = 0;

  for (const tag of candidates.slice(0, 20)) {
    const text = extractVisibleText(tag.inner).slice(0, 12);
    if (text.length === 0) continue;
    const elements = extractElementsFromFragment(tag.inner, `section-${index}`);
    const links = extractLinks(tag.inner);
    const images = extractImages(tag.inner);
    const heading = findFirstHeading(tag.inner) ?? text[0];
    const section: CapturedSection = {
      id: `captured-section-${index}`,
      index,
      domPath: `${tag.tag}:nth-of-type(${index + 1})`,
      text,
      links,
      images,
      elements,
      hints: {
        hasCta: links.some((link) => CTA_PATTERN.test(link.label)) || text.some((value) => CTA_PATTERN.test(value)),
        hasCards: elements.filter((element) => element.kind === "heading").length >= 2 || text.length >= 4,
        hasQuote: text.some((value) => QUOTE_PATTERN.test(value)),
        hasQuestions: text.some((value) => QUESTION_PATTERN.test(value)),
        hasForm: /<form\b/i.test(tag.inner),
      },
    };
    if (heading) section.heading = decodeEntities(heading);
    sections.push(section);
    index += 1;
  }

  return dedupeSections(sections);
}

export function extractBrandHints(html: string): BrandExtraction {
  const classNames = extractClassNames(html);
  const colors = unique([
    ...Array.from(html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)).map((match) => match[0]),
    ...Array.from(html.matchAll(/rgba?\([^)]*\)/gi)).map((match) => match[0]),
  ]).slice(0, 12);
  const fonts = unique([
    ...Array.from(html.matchAll(/font-family\s*:\s*([^;"'}]+)/gi)).map((match) => cleanFontName(match[1] ?? "")),
    ...Array.from(html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi)).map((match) => decodeURIComponent((match[1] ?? "").replace(/\+/g, " "))),
  ]).filter(Boolean).slice(0, 6);
  const warnings = colors.length === 0 ? ["No explicit color tokens found; default brand colors will be used."] : [];
  return {
    colors,
    fonts,
    classNames,
    confidence: Number((0.35 + Math.min(0.4, colors.length / 10) + Math.min(0.25, fonts.length / 4)).toFixed(2)),
    warnings,
  };
}

export function detectAnalyticsHints(html: string): Array<{ provider: string; id?: string }> {
  const found: Array<{ provider: string; id?: string }> = [];
  const gaMatch = html.match(/G-[A-Z0-9]+/i);
  if (/googletagmanager|gtag\(|google-analytics/i.test(html)) found.push(gaMatch?.[0] ? { provider: "ga4", id: gaMatch[0] } : { provider: "ga4" });
  if (/plausible\.io/i.test(html)) found.push({ provider: "plausible" });
  if (/posthog/i.test(html)) found.push({ provider: "posthog" });
  if (/connect\.facebook\.net|fbq\(/i.test(html)) found.push({ provider: "meta" });
  if (/snap\.licdn\.com|linkedin_partner_id/i.test(html)) found.push({ provider: "linkedin" });
  return found;
}

export function summarizeCapture(capture: PageCapture): string {
  return `Captured ${capture.visibleText.length} text nodes, ${capture.sections?.length ?? 0} section candidates, ${capture.assets.length} assets, ${capture.detected.forms.length} forms, and ${capture.detected.analytics.length} analytics hints from ${capture.url}.`;
}

export function sanitizeCapture(capture: PageCapture): PageCapture {
  const sanitized: PageCapture = {
    ...capture,
    visibleText: capture.visibleText.map((text) => text.slice(0, 500)),
    dom: capture.dom.map((node) => ({ ...node, ...(node.text ? { text: node.text.slice(0, 500) } : {}) })),
    privacy: {
      cookiesCaptured: false,
      localStorageCaptured: false,
      formValuesCaptured: false,
      networkBodiesCaptured: false,
    },
  };
  if (capture.sections) {
    sanitized.sections = capture.sections.map((section) => ({
      ...section,
      text: section.text.map((text) => text.slice(0, 500)),
      elements: section.elements.map((element) => ({ ...element, ...(element.text ? { text: element.text.slice(0, 500) } : {}) })),
    }));
  }
  return sanitized;
}

function parseTags(html: string): ParsedTag[] {
  const tags: ParsedTag[] = [];
  for (const match of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const tag = (match[1] ?? "div").toLowerCase();
    if (["script", "style", "svg", "path"].includes(tag)) continue;
    const inner = match[3] ?? "";
    const text = cleanText(inner);
    if (!text && tag !== "form") continue;
    tags.push({ tag, attrs: match[2] ?? "", inner, text: decodeEntities(text), start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return tags;
}

function createCapturedNodes(parsed: ParsedTag[]): CapturedNode[] {
  return parsed
    .filter((tag) => tag.text.length > 0 || tag.tag === "img" || tag.tag === "a")
    .slice(0, 200)
    .map((tag, index) => {
      const href = attr(tag.attrs, "href");
      const src = attr(tag.attrs, "src");
      const alt = attr(tag.attrs, "alt");
      const className = attr(tag.attrs, "class");
      const node: CapturedNode = {
        id: `node-${index}`,
        tag: tag.tag,
        domPath: `${tag.tag}:nth-match(${index + 1})`,
      };
      if (tag.text) node.text = tag.text.slice(0, 500);
      if (href) node.href = href;
      if (src) node.src = src;
      if (alt) node.alt = decodeEntities(alt);
      if (className) node.className = className;
      return node;
    });
}

function extractElementsFromFragment(html: string, prefix: string): CapturedElement[] {
  const elements: CapturedElement[] = [];
  let index = 0;
  for (const tag of parseTags(html).slice(0, 60)) {
    const kind = inferElementKind(tag.tag, tag.attrs, tag.text);
    const href = attr(tag.attrs, "href");
    const src = attr(tag.attrs, "src");
    const alt = attr(tag.attrs, "alt");
    const className = attr(tag.attrs, "class");
    const element: CapturedElement = {
      id: `${prefix}-element-${index++}`,
      kind,
      tag: tag.tag,
      domPath: `${tag.tag}:nth-match(${index})`,
    };
    if (tag.text) element.text = tag.text.slice(0, 500);
    if (href) element.href = href;
    if (src) element.src = src;
    if (alt) element.alt = decodeEntities(alt);
    if (className) element.className = className;
    elements.push(element);
  }
  return elements;
}

function classifySectionCandidates(sections: CapturedSection[]): SectionCandidate[] {
  return sections.map((section, index) => {
    const candidate = classifyCapturedSection(section, index, sections.length);
    return candidate;
  });
}

function classifyCapturedSection(section: CapturedSection, index: number, total: number): SectionCandidate {
  if (index === 0) return makeCandidate(section, "Hero", 0.86, "First substantial section with campaign headline/CTA context.", ["audience", "promise", "cta"]);
  if (section.hints.hasQuestions) return makeCandidate(section, "FAQ", 0.76, "Question-like copy detected.", ["objection", "trust"]);
  if (section.hints.hasQuote) return makeCandidate(section, "Testimonials", 0.72, "Quote/proof language detected.", ["proof", "trust"]);
  if (section.images.length >= 3 && section.text.length <= 6) return makeCandidate(section, "LogoCloud", 0.68, "Repeated images with limited text look like logos/proof.", ["trust", "proof"]);
  if (section.hints.hasCards) return makeCandidate(section, index <= 2 ? "Benefits" : "FeatureGrid", 0.64, "Repeated headings/text suggest card-style benefits or features.", ["benefit", "outcome", "differentiator"]);
  if (section.hints.hasCta || index === total - 1) return makeCandidate(section, "FinalCTA", 0.62, "CTA language or final section position detected.", ["promise", "cta", "riskReversal"]);
  return makeCandidate(section, "Custom", 0.42, "Section was captured but did not match a canonical recipe confidently.", []);
}

function makeCandidate(section: CapturedSection, type: SectionType, confidence: number, reason: string, strategyRoles: StrategyRole[]): SectionCandidate {
  const candidate: SectionCandidate = {
    id: `candidate-${section.id}`,
    capturedSectionId: section.id,
    type,
    confidence,
    reason,
    strategyRoles,
    sourceText: section.text.slice(0, 8),
  };
  return candidate;
}

function extractContentStrategyHints(visibleText: string[], sections: CapturedSection[]): ContentStrategyExtraction {
  const ctaHints = unique([...visibleText, ...sections.flatMap((section) => section.links.map((link) => link.label))].filter((text) => CTA_PATTERN.test(text))).slice(0, 6);
  const proofHints = unique(visibleText.filter((text) => QUOTE_PATTERN.test(text))).slice(0, 6);
  const offerHints = visibleText.slice(0, 5);
  const audienceHints = visibleText.filter((text) => /for\s+[a-z0-9\s-]+|teams|agencies|founders|marketers|developers/i.test(text)).slice(0, 4);
  return {
    goal: ctaHints.some((text) => /book|demo|audit|contact|schedule/i.test(text)) ? "bookCall" : "lead",
    audienceHints,
    offerHints,
    ctaHints,
    proofHints,
    confidence: Number((0.4 + Math.min(0.25, ctaHints.length / 8) + Math.min(0.2, offerHints.length / 8) + Math.min(0.15, proofHints.length / 8)).toFixed(2)),
  };
}

function extractClassNames(html: string): string[] {
  const classNames: string[] = [];
  for (const match of html.matchAll(/\bclass=["']([^"']+)["']/gi)) {
    classNames.push(...(match[1] ?? "").split(/\s+/));
  }
  return unique(classNames).slice(0, 200);
}

function extractStylesheets(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/<link\b([^>]*rel=["']stylesheet["'][^>]*)>/gi)) {
    const href = attr(match[1] ?? "", "href");
    if (href) urls.push(href);
  }
  return unique(urls);
}

function findFirstHeading(html: string): string | undefined {
  const heading = extractHeadings(html)[0];
  return heading?.text;
}

function inferElementKind(tag: string, attrs: string, text: string): CapturedElementKind {
  if (HEADING_TAGS.has(tag)) return "heading";
  if (tag === "a" && (CTA_PATTERN.test(text) || /button|btn|cta/i.test(attrs))) return "button";
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "img") return "image";
  if (tag === "form") return "form";
  if (tag === "li") return "listItem";
  if (text) return "text";
  return "unknown";
}

function inferFormProvider(action: string): string {
  if (/hubspot/i.test(action)) return "hubspot";
  if (/typeform/i.test(action)) return "typeform";
  if (/formspree/i.test(action)) return "formspree";
  if (/netlify/i.test(action)) return "netlify";
  return "html";
}

function attr(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}=["']([^"']+)["']`, "i");
  const value = attrs.match(pattern)?.[1]?.trim();
  return value ? decodeEntities(value) : undefined;
}

function cleanText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanFontName(value: string): string {
  return value.split(",")[0]?.replace(/["']/g, "").trim() ?? "";
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isBoilerplateText(text: string): boolean {
  return /^(skip to content|menu|close|open|toggle navigation)$/i.test(text.trim());
}

function dedupeSections(sections: CapturedSection[]): CapturedSection[] {
  const seen = new Set<string>();
  return sections.filter((section) => {
    const key = section.text.join("|").slice(0, 200);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
