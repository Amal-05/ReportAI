"use client";

/**
 * src/app/editor/page.tsx
 *
 * Standalone Overleaf-style editor page.
 * Shows a project selector dropdown, loads that project's latest LaTeX
 * from Firebase, then renders the LiveEditor split pane.
 */

import { useEffect, useState, Suspense } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { useAuth } from "@/components/auth-provider";
import { LiveEditor } from "@/components/live-editor";
import { getFirebaseDb } from "@/lib/firebase";
import { getProject, saveReportDraft } from "@/lib/firestore";
import { analyzeQuality, polishLatexWithAI } from "@/lib/report-generation";
import type { Project } from "@/lib/types";
import { Loader2, FolderOpen } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function EditorContent() {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get("projectId") || "";

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [project, setProject] = useState<Project | null>(null);
  const [latex, setLatex] = useState<string>("");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingProject, setLoadingProject] = useState(false);

  // Load project list
  useEffect(() => {
    if (!user) return;
    setLoadingProjects(true);
    getDocs(
      query(
        collection(getFirebaseDb(), "users", user.uid, "projects"),
        orderBy("updated_at", "desc")
      )
    )
      .then((snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Project));
        setProjects(list);
        if (initialProjectId) {
          setSelectedId(initialProjectId);
        } else {
          // Auto-select first project that has latex
          const withLatex = list.find((p) => p.latest_latex);
          if (withLatex) setSelectedId(withLatex.id);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingProjects(false));
  }, [user, initialProjectId]);

  // Load selected project
  useEffect(() => {
    if (!user || !selectedId) return;
    setLoadingProject(true);
    getProject(user.uid, selectedId)
      .then((p) => {
        setProject(p);
        setLatex(p?.latest_latex ?? "");
      })
      .catch(console.error)
      .finally(() => setLoadingProject(false));
  }, [user, selectedId]);

  async function handleSave(source: string) {
    if (!user || !project) return;
    const q = analyzeQuality(source, 0);
    await saveReportDraft(user.uid, project.id, source, q);
    setLatex(source);
  }

  async function handlePolish(source: string): Promise<string> {
    if (!project) return source;
    const polished = await polishLatexWithAI(source, project);
    if (user) {
      const q = analyzeQuality(polished, 0);
      await saveReportDraft(user.uid, project.id, polished, q);
    }
    return polished;
  }

  if (loading || loadingProjects) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">Log in to use the editor.</p>
        <Link href="/login" className="text-sm text-primary underline">Login</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border bg-card shrink-0">
        <div>
          <p className="text-xs text-muted-foreground">Overleaf-style workspace</p>
          <h1 className="text-xl font-bold leading-tight">Live LaTeX Editor</h1>
        </div>

        {/* Project selector */}
        <div className="flex items-center gap-2 ml-auto">
          <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="text-sm bg-muted border border-border rounded-md px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-[220px]"
          >
            <option value="">— Select a project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {!p.latest_latex ? " (no report yet)" : ""}
              </option>
            ))}
          </select>
          {loadingProject && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {project && (
          <Link
            href={`/projects/${project.id}`}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            ← Back to project
          </Link>
        )}
      </div>

      {/* ── Editor area ── */}
      <div className="flex-1 min-h-0 p-4">
        {!selectedId ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <FolderOpen className="h-10 w-10 opacity-30" />
            <p className="text-sm">Select a project above to start editing.</p>
            {projects.length === 0 && (
              <p className="text-xs opacity-60">
                No projects yet.{" "}
                <Link href="/dashboard" className="underline">Create one</Link>.
              </p>
            )}
          </div>
        ) : loadingProject ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !latex ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <p className="text-sm">This project has no generated report yet.</p>
            <Link
              href={`/projects/${selectedId}`}
              className="text-sm text-primary underline"
            >
              Generate a report first →
            </Link>
          </div>
        ) : (
          <LiveEditor
            latex={latex}
            onLatexChange={setLatex}
            onSave={handleSave}
            onPolish={handlePolish}
            projectTitle={project?.title}
          />
        )}
      </div>
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <EditorContent />
    </Suspense>
  );
}