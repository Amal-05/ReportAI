"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, getDoc, collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { useAuth } from "@/components/auth-provider";
import { FirebaseConfigWarning } from "@/components/firebase-config-warning";
import { GenerationTimeline } from "@/components/generation-timeline";
import { QualityPanel } from "@/components/quality-panel";
import { UploadWizard } from "@/components/upload-wizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { deleteProject, getProject, saveQuestionnaire, saveReportDraft } from "@/lib/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { analyzeQuality, generateLatex, enhanceAnswersWithAI, generateLatexWithAI } from "@/lib/report-generation";
import { generateAIQuestions, generateFallbackQuestions } from "@/lib/ai-generator";
import type { Question } from "@/lib/questionnaire";
import type { Project, QualityScore } from "@/lib/types";
import { generateAndDownloadPdf } from "@/lib/pdf-generator";
import { FileDown, Settings, Sparkles, Loader2 } from "lucide-react";

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const { user, loading, configured } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [latex, setLatex] = useState("");
  const [quality, setQuality] = useState<QualityScore | null>(null);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const router = useRouter();

  async function loadProjectData() {
    if (!user) return;
    try {
      const loadedProject = await getProject(user.uid, projectId);
      if (!loadedProject) {
        setProject(null);
        return;
      }
      setProject(loadedProject);
      setLatex(loadedProject.latest_latex ?? "");
      if (loadedProject.quality_score) {
        const score = loadedProject.quality_score;
        setQuality({
          grammar: score,
          readability: score,
          technical_depth: score,
          formatting_quality: score,
          citation_quality: score,
          overall: score,
          suggestions: ["Open the generated LaTeX and improve content depth, citations, and diagrams."],
        });
      }

      const questionnaire = await getDoc(doc(getFirebaseDb(), "users", user.uid, "projects", projectId, "questionnaires", "current"));
      if (questionnaire.exists()) {
        const qData = questionnaire.data();
        setAnswers((qData.answers ?? {}) as Record<string, string>);
        if (qData.questions && Array.isArray(qData.questions) && qData.questions.length > 0) {
          setQuestions(qData.questions);
        } else {
          const fallbackQs = generateFallbackQuestions(loadedProject.title, loadedProject.description, loadedProject.domain);
          setQuestions(fallbackQs);
        }
      } else {
        const fallbackQs = generateFallbackQuestions(loadedProject.title, loadedProject.description, loadedProject.domain);
        setQuestions(fallbackQs);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load project.");
    }
  }

  useEffect(() => {
    if (!user) return;
    setProjectLoading(true);
    loadProjectData().finally(() => {
      setProjectLoading(false);
    });
  }, [projectId, user]);

  async function saveAnswers() {
    if (!user || !project) return;
    setIsSaving(true);
    try {
      await saveQuestionnaire(user.uid, project.id, questions, answers);
      setProject({ ...project, status: "questionnaire_ready" });
      setMessage("Questionnaire saved to Firebase.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save answers.");
    } finally {
      setIsSaving(false);
    }
  }

  async function triggerAiQuestionGeneration() {
    if (!user || !project) return;
    setIsGeneratingQuestions(true);
    setMessage("");
    try {
      let templateProfile: any = undefined;
      try {
        const templatesSnap = await getDocs(
          query(collection(getFirebaseDb(), "users", user.uid, "projects", project.id, "templates"), orderBy("created_at", "desc"), limit(1))
        );
        if (!templatesSnap.empty) {
          templateProfile = templatesSnap.docs[0].data().profile;
        }
      } catch (err) {
        console.warn("Could not load template profile for AI questions:", err);
      }

      const nextQuestions = await generateAIQuestions(
        { title: project.title, description: project.description, domain: project.domain },
        templateProfile
      );

      setQuestions(nextQuestions);
      await saveQuestionnaire(user.uid, project.id, nextQuestions, answers);
      setMessage("Questionnaire successfully customized matching your project layout!");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to generate questions.");
    } finally {
      setIsGeneratingQuestions(false);
    }
  }

  async function enhanceAnswers() {
    if (!user || !project) return;
    setIsSaving(true);
    setMessage("AI is enhancing your questionnaire answers and removing NIL responses...");
    try {
      const nextAnswers = await enhanceAnswersWithAI(answers, questions, project);
      setAnswers(nextAnswers);
      await saveQuestionnaire(user.uid, project.id, questions, nextAnswers);
      setMessage("Questionnaire answers successfully enhanced by AI and saved!");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enhance answers.");
    } finally {
      setIsSaving(false);
    }
  }

  async function generateReport() {
    if (!user || !project) return;
    setIsSaving(true);
    setMessage("AI is analyzing your details and dynamically drafting your LaTeX report...");
    try {
      let templateProfile: any = undefined;
      try {
        const templatesSnap = await getDocs(
          query(collection(getFirebaseDb(), "users", user.uid, "projects", project.id, "templates"), orderBy("created_at", "desc"), limit(1))
        );
        if (!templatesSnap.empty) {
          templateProfile = templatesSnap.docs[0].data().profile;
        }
      } catch (err) {
        console.warn("Could not load template profile for AI report generation:", err);
      }

      const nextLatex = await generateLatexWithAI(project, answers, questions, templateProfile);
      const nextQuality = analyzeQuality(nextLatex, 0);
      await saveReportDraft(user.uid, project.id, nextLatex, nextQuality);
      setLatex(nextLatex);
      setQuality(nextQuality);
      setProject({ ...project, status: "latex_ready", latest_latex: nextLatex, quality_score: nextQuality.overall });
      setMessage("Report draft dynamically generated and quality score saved to Firebase.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate report.");
    } finally {
      setIsSaving(false);
    }
  }


  async function downloadPdf() {
    if (!user || !project || !latex) return;
    setIsSaving(true);
    try {
      generateAndDownloadPdf(project.title, latex);
      // Update status to compiled in Firebase
      await saveReportDraft(user.uid, project.id, latex, quality ?? {
        grammar: 84,
        readability: 82,
        technical_depth: 75,
        formatting_quality: 90,
        citation_quality: 45,
        overall: 75,
        suggestions: []
      });
      setProject({ ...project, status: "compiled" });
      setMessage("LaTeX compiled successfully and PDF downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not compile PDF.");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeProject() {
    if (!user || !project) return;
    await deleteProject(user.uid, project.id);
    router.push("/dashboard");
  }

  if (!configured) return <FirebaseConfigWarning />;
  if (loading || (user && projectLoading)) return <p className="text-sm text-muted-foreground">Loading project...</p>;
  if (!user) {
    return (
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">Log in to open this project.</p>
          <Button className="mt-4" asChild>
            <Link href="/login">Login</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!project) return <p className="text-sm text-muted-foreground">{message || "Project not found."}</p>;

  return (
    <>
      <header className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold">{project.title}</h1>
            <Badge>{project.status}</Badge>
          </div>
          <p className="mt-2 text-muted-foreground">{project.description}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={removeProject}>Delete</Button>
          {latex ? (
            <Button onClick={downloadPdf} disabled={isSaving} className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 shadow-sm font-semibold">
              <FileDown className="h-4 w-4" />
              {isSaving ? "Compiling..." : "Download PDF"}
            </Button>
          ) : null}
          <Button onClick={generateReport} disabled={isSaving}>{isSaving ? "Working..." : "Generate Report"}</Button>
        </div>
      </header>

      {message ? <p className="mt-4 rounded-md border bg-card p-3 text-sm text-muted-foreground">{message}</p> : null}

      <section className="mt-6 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card className="overflow-hidden border border-border bg-card shadow-md">
            <CardHeader className="border-b bg-muted/20 pb-4">
              <div>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-accent animate-pulse" />
                  Adaptive Questionnaire
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">AI-generated topics specific to your project design</p>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {questions.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 border border-dashed rounded-md bg-muted/10">
                  <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
                  <p className="text-xs text-muted-foreground">Initializing questionnaire questions...</p>
                </div>
              ) : (
                questions.map((question) => (
                  <label key={question.id} className="block space-y-2">
                    <span className="text-sm font-semibold text-foreground flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/75" />
                      {question.label}
                    </span>
                    <Textarea
                      value={answers[question.id] ?? ""}
                      onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                      placeholder="Enter project-specific answer..."
                      className="bg-background/50 hover:bg-background/80 focus:bg-background transition-colors duration-150 min-h-20 text-sm"
                    />
                  </label>
                ))
              )}
              <div className="pt-2 flex flex-wrap gap-2">
                <Button onClick={saveAnswers} disabled={isSaving} className="font-semibold shadow-sm">
                  {isSaving ? "Saving..." : "Save Answers"}
                </Button>
                <Button 
                  variant="outline"
                  onClick={enhanceAnswers}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 text-xs font-semibold"
                >
                  <Sparkles className="h-3.5 w-3.5 text-accent animate-pulse" />
                  Auto-Enhance with AI
                </Button>
                <Button 
                  variant="outline" 
                  onClick={triggerAiQuestionGeneration} 
                  disabled={isGeneratingQuestions} 
                  className="flex items-center gap-1 text-xs border-dashed font-medium text-muted-foreground hover:text-foreground"
                >
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  Regenerate Questions
                </Button>
              </div>
            </CardContent>
          </Card>
          {latex ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Generated LaTeX Draft</CardTitle>
                <Button variant="outline" size="sm" onClick={downloadPdf} className="flex items-center gap-1.5 text-xs font-semibold">
                  <FileDown className="h-3.5 w-3.5 text-accent" />
                  Compile & Download PDF
                </Button>
              </CardHeader>
              <CardContent>
                <Textarea value={latex} onChange={(event) => setLatex(event.target.value)} className="min-h-80 font-mono" />
              </CardContent>
            </Card>
          ) : null}
          <QualityPanel score={quality} />
        </div>
        <div className="space-y-5">
          <UploadWizard projectId={project.id} onSuccess={loadProjectData} />
          <GenerationTimeline status={project.status} />
        </div>
      </section>
    </>
  );
}
