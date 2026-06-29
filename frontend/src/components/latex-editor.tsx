"use client";

import { useEffect, useRef, useCallback } from "react";
import { CompileStatus, statusLabel, statusColor, EditorError } from "@/lib/latex-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Wand2, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Syntax highlight ──────────────────────────────────────────────────────────
// Key rule: the <pre> layer has color:transparent as BASE.
// Every character that should be VISIBLE must be inside a colored <span>.
// Any character left outside a span disappears (transparent).
// So we must wrap ALL text in spans — not just the tokens we want to color.

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Default color for plain text — matches the textarea text color
const PLAIN = "#cbd5e1"; // slate-300

function wrapPlain(s: string): string {
    if (!s) return "";
    return `<span style="color:${PLAIN}">${s}</span>`;
}

function highlightLatex(code: string): string {
    return code
        .split("\n")
        .map((line) => highlightLine(escapeHtml(line)))
        .join("\n");
}

function highlightLine(line: string): string {
    // We'll build the output by scanning left-to-right and tagging tokens.
    // Untagged text gets wrapped in a plain-color span so it's visible.
    let result = "";
    let i = 0;
    const len = line.length;

    while (i < len) {
        // Comment: % to end of line (not preceded by \)
        if (line[i] === "%" && (i === 0 || line[i - 1] !== "\\")) {
            const rest = line.slice(i);
            result += `<span style="color:#6b7280;font-style:italic">${rest}</span>`;
            i = len;
            continue;
        }

        // LaTeX command: \word
        if (line[i] === "\\" && i + 1 < len && /[a-zA-Z*]/.test(line[i + 1])) {
            let j = i + 1;
            while (j < len && /[a-zA-Z*]/.test(line[j])) j++;
            const cmd = line.slice(i, j);
            result += `<span style="color:#c084fc">${cmd}</span>`;
            i = j;
            continue;
        }

        // Optional args [...]
        if (line[i] === "[") {
            let j = i + 1;
            let depth = 1;
            while (j < len && depth > 0) {
                if (line[j] === "[") depth++;
                else if (line[j] === "]") depth--;
                j++;
            }
            const content = line.slice(i + 1, j - 1);
            result += `<span style="color:#6ee7b7">[</span>`;
            result += `<span style="color:#34d399">${content}</span>`;
            result += `<span style="color:#6ee7b7">]</span>`;
            i = j;
            continue;
        }

        // Mandatory args {...}
        if (line[i] === "{") {
            let j = i + 1;
            let depth = 1;
            while (j < len && depth > 0) {
                if (line[j] === "{") depth++;
                else if (line[j] === "}") depth--;
                j++;
            }
            const content = line.slice(i + 1, j - 1);
            result += `<span style="color:#f59e0b">{</span>`;
            result += `<span style="color:${PLAIN}">${content}</span>`;
            result += `<span style="color:#f59e0b">}</span>`;
            i = j;
            continue;
        }

        // Inline math $...$
        if (line[i] === "$") {
            let j = i + 1;
            while (j < len && line[j] !== "$") j++;
            if (j < len) j++; // include closing $
            const math = line.slice(i, j);
            result += `<span style="color:#fb923c">${math}</span>`;
            i = j;
            continue;
        }

        // Plain character — must be wrapped in colored span to stay visible
        let j = i + 1;
        while (
            j < len &&
            line[j] !== "\\" &&
            line[j] !== "%" &&
            line[j] !== "[" &&
            line[j] !== "{" &&
            line[j] !== "$"
        ) {
            j++;
        }
        result += wrapPlain(line.slice(i, j));
        i = j;
    }

    return result;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface LatexEditorProps {
    value: string;
    onChange: (value: string) => void;
    onSave?: () => void;
    onPolish?: () => void;
    compileStatus: CompileStatus;
    errors: EditorError[];
    isPolishing?: boolean;
    className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LatexEditor({
    value,
    onChange,
    onSave,
    onPolish,
    compileStatus,
    errors,
    isPolishing = false,
    className,
}: LatexEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const highlightRef = useRef<HTMLPreElement>(null);
    const gutterRef = useRef<HTMLDivElement>(null);

    const safeValue = value ?? "";
    const errorLines = new Set<number>(errors.flatMap((e) => (e.line != null ? [e.line] : [])));
    const lineCount = (safeValue.match(/\n/g)?.length ?? 0) + 1;

    // Sync scroll: textarea → highlight pre + gutter
    const handleScroll = useCallback(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        if (highlightRef.current) highlightRef.current.scrollTop = ta.scrollTop;
        if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
    }, []);

    // Keyboard shortcuts
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                onSave?.();
                return;
            }
            if (e.key === "Tab") {
                e.preventDefault();
                const ta = e.currentTarget;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const next = safeValue.substring(0, start) + "  " + safeValue.substring(end);
                onChange(next);
                requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
            }
        },
        [onSave, onChange, safeValue]
    );

    // Re-render highlight whenever value changes
    useEffect(() => {
        if (highlightRef.current) {
            highlightRef.current.innerHTML = highlightLatex(safeValue) + "\n";
        }
    }, [safeValue]);

    const StatusIcon = () => {
        switch (compileStatus) {
            case "compiling": return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
            case "success": return <CheckCircle2 className="h-3.5 w-3.5" />;
            case "error": return <XCircle className="h-3.5 w-3.5" />;
            case "unsaved": return <Clock className="h-3.5 w-3.5" />;
            default: return null;
        }
    };

    const EDITOR_FONT = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace";
    const EDITOR_SIZE = "0.8125rem";
    const LINE_H = "1.5rem";
    const PAD = "0.75rem";

    return (
        <div
            className={cn("flex flex-col h-full rounded-lg border border-border overflow-hidden", className)}
            style={{ background: "#1e1e2e" }}
        >
            {/* ── Toolbar ── */}
            <div
                className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0"
                style={{ background: "#181825" }}
            >
                <div className="flex items-center gap-2">
                    <span className="text-xs font-mono" style={{ color: "#94a3b8" }}>LaTeX Source</span>
                    <span className={cn("flex items-center gap-1 text-xs font-medium", statusColor(compileStatus))}>
                        <StatusIcon />
                        {statusLabel(compileStatus)}
                    </span>
                    {errors.length > 0 && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                            {errors.length} error{errors.length !== 1 ? "s" : ""}
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    {onPolish && (
                        <Button
                            size="sm" variant="ghost" onClick={onPolish} disabled={isPolishing}
                            className="h-7 px-2 text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                        >
                            {isPolishing
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                : <Wand2 className="h-3.5 w-3.5 mr-1" />}
                            {isPolishing ? "Polishing…" : "Polish"}
                        </Button>
                    )}
                    {onSave && (
                        <Button
                            size="sm" variant="ghost" onClick={onSave}
                            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-100"
                        >
                            <Save className="h-3.5 w-3.5 mr-1" />Save
                        </Button>
                    )}
                </div>
            </div>

            {/* ── Error bar ── */}
            {errors.length > 0 && (
                <div
                    className="flex items-start gap-2 px-3 py-2 border-b text-xs overflow-x-auto shrink-0"
                    style={{ background: "rgba(127,29,29,0.3)", borderColor: "rgba(185,28,28,0.3)", color: "#fca5a5" }}
                >
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: "#f87171" }} />
                    <div className="space-y-0.5">
                        {errors.slice(0, 3).map((err, i) => (
                            <div key={i}>
                                {err.line != null && (
                                    <span className="font-mono mr-1.5" style={{ color: "#f87171" }}>L{err.line}</span>
                                )}
                                {err.message}
                            </div>
                        ))}
                        {errors.length > 3 && (
                            <div style={{ color: "rgba(248,113,113,0.6)" }}>+{errors.length - 3} more</div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Editor body ── */}
            <div className="relative flex flex-1 min-h-0 overflow-hidden">

                {/* Gutter */}
                <div
                    ref={gutterRef}
                    className="select-none shrink-0 overflow-hidden text-right"
                    style={{
                        width: "3rem",
                        background: "#181825",
                        borderRight: "1px solid rgba(255,255,255,0.06)",
                        overflowY: "hidden",
                        paddingTop: PAD,
                        fontFamily: EDITOR_FONT,
                        fontSize: "0.7rem",
                        lineHeight: LINE_H,
                        color: "#374151",
                    }}
                >
                    {Array.from({ length: lineCount }, (_, i) => {
                        const lineNum = i + 1;
                        const hasError = errorLines.has(lineNum);
                        return (
                            <div
                                key={i}
                                style={{ paddingRight: "0.5rem", color: hasError ? "#f87171" : undefined }}
                            >
                                {hasError ? "●" : lineNum}
                            </div>
                        );
                    })}
                </div>

                {/* Right column: highlight + textarea stacked */}
                <div className="relative flex-1 min-w-0 overflow-hidden">

                    {/* Error line bands */}
                    <div className="absolute inset-0 pointer-events-none" style={{ paddingTop: PAD }}>
                        {Array.from({ length: lineCount }, (_, i) => {
                            if (!errorLines.has(i + 1)) return null;
                            return (
                                <div
                                    key={i}
                                    className="absolute left-0 right-0"
                                    style={{
                                        top: `calc(${PAD} + ${i * 1.5}rem)`,
                                        height: LINE_H,
                                        background: "rgba(239,68,68,0.08)",
                                        borderLeft: "2px solid #ef4444",
                                    }}
                                />
                            );
                        })}
                    </div>

                    {/*
            Highlight <pre>:
              - base color is transparent (only spans show)
              - pointerEvents none so clicks pass through to textarea
              - scrollTop synced from textarea
          */}
                    <pre
                        ref={highlightRef}
                        aria-hidden
                        className="absolute inset-0 m-0 pointer-events-none whitespace-pre overflow-hidden"
                        style={{
                            padding: PAD,
                            fontFamily: EDITOR_FONT,
                            fontSize: EDITOR_SIZE,
                            lineHeight: LINE_H,
                            color: "transparent", // base: invisible; spans override this
                            overflowY: "hidden",
                        }}
                    />

                    {/*
            Textarea:
              - sits on top of pre
              - text is transparent so highlight shows through
              - caretColor keeps the cursor visible
          */}
                    <textarea
                        ref={textareaRef}
                        value={safeValue}
                        onChange={(e) => onChange(e.target.value)}
                        onScroll={handleScroll}
                        onKeyDown={handleKeyDown}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                        className="absolute inset-0 w-full h-full resize-none outline-none bg-transparent overflow-auto whitespace-pre"
                        style={{
                            padding: PAD,
                            fontFamily: EDITOR_FONT,
                            fontSize: EDITOR_SIZE,
                            lineHeight: LINE_H,
                            color: "transparent",
                            WebkitTextFillColor: "transparent",
                            caretColor: "#a78bfa",
                        }}
                    />
                </div>
            </div>
        </div>
    );
}