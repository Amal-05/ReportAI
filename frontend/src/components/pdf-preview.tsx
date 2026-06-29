"use client";

/**
 * pdf-preview.tsx
 *
 * Renders a compiled PDF inside an <iframe> using an object URL built from
 * the binary PDF returned by the backend.  Falls back gracefully when:
 *   - No PDF is available yet (shows instructional empty state)
 *   - Compilation is in progress (shows spinner overlay)
 *   - Compilation failed (shows error summary with last-good-PDF beneath)
 *
 * The component is fully controlled: the parent passes a `pdfBlobUrl` string
 * (object URL or backend URL) and a `compileStatus`.
 */

import { useEffect, useRef, useState } from "react";
import { CompileStatus } from "@/lib/latex-utils";
import { Loader2, FileX2, FileCheck2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PdfPreviewProps {
    /** Object URL (blob:...) or backend URL pointing to compiled PDF. Null = no PDF yet. */
    pdfUrl: string | null;
    compileStatus: CompileStatus;
    errorCount?: number;
    onRecompile?: () => void;
    className?: string;
}

export function PdfPreview({
    pdfUrl,
    compileStatus,
    errorCount = 0,
    onRecompile,
    className,
}: PdfPreviewProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [iframeLoaded, setIframeLoaded] = useState(false);

    const isCompiling = compileStatus === "compiling";
    const hasFailed = compileStatus === "error";
    const hasSuccess = compileStatus === "success" || (pdfUrl && compileStatus !== "error");

    // Reset loaded flag when URL changes
    useEffect(() => {
        setIframeLoaded(false);
    }, [pdfUrl]);

    return (
        <div
            className={cn(
                "relative flex flex-col h-full rounded-lg border border-border overflow-hidden bg-[#181825]",
                className
            )}
        >
            {/* ── Toolbar ── */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-[#181825] shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">PDF Preview</span>
                    {hasSuccess && !hasFailed && (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                            <FileCheck2 className="h-3.5 w-3.5" />
                            Live
                        </span>
                    )}
                    {hasFailed && (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                            <FileX2 className="h-3.5 w-3.5" />
                            {errorCount} error{errorCount !== 1 ? "s" : ""}
                        </span>
                    )}
                </div>
                {onRecompile && (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={onRecompile}
                        disabled={isCompiling}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5 mr-1", isCompiling && "animate-spin")} />
                        Recompile
                    </Button>
                )}
            </div>

            {/* ── PDF iframe ── */}
            <div className="relative flex-1 min-h-0 bg-[#2a2a3e]">
                {pdfUrl ? (
                    <>
                        <iframe
                            ref={iframeRef}
                            src={pdfUrl}
                            title="Compiled PDF Preview"
                            className={cn(
                                "w-full h-full border-0 transition-opacity duration-300",
                                iframeLoaded ? "opacity-100" : "opacity-0"
                            )}
                            onLoad={() => setIframeLoaded(true)}
                        />
                        {/* Loading overlay while iframe loads */}
                        {!iframeLoaded && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                                <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
                                <p className="text-sm">Loading PDF…</p>
                            </div>
                        )}
                    </>
                ) : (
                    /* Empty state */
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-6">
                        <div className="rounded-full bg-purple-500/10 p-4">
                            <FileCheck2 className="h-8 w-8 text-purple-400/60" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">No compiled PDF yet</p>
                            <p className="text-xs text-muted-foreground/60">
                                Save your LaTeX source and click Recompile, or generate a report to see a preview here.
                            </p>
                        </div>
                        {onRecompile && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={onRecompile}
                                className="text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                            >
                                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                                Compile Now
                            </Button>
                        )}
                    </div>
                )}

                {/* Compiling overlay (semi-transparent over existing PDF) */}
                {isCompiling && pdfUrl && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-[2px]">
                        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
                        <p className="text-sm text-white/80">Compiling…</p>
                    </div>
                )}

                {/* Error overlay (no PDF) */}
                {hasFailed && !pdfUrl && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-6">
                        <div className="rounded-full bg-red-500/10 p-4">
                            <FileX2 className="h-8 w-8 text-red-400/80" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-red-300">Compilation failed</p>
                            <p className="text-xs text-muted-foreground/70">
                                Fix the errors in the editor and recompile.
                            </p>
                        </div>
                        {onRecompile && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={onRecompile}
                                className="text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                            >
                                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                                Try Again
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}