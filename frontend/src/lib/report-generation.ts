import type { Project, QualityScore } from "@/lib/types";
import type { Question } from "./questionnaire";
import { getOpenAiApiKey } from "@/lib/utils";
import { generateLatex } from "./pdf-generator";
import type { Project } from "./types";
import type { Question } from "./questionnaire";

// Re-export so existing imports still work
export { generateLatex };

export const reportSections = [
  "Introduction",
  "System Study",
  "System Requirements",
  "System Design",
  "Implementation",
  "Testing",
  "Results",
  "Conclusion",
  "Future Scope",
];

export function isNilAnswer(value: string): boolean {
  const clean = value.trim().toLowerCase();
  return ["", "nil", "none", "nothing", "n/a", "na", "not applicable",
    "null", "no", "none.", "nil."].includes(clean);
}

// ── AI answer enhancer ────────────────────────────────────────────────────────

export async function enhanceAnswersWithAI(
  answers: Record<string, string>,
  questions: Question[],
  project: Project
): Promise<Record<string, string>> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://reportai-ytsn.onrender.com/api/v1";
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = getOpenAiApiKey();
    if (apiKey) headers["X-OpenAI-API-Key"] = apiKey;

    const res = await fetch(`${API_URL}/generation/enhance-answers-public`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: { title: project.title, domain: project.domain, description: project.description },
        answers,
        questions: questions.map((q) => ({ id: q.id, label: q.label, type: q.type })),
      }),
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Error enhancing answers:", err);
    return Object.fromEntries(
      Object.entries(answers).map(([k, v]) => [k, isNilAnswer(v) ? "" : v])
    );
  }
}

// ── AI LaTeX generator ────────────────────────────────────────────────────────

export async function generateLatexWithAI(
  project: Project,
  answers: Record<string, string>,
  questions: Question[],
  templateProfile?: { chapters?: string[]; citation?: string; font?: string; spacing?: string }
): Promise<string> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://reportai-ytsn.onrender.com/api/v1";
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = getOpenAiApiKey();
    if (apiKey) headers["X-OpenAI-API-Key"] = apiKey;

    // Strip invalid chapter lists before sending to backend
    const safeProfile = templateProfile ? {
      ...templateProfile,
      // Only send chapters if they look like real academic chapter names
      // (backend also validates, but belt-and-suspenders)
      chapters: templateProfile.chapters?.every(
        (c) => c.length <= 40 && !/^\d/.test(c)
      ) ? templateProfile.chapters : undefined,
    } : undefined;

    const res = await fetch(`${API_URL}/generation/generate-report-public`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: { title: project.title, domain: project.domain, description: project.description },
        answers,
        questions: questions.map((q) => ({ id: q.id, label: q.label, type: q.type })),
        templateProfile: safeProfile,
      }),
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    return data.latex;
  } catch (err) {
    console.error("Error generating LaTeX with AI, using static fallback:", err);
    // Static fallback now lives in pdf-generator.ts and is chapter-aware
    return generateLatex(
      { title: project.title, domain: project.domain, description: project.description },
      answers,
      templateProfile?.chapters,
    );
  }
}

// ── Quality analyser ──────────────────────────────────────────────────────────

export function analyzeQuality(latex: string, referenceCount: number): QualityScore {
  const wordCount = latex.split(/\s+/).filter(Boolean).length;
  const technicalDepth = Math.min(95, Math.max(45, Math.round(wordCount / 25)));
  const citationQuality = referenceCount > 0 ? 86 : 45;
  const formattingQuality = latex.includes("\\chapter") && latex.includes("\\tableofcontents") ? 90 : 58;
  const grammar = 84;
  const readability = 82;
  const overall = Math.round((technicalDepth + citationQuality + formattingQuality + grammar + readability) / 5);

  const suggestions: string[] = [];
  if (wordCount < 2500) suggestions.push("Expand methodology, testing, implementation, and result analysis sections.");
  if (referenceCount === 0) suggestions.push("Add academic references and cite them inside chapters.");
  if (!latex.includes("\\includegraphics")) suggestions.push("Add UML, flowchart, architecture, or result diagrams.");

  return {
    grammar, readability, technical_depth: technicalDepth,
    formatting_quality: formattingQuality, citation_quality: citationQuality,
    overall, suggestions
  };
}


export async function generateAnswersWithAI(
  answers: Record<string, string>,
  questions: Question[],
  project: Project,
): Promise<Record<string, string>> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://reportai-ytsn.onrender.com/api/v1";
  const token = typeof window !== "undefined" ? window.localStorage.getItem("reportai_token") : null;
  const customKey = typeof window !== "undefined" ? window.localStorage.getItem("reportai_custom_api_key") : null;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (customKey) headers["X-OpenAI-API-Key"] = customKey;

  const res = await fetch(`${API_URL}/generation/generate-answers-public`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      project: { title: project.title, domain: project.domain, description: project.description },
      answers,
      questions,
    }),
  });

  if (!res.ok) throw new Error(`Generate answers failed: ${res.status}`);
  const data = await res.json();
  return data.answers as Record<string, string>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://reportai-ytsn.onrender.com/api/v1";


function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = typeof window !== "undefined" ? window.localStorage.getItem("reportai_token") : null;
  const customKey = typeof window !== "undefined" ? window.localStorage.getItem("reportai_custom_api_key") : null;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (customKey) headers["X-OpenAI-API-Key"] = customKey;
  return headers;
}

// ── Polish LaTeX ──────────────────────────────────────────────────────────────

/**
 * Sends the current LaTeX source to the backend AI polish endpoint.
 * The backend:
 *   1. Removes placeholder text (lorem ipsum, [Answer for:], etc.)
 *   2. Fixes broken tables and figure references
 *   3. Normalises spacing and formatting inconsistencies
 *   4. Returns cleaned LaTeX source
 */
export async function polishLatexWithAI(
  latexSource: string,
  project: Project
): Promise<string> {
  const res = await fetch(`${API_URL}/generation/polish-latex`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      latex_source: latexSource,
      project: {
        title: project.title,
        domain: project.domain,
        description: project.description,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Polish failed with status ${res.status}`);
  }

  const data = await res.json();
  return (data.latex_source as string) || latexSource;
}

