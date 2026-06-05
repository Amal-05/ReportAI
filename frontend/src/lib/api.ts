import type { CompileResult, Report, ResearchAssistRequest, ResearchAssistResponse } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://reportai-ytsn.onrender.com/api/v1";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("reportai_token") : null;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const customKey = typeof window !== "undefined" ? window.localStorage.getItem("reportai_custom_api_key") : null;
  if (customKey) {
    headers.set("X-OpenAI-API-Key", customKey);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function createReport(projectId: string): Promise<Report> {
  return api(`/reports/project/${projectId}/latex`, { method: "POST" });
}

export async function compileReport(reportId: string): Promise<CompileResult> {
  return api(`/reports/${reportId}/compile`, { method: "POST" });
}

export async function compileRawReport(latexSource: string, referencesBib?: string): Promise<CompileResult> {
  return api("/reports/compile-raw", {
    method: "POST",
    body: JSON.stringify({ latex_source: latexSource, references_bib: referencesBib }),
  });
}

export async function applyFix(reportId: string, sectionId: string, oldFragment: string, newFragment: string): Promise<{ ok: boolean }> {
  return api(`/reports/${reportId}/fix`, {
    method: "POST",
    body: JSON.stringify({ section_id: sectionId, old_fragment: oldFragment, new_fragment: newFragment }),
  });
}

export async function researchAssist(payload: ResearchAssistRequest): Promise<ResearchAssistResponse> {
  return api("/generation/assist", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getPdfUrl(pdfStorageKey: string): string {
  return `${API_URL}/reports/pdf/${pdfStorageKey}`;
}

