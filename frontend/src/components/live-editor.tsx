"use client";

/**
 * live-editor.tsx  (complete replacement / enhancement)
 *
 * Overleaf-style split-pane live editor:
 *   LEFT  → LatexEditor (syntax highlighted, error line gutter, autosave)
 *   RIGHT → PdfPreview  (iframe showing real compiled PDF from backend)
 *
 * Features:
 *   ✓ Autosave with 2s debounce after typing stops
 *   ✓ Background auto-compilation after save (calls /reports/compile-raw)
 *   ✓ Compile status badge (idle / unsaved / compiling / success / error)
 *   ✓ Error line highlighting in editor gutter
 *   ✓ AI-powered polish pass (/generation/polish-latex)
 *   ✓ AI-assisted fix for compile errors (existing applyFix API)
 *   ✓ PDF served as blob URL from backend binary response
 *   ✓ Resizable split pane (drag handle)
 *   ✓ Keyboard shortcut: Ctrl+S to save + compile
 *
 * Does NOT rewrite report generation pipeline.
 * Drops into project-workspace.tsx where the old LaTeX <Textarea> was.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { LatexEditor } from "@/components/latex-editor";
import { PdfPreview } from "@/components/pdf-preview";
import { LatexErrorPanel } from "@/components/latex-error-panel";
import {
  CompileStatus,
  EditorError,
  debounce,
  findErrorLine,
  lintLatex,
  autoFixLatex,
} from "@/lib/latex-utils";
import { compileRawReport, getPdfUrl } from "@/lib/api";
import type { LaTeXError } from "@/lib/types";

// ── Props ─────────────────────────────────────────────────────────────────────

interface LiveEditorProps {
  /** Current LaTeX source (controlled from parent) */
  latex?: string;
  /** Notify parent of edits so it can persist to Firebase */
  onLatexChange?: (latex: string) => void;
  /** Called after successful save (parent persists to Firebase/backend) */
  onSave?: (latex: string) => Promise<void>;
  /** Called with AI-polish result — parent decides whether to accept */
  onPolish?: (latex: string) => Promise<string>;
  /** Report ID for fix endpoint (null if not yet created via backend) */
  reportId?: string | null;
  /** Project title (for display) */
  projectTitle?: string;
}

// ── AUTOSAVE delay ────────────────────────────────────────────────────────────

const AUTOSAVE_DELAY = 2000;   // ms after last keystroke → save
const AUTOCOMPILE_DELAY = 500; // ms after save → compile

// ── Component ─────────────────────────────────────────────────────────────────

export function LiveEditor({
  latex = "",
  onLatexChange,
  onSave,
  onPolish,
  reportId,
  projectTitle,
}: LiveEditorProps) {
  const [localLatex, setLocalLatex] = useState(latex ?? "");
  const [compileStatus, setCompileStatus] = useState<CompileStatus>("idle");
  const [errors, setErrors] = useState<EditorError[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isPolishing, setIsPolishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Pane split ratio (% for left pane)
  const [splitPct, setSplitPct] = useState(50);
  const splitRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Keep local in sync if parent updates (e.g. after Generate Report)
  useEffect(() => {
    const safe = latex ?? "";
    if (safe !== localLatex) {
      setLocalLatex(safe);
      setCompileStatus(safe ? "unsaved" : "idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latex]);

  // ── Compile ──────────────────────────────────────────────────────────────────

  const compile = useCallback(async (source: string) => {
    if (!source.trim()) return;

    // Auto-fix common AI LaTeX mistakes before sending to compiler
    const fixed = autoFixLatex(source);
    if (fixed !== source) {
      // Update editor with fixed source silently
      setLocalLatex(fixed);
      onLatexChange?.(fixed);
    }

    setCompileStatus("compiling");
    setErrors([]);
    try {
      const result = await compileRawReport(fixed);
      if (result.ok && result.pdf_storage_key) {
        // Fetch PDF binary → blob URL so iframe can display it
        const API_URL =
          process.env.NEXT_PUBLIC_API_URL ??
          "https://reportai-ytsn.onrender.com/api/v1";
        const token =
          typeof window !== "undefined"
            ? window.localStorage.getItem("reportai_token")
            : null;
        const pdfRes = await fetch(
          `${API_URL}/reports/pdf/${result.pdf_storage_key}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (pdfRes.ok) {
          const blob = await pdfRes.blob();
          const url = URL.createObjectURL(blob);
          // Revoke previous blob URL to free memory
          setPdfUrl((prev) => {
            if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
            return url;
          });
        } else {
          // Backend URL fallback (if blob fetch fails)
          setPdfUrl(getPdfUrl(result.pdf_storage_key));
        }
        setCompileStatus("success");
        setErrors([]);
      } else {
        setCompileStatus("error");
        const mapped: EditorError[] = (result.errors ?? []).map(
          (e: LaTeXError) => ({
            line: e.line ?? findErrorLine(source, e.source_fragment),
            message: e.message,
            context: e.context,
            source_fragment: e.source_fragment,
            suggested_fix: e.suggested_fix,
            section_id: e.section_id,
          })
        );
        setErrors(mapped);
      }
    } catch (err) {
      setCompileStatus("error");
      setErrors([
        {
          line: null,
          message: err instanceof Error ? err.message : "Compilation failed",
          context: null,
          source_fragment: null,
          suggested_fix: null,
          section_id: null,
        },
      ]);
    }
  }, []);

  // ── Autosave + auto-compile ───────────────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSaveAndCompile = useCallback(
    debounce(async (source: string) => {
      // 1. Notify parent to persist
      try {
        await onSave?.(source);
      } catch (_) {/* swallow — parent shows its own errors */ }
      // 2. Compile after small delay
      setTimeout(() => compile(source), AUTOCOMPILE_DELAY);
    }, AUTOSAVE_DELAY),
    [onSave, compile]
  );

  const handleChange = useCallback(
    (next: string) => {
      setLocalLatex(next);
      onLatexChange?.(next);
      setCompileStatus("unsaved");
      debouncedSaveAndCompile(next);
    },
    [onLatexChange, debouncedSaveAndCompile]
  );

  // Manual save (Ctrl+S)
  const handleManualSave = useCallback(async () => {
    try {
      await onSave?.(localLatex);
    } catch (_) { /* parent handles */ }
    compile(localLatex);
  }, [localLatex, onSave, compile]);

  // ── Polish ───────────────────────────────────────────────────────────────────

  const handlePolish = useCallback(async () => {
    if (!onPolish) return;
    setIsPolishing(true);
    setMessage(null);
    try {
      const polished = await onPolish(localLatex);
      setLocalLatex(polished);
      onLatexChange?.(polished);
      setCompileStatus(polished ? "unsaved" : "idle");
      setMessage("Polish complete — review changes then recompile.");
      // Auto-compile polished version
      setTimeout(() => compile(polished), 500);
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Polish failed"
      );
    } finally {
      setIsPolishing(false);
    }
  }, [onPolish, localLatex, onLatexChange, compile]);

  // ── Lint warnings ────────────────────────────────────────────────────────────

  const lint = lintLatex(localLatex);

  // ── Resizable split pane ──────────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !splitRef.current) return;
      const container = splitRef.current.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {/* Lint warnings */}
      {lint.warnings.length > 0 && (
        <div className="rounded-md border border-yellow-600/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-300 flex items-center gap-2">
          <span>⚠</span>
          {lint.warnings[0]}
        </div>
      )}

      {/* Message bar */}
      {message && (
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {message}
        </div>
      )}

      {/* ── Split pane ── */}
      <div
        className="flex gap-0 rounded-lg overflow-hidden border border-border"
        style={{ height: "calc(100vh - 320px)", minHeight: "520px" }}
      >
        {/* Left: Editor */}
        <div style={{ width: `${splitPct}%`, minWidth: 0 }} className="flex flex-col">
          <LatexEditor
            value={localLatex}
            onChange={handleChange}
            onSave={handleManualSave}
            onPolish={onPolish ? handlePolish : undefined}
            compileStatus={compileStatus}
            errors={errors}
            isPolishing={isPolishing}
            className="h-full rounded-none border-0"
          />
        </div>

        {/* Drag handle */}
        <div
          ref={splitRef}
          onMouseDown={handleMouseDown}
          className="w-1.5 bg-border/40 hover:bg-purple-500/40 cursor-col-resize transition-colors shrink-0 flex items-center justify-center group"
          title="Drag to resize"
        >
          <div className="h-8 w-0.5 rounded-full bg-border group-hover:bg-purple-400 transition-colors" />
        </div>

        {/* Right: PDF preview */}
        <div style={{ width: `${100 - splitPct}%`, minWidth: 0 }} className="flex flex-col">
          <PdfPreview
            pdfUrl={pdfUrl}
            compileStatus={compileStatus}
            errorCount={errors.length}
            onRecompile={() => compile(localLatex)}
            className="h-full rounded-none border-0"
          />
        </div>
      </div>

      {/* ── Error detail panel (existing LatexErrorPanel, unchanged) ── */}
      {reportId && errors.length > 0 && (
        <LatexErrorPanel
          reportId={reportId}
          errors={errors as LaTeXError[]}
          onFixApplied={() => {
            // After AI applies a fix, recompile
            compile(localLatex);
          }}
        />
      )}
    </div>
  );
}