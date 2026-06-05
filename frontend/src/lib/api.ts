const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://reportai-ytsn.onrender.com/api/v1";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("reportai_token") : null;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
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

export async function createReport(projectId: string): Promise<any> {
  return api(`/reports/project/${projectId}/latex`, { method: "POST" });
}

export async function compileReport(reportId: string): Promise<any> {
  return api(`/reports/${reportId}/compile`, { method: "POST" });
}

export async function applyFix(reportId: string, sectionId: string, oldFragment: string, newFragment: string): Promise<any> {
  return api(`/reports/${reportId}/fix`, {
    method: "POST",
    body: JSON.stringify({ section_id: sectionId, old_fragment: oldFragment, new_fragment: newFragment }),
  });
}
