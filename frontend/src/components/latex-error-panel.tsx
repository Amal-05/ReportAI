"use client";

import { AlertCircle, CheckCircle2, RefreshCcw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LaTeXError } from "@/lib/types";
import { applyFix } from "@/lib/api";
import { useState } from "react";

interface LatexErrorPanelProps {
  reportId: string;
  errors: LaTeXError[];
  onFixApplied: () => void;
}

export function LatexErrorPanel({ reportId, errors, onFixApplied }: LatexErrorPanelProps) {
  const [fixing, setFixing] = useState<string | null>(null);

  async function handleFix(error: LaTeXError) {
    if (!error.section_id || !error.source_fragment || !error.suggested_fix) return;
    
    setFixing(error.message);
    try {
      await applyFix(reportId, error.section_id, error.source_fragment, error.suggested_fix);
      onFixApplied();
    } catch (err) {
      console.error("Failed to apply fix:", err);
    } finally {
      setFixing(null);
    }
  }

  if (errors.length === 0) return null;

  return (
    <Card className="border-destructive/50 bg-destructive/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-md flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          LaTeX Compilation Errors
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {errors.map((error, idx) => (
          <div key={idx} className="rounded-md border border-destructive/20 bg-background p-3 text-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="font-semibold text-destructive">
                  {error.line ? `Line ${error.line}: ` : ""}{error.message}
                </div>
                {error.context && (
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs text-muted-foreground">
                    {error.context}
                  </pre>
                )}
                {error.suggested_fix && (
                  <div className="mt-3 space-y-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Suggested AI Fix:</div>
                    <div className="rounded border border-primary/20 bg-primary/5 p-2 font-mono text-xs text-primary">
                      {error.suggested_fix}
                    </div>
                  </div>
                )}
              </div>
              
              {error.suggested_fix && error.section_id && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex items-center gap-1.5 border-primary/50 text-primary hover:bg-primary/10"
                  onClick={() => handleFix(error)}
                  disabled={fixing !== null}
                >
                  {fixing === error.message ? (
                    <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wrench className="h-3.5 w-3.5" />
                  )}
                  Auto-Fix
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
