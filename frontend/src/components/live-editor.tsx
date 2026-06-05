"use client";

import { useState, useRef } from "react";
import { Download, RefreshCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResearchAssistant } from "./research-assistant";

export function LiveEditor() {
  const [source, setSource] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const getSelectedText = () => {
    if (!textareaRef.current) return "";
    const { selectionStart, selectionEnd } = textareaRef.current;
    return source.substring(selectionStart, selectionEnd);
  };

  const handleApplyChange = (newText: string, action: "replace" | "insert") => {
    if (!textareaRef.current) return;
    const { selectionStart, selectionEnd } = textareaRef.current;

    let updatedSource = "";
    if (action === "replace" && selectionStart !== selectionEnd) {
      updatedSource = source.substring(0, selectionStart) + newText + source.substring(selectionEnd);
    } else {
      // For "insert" or if nothing was selected, insert at cursor or end of selection
      updatedSource = source.substring(0, selectionEnd) + "\n" + newText + source.substring(selectionEnd);
    }

    setSource(updatedSource);
  };

  return (
    <div className="relative">
      <div className="grid min-h-[calc(100vh-88px)] gap-4 editor-grid">
        <section className="flex min-h-[560px] flex-col rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b p-3">
            <h2 className="font-semibold">report.tex</h2>
            <div className="flex gap-2">
              <Button size="icon" variant="ghost" title="Save">
                <Save className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" title="Recompile">
                <RefreshCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="Paste or generate LaTeX from a project workspace..."
            className="min-h-0 flex-1 resize-none bg-[#0f1720] p-4 font-mono text-sm leading-6 text-[#d7e2ef] outline-none"
          />
        </section>
        <section className="flex min-h-[560px] flex-col rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b p-3">
            <h2 className="font-semibold">PDF Preview</h2>
            <Button size="sm" variant="outline">
              <Download className="h-4 w-4" />
              Export ZIP
            </Button>
          </div>
          <div className="flex-1 overflow-auto bg-muted p-5">
            <article className="mx-auto min-h-full max-w-[620px] bg-white p-10 text-black shadow-sm">
              <h1 className="text-center text-2xl font-semibold">ReportAI Generated Report</h1>
              <div className="mt-8 whitespace-pre-wrap text-sm leading-7">
                {source ? source.replaceAll("\\", "") : "Generate or paste LaTeX to preview a readable draft here."}
              </div>
            </article>
          </div>
        </section>
      </div>
      
      <ResearchAssistant 
        source={source} 
        onApplyChange={handleApplyChange} 
        getSelectedText={getSelectedText} 
      />
    </div>
  );
}
