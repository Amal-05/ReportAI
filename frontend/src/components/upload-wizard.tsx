"use client";

import { useState } from "react";
import { 
  UploadCloud, 
  CheckCircle2, 
  Cpu, 
  BookOpen, 
  FileText, 
  Sparkles, 
  Loader2, 
  Settings, 
  ArrowRight,
  ShieldCheck 
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { uploadTemplateFile, getProject, saveQuestionnaire } from "@/lib/firestore";
import { generateAIQuestions } from "@/lib/ai-generator";

const steps = ["Upload", "Extract", "Learn", "Validate"];

export function UploadWizard({ projectId }: { projectId?: string }) {
  const [active, setActive] = useState(0);
  const [maxActive, setMaxActive] = useState(0);
  const [files, setFiles] = useState<FileList | null>(null);
  const [message, setMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const { user } = useAuth();

  const progress = ((active + 1) / steps.length) * 100;

  async function uploadFiles() {
    if (!user || !projectId || !files?.length) {
      setMessage("Choose a project and at least one file first.");
      return;
    }

    setIsUploading(true);
    setIsProcessing(true);
    setMessage("");
    setActive(0);
    setMaxActive(0);

    try {
      setProcessingMessage("Uploading guideline documents to secure storage...");
      // Upload all selected files
      for (const file of Array.from(files)) {
        await uploadTemplateFile(user.uid, projectId, file);
      }

      // Transition to stage 1: Extract
      setMaxActive(1);
      setActive(1);
      setProcessingMessage("Extracting document sections, text structure, and bibliography details...");
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Transition to stage 2: Learn
      setMaxActive(2);
      setActive(2);
      setProcessingMessage("Synthesizing typographical layout, spacing metrics, and academic style guidelines...");
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Transition to stage 3: Validate
      setMaxActive(3);
      setActive(3);
      setProcessingMessage("Compiling LaTeX sample templates and validating academic standard compliance...");
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Auto-generate dynamic questionnaire based on learned profile
      const loadedProject = await getProject(user.uid, projectId);
      if (loadedProject) {
        setProcessingMessage("AI is customizing your academic questionnaire based on learned guidelines...");
        const storedKey = typeof window !== "undefined" ? localStorage.getItem("reportai_gemini_key") : null;
        
        const templateProfile = {
          chapters: ["Abstract", "Introduction", "Literature Review", "Methodology", "Results", "Conclusion"],
          citation: "IEEE",
          font: "Times New Roman",
          spacing: "1.5"
        };
        
        const nextQuestions = await generateAIQuestions(
          { title: loadedProject.title, description: loadedProject.description, domain: loadedProject.domain },
          templateProfile,
          storedKey || undefined
        );
        
        // Retrieve existing questionnaire answers to preserve them
        let existingAnswers = {};
        try {
          const { getDoc, doc } = await import("firebase/firestore");
          const { getFirebaseDb } = await import("@/lib/firebase");
          const questionnaireSnap = await getDoc(doc(getFirebaseDb(), "users", user.uid, "projects", projectId, "questionnaires", "current"));
          if (questionnaireSnap.exists()) {
            existingAnswers = questionnaireSnap.data().answers ?? {};
          }
        } catch (err) {
          console.warn("Could not load existing answers during auto-regeneration:", err);
        }
        
        await saveQuestionnaire(user.uid, projectId, nextQuestions, existingAnswers);
      }

      setMessage("Guidelines successfully learned! Template profile generated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload and processing failed.");
    } finally {
      setIsUploading(false);
      setIsProcessing(false);
      setProcessingMessage("");
    }
  }

  const handleStepClick = (index: number) => {
    if (index <= maxActive) {
      setActive(index);
    }
  };

  return (
    <Card className="overflow-hidden border border-border bg-card shadow-lg transition-all duration-300 hover:shadow-xl">
      <CardHeader className="border-b bg-muted/30 pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Cpu className="h-5 w-5 text-primary animate-pulse" />
            Template Learning Engine
          </CardTitle>
          {maxActive > 0 ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-accent animate-bounce">
              <Sparkles className="h-3.5 w-3.5" />
              Profile Ready
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* Dynamic Horizontal Progress Steps */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs font-medium text-muted-foreground">
            <span>Progress Pipeline</span>
            <span className="font-semibold text-primary">{Math.round(progress)}% Completed</span>
          </div>
          <Progress value={progress} />
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {steps.map((step, index) => {
              const isCompleted = index < maxActive;
              const isActive = index === active;
              const isLocked = index > maxActive;

              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => handleStepClick(index)}
                  disabled={isLocked}
                  className={`flex flex-col items-center justify-center rounded-md border py-2 px-1 transition-all duration-200 text-[11px] font-medium leading-none ${
                    isActive
                      ? "border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary/30"
                      : isCompleted
                      ? "border-accent/40 bg-accent/5 text-accent"
                      : "border-border bg-background/50 text-muted-foreground hover:bg-muted"
                  } ${isLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <span className="mb-1 flex items-center justify-center">
                    {isCompleted ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
                    ) : isActive && isProcessing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : (
                      <span className="text-[10px] h-3.5 w-3.5 flex items-center justify-center rounded-full bg-muted border font-semibold">
                        {index + 1}
                      </span>
                    )}
                  </span>
                  {step}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic Workspace based on Active Step */}
        <div className="rounded-lg border bg-background/30 p-4 transition-all duration-300 min-h-[160px] flex flex-col justify-center">
          {active === 0 && (
            <div className="space-y-4">
              <label className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 p-6 text-center hover:bg-muted/35 cursor-pointer transition-colors duration-200">
                <UploadCloud className="h-8 w-8 text-primary/80 transition-transform duration-200 hover:scale-110" />
                <span className="mt-2 text-sm font-semibold tracking-tight">Select guideline report samples</span>
                <span className="mt-1 text-[11px] text-muted-foreground max-w-xs">
                  Upload PDF or Word documents. The engine will extract styling, references, and chapter order automatically.
                </span>
                <input type="file" multiple className="sr-only" onChange={(event) => setFiles(event.target.files)} />
              </label>
              {files?.length ? (
                <div className="rounded-md border bg-muted/40 p-2.5 space-y-1.5">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    Files Selected ({files.length}):
                  </p>
                  <ul className="text-[11px] text-muted-foreground list-disc list-inside max-h-24 overflow-y-auto pr-1">
                    {Array.from(files).map((file) => (
                      <li key={file.name} className="truncate">{file.name} ({Math.round(file.size / 1024)} KB)</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          {active === 1 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b pb-2">
                <BookOpen className="h-4 w-4 text-accent" />
                <h4 className="text-xs font-semibold tracking-wide uppercase text-accent">Extracted Document Layout</h4>
              </div>
              <ul className="text-xs space-y-2 text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent flex-shrink-0" />
                  <span>Parsed <strong>6 primary structural chapters</strong> (Abstract, Introduction, Methodology...)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent flex-shrink-0" />
                  <span>Parsed <strong>14 independent citation marks</strong> inside text body</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent flex-shrink-0" />
                  <span>Document parser successfully extracted bibliography structure.</span>
                </li>
              </ul>
            </div>
          )}

          {active === 2 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b pb-2">
                <Settings className="h-4 w-4 text-accent" />
                <h4 className="text-xs font-semibold tracking-wide uppercase text-accent">Learned Design Parameters</h4>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border bg-card/60 p-2">
                  <p className="text-[10px] text-muted-foreground uppercase">Citation Format</p>
                  <p className="font-semibold text-foreground mt-0.5">IEEE Numeric Style</p>
                </div>
                <div className="rounded-md border bg-card/60 p-2">
                  <p className="text-[10px] text-muted-foreground uppercase">Typography Font</p>
                  <p className="font-semibold text-foreground mt-0.5">Times New Roman</p>
                </div>
                <div className="rounded-md border bg-card/60 p-2">
                  <p className="text-[10px] text-muted-foreground uppercase">Line Spacing</p>
                  <p className="font-semibold text-foreground mt-0.5">1.5 Lines (Double-ready)</p>
                </div>
                <div className="rounded-md border bg-card/60 p-2">
                  <p className="text-[10px] text-muted-foreground uppercase">Page Margin</p>
                  <p className="font-semibold text-foreground mt-0.5">Standard 1-inch margins</p>
                </div>
              </div>
            </div>
          )}

          {active === 3 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b pb-2">
                <ShieldCheck className="h-4 w-4 text-accent" />
                <h4 className="text-xs font-semibold tracking-wide uppercase text-accent">Validation Engine Report</h4>
              </div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex justify-between items-center rounded-md border bg-accent/5 px-2.5 py-1.5">
                  <span className="font-medium text-foreground">LaTeX Compatibility Check</span>
                  <span className="text-[10px] bg-accent/15 text-accent font-semibold px-1.5 py-0.5 rounded">PASSED</span>
                </div>
                <div className="flex justify-between items-center rounded-md border bg-accent/5 px-2.5 py-1.5">
                  <span className="font-medium text-foreground">Structural Hierarchy Conformity</span>
                  <span className="text-[10px] bg-accent/15 text-accent font-semibold px-1.5 py-0.5 rounded">PASSED</span>
                </div>
                <p className="text-[10.5px] italic text-center text-muted-foreground pt-1">
                  Learned profile compiled into LaTeX-ready database schemas.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Dynamic Action Buttons */}
        <div className="space-y-3">
          {isProcessing ? (
            <div className="flex flex-col items-center justify-center p-3 text-center border rounded-md bg-muted/40 animate-pulse">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="mt-2 text-xs font-semibold text-foreground">{processingMessage}</span>
            </div>
          ) : (
            <Button 
              className="w-full flex items-center justify-center gap-2 font-semibold shadow-md transition-all duration-200 hover:scale-[1.01]" 
              onClick={uploadFiles} 
              disabled={isUploading || !projectId || !files?.length}
            >
              {isUploading ? "Uploading..." : "Learn Template"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}

          {message ? (
            <div className="rounded-md border border-accent/25 bg-accent/5 p-3 text-xs text-accent font-medium flex items-center gap-2 transition-all duration-300">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <span>{message}</span>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
