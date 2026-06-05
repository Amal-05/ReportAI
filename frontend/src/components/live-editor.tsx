"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Download, RefreshCcw, Save, AlertCircle, Wrench, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResearchAssistant } from "./research-assistant";
import { useAuth } from "@/components/auth-provider";
import { projectsQuery, updateProject } from "@/lib/firestore";
import { onSnapshot } from "firebase/firestore";
import { compileRawReport, getPdfUrl } from "@/lib/api";
import type { Project, LaTeXError } from "@/lib/types";

export function LiveEditor() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [source, setSource] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [isCompiling, setIsCompiling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compileErrors, setCompileErrors] = useState<LaTeXError[]>([]);
  const [successMessage, setSuccessMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(
      projectsQuery(user.uid),
      (snapshot) => {
        const loadedProjects = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Project);
        setProjects(loadedProjects);
      },
      (error) => console.error("Error fetching projects:", error)
    );
    return () => unsubscribe();
  }, [user]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
    setPdfUrl(null);
    setCompileErrors([]);
    setSuccessMessage("");
    const proj = projects.find((p) => p.id === projectId);
    if (proj) {
      setSource(proj.latest_latex ?? "");
    } else {
      setSource("");
    }
  };

  const handleTextareaSelect = () => {
    if (!textareaRef.current) return;
    const { selectionStart, selectionEnd } = textareaRef.current;
    if (selectionStart !== selectionEnd) {
      setSelectedText(source.substring(selectionStart, selectionEnd));
    }
  };

  const handleApplyChange = (newText: string, action: "replace" | "insert") => {
    if (!textareaRef.current) return;
    const { selectionStart, selectionEnd } = textareaRef.current;

    let updatedSource = "";
    if (action === "replace") {
      if (selectionStart !== selectionEnd) {
        updatedSource = source.substring(0, selectionStart) + newText + source.substring(selectionEnd);
      } else if (selectedText && source.includes(selectedText)) {
        const index = source.indexOf(selectedText);
        updatedSource = source.substring(0, index) + newText + source.substring(index + selectedText.length);
      } else {
        updatedSource = source.substring(0, selectionEnd) + "\n" + newText + source.substring(selectionEnd);
      }
    } else {
      updatedSource = source.substring(0, selectionEnd) + "\n" + newText + source.substring(selectionEnd);
    }

    setSource(updatedSource);
    setSelectedText("");
  };

  const handleSave = async () => {
    if (!user || !selectedProjectId) return;
    setIsSaving(true);
    setSuccessMessage("");
    try {
      await updateProject(user.uid, selectedProjectId, {
        latest_latex: source,
      });
      setSuccessMessage("Project saved successfully!");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (error) {
      console.error("Error saving project:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCompile = async (sourceToCompile = source) => {
    if (!selectedProjectId) return;
    setIsCompiling(true);
    setCompileErrors([]);
    setSuccessMessage("");
    try {
      const result = await compileRawReport(sourceToCompile);
      if (result.ok && result.pdf_storage_key) {
        setPdfUrl(getPdfUrl(result.pdf_storage_key));
        setSuccessMessage("Compilation successful!");
      } else {
        setPdfUrl(null);
        setCompileErrors(result.errors || []);
      }
    } catch (error) {
      console.error("Error compiling report:", error);
    } finally {
      setIsCompiling(false);
    }
  };

  const handleExportTex = () => {
    if (!source) return;
    const blob = new Blob([source], { type: "text/x-tex" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedProject?.title.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "report"}.tex`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!user) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center max-w-md mx-auto my-12 shadow-md">
        <h2 className="text-lg font-semibold">Sign in required</h2>
        <p className="mt-2 text-sm text-muted-foreground">Log in to load and edit your LaTeX reports.</p>
        <Button className="mt-4" asChild>
          <Link href="/login">Login</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 p-4 rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Select Project:</span>
          <select
            value={selectedProjectId}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="flex h-10 w-full sm:w-72 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">-- Choose a Project --</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        {successMessage && (
          <div className="text-xs font-semibold text-green-500 bg-green-500/10 px-3 py-1.5 rounded border border-green-500/20">
            {successMessage}
          </div>
        )}
      </div>

      <div className="grid min-h-[calc(100vh-88px)] gap-4 editor-grid">
        <section className="flex min-h-[560px] flex-col rounded-lg border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b p-3">
            <h2 className="font-semibold font-mono text-sm text-primary">
              {selectedProject
                ? `${selectedProject.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.tex`
                : "report.tex"}
            </h2>
            <div className="flex gap-2">
              <Button
                size="icon"
                variant="ghost"
                title="Save"
                onClick={handleSave}
                disabled={isSaving || !selectedProjectId}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Save className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title="Recompile"
                onClick={() => handleCompile()}
                disabled={isCompiling || !selectedProjectId}
              >
                {isCompiling ? (
                  <RefreshCcw className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <RefreshCcw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            onSelect={handleTextareaSelect}
            placeholder="Select a project workspace above to load its LaTeX source..."
            disabled={!selectedProjectId}
            className="min-h-0 flex-1 resize-none bg-[#0f1720] p-4 font-mono text-sm leading-6 text-[#d7e2ef] outline-none disabled:opacity-50"
          />
        </section>

        <section className="flex min-h-[560px] flex-col rounded-lg border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b p-3">
            <h2 className="font-semibold">PDF Preview</h2>
            <Button size="sm" variant="outline" onClick={handleExportTex} disabled={!source}>
              <Download className="mr-1.5 h-4 w-4" />
              Export .tex
            </Button>
          </div>
          <div className="flex-1 overflow-auto bg-muted p-5 min-h-[500px] flex flex-col justify-stretch">
            {pdfUrl ? (
              <iframe
                src={pdfUrl}
                className="w-full flex-1 min-h-[500px] border rounded bg-white shadow-inner"
                title="PDF Compilation Output"
              />
            ) : (
              <article className="mx-auto min-h-full w-full max-w-[620px] bg-white p-10 text-black shadow-sm flex-1">
                <h1 className="text-center text-2xl font-semibold font-serif">
                  {selectedProject ? selectedProject.title : "ReportAI Generated Report"}
                </h1>
                <div className="mt-8 whitespace-pre-wrap text-sm leading-7 font-serif text-slate-800">
                  {source
                    ? source.replaceAll("\\", "")
                    : "Select a project workspace and click Recompile to preview the PDF draft."}
                </div>
              </article>
            )}
          </div>
        </section>
      </div>

      {compileErrors.length > 0 && (
        <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-destructive flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" /> LaTeX Compilation Errors
          </h3>
          <div className="space-y-3">
            {compileErrors.map((error, idx) => (
              <div
                key={idx}
                className="rounded bg-background border border-destructive/10 p-3 text-xs flex justify-between items-start gap-4"
              >
                <div className="space-y-1 flex-1">
                  <div className="font-semibold text-destructive">
                    {error.line ? `Line ${error.line}: ` : ""}{error.message}
                  </div>
                  {error.context && (
                    <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-[10px] text-muted-foreground">
                      {error.context}
                    </pre>
                  )}
                  {error.suggested_fix && (
                    <div className="mt-2 space-y-1">
                      <div className="font-medium text-muted-foreground uppercase tracking-wider text-[9px]">
                        Suggested AI Fix:
                      </div>
                      <div className="rounded border border-primary/20 bg-primary/5 p-1.5 font-mono text-[10px] text-primary">
                        {error.suggested_fix}
                      </div>
                    </div>
                  )}
                </div>
                {error.suggested_fix && error.source_fragment && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex items-center gap-1 border-primary/50 text-primary hover:bg-primary/10 text-xs py-1 h-7"
                    onClick={() => {
                      const updated = source.replace(error.source_fragment!, error.suggested_fix!);
                      setSource(updated);
                      handleCompile(updated);
                    }}
                  >
                    <Wrench className="h-3 w-3" />
                    Auto-Fix
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedProjectId && (
        <ResearchAssistant
          source={source}
          onApplyChange={handleApplyChange}
          selectedText={selectedText}
          onClearSelection={() => setSelectedText("")}
        />
      )}
    </div>
  );
}
