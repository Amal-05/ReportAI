"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/components/auth-provider";
import { FirebaseConfigWarning } from "@/components/firebase-config-warning";
import { GenerationTimeline } from "@/components/generation-timeline";
import { QualityPanel } from "@/components/quality-panel";
import { UploadWizard } from "@/components/upload-wizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { deleteProject, getProject, saveQuestionnaire, saveReportDraft } from "@/lib/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { analyzeQuality, generateLatex } from "@/lib/report-generation";
import { questionsForDomain } from "@/lib/questionnaire";
import type { Project, QualityScore } from "@/lib/types";

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const { user, loading, configured } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [latex, setLatex] = useState("");
  const [quality, setQuality] = useState<QualityScore | null>(null);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  const questions = useMemo(() => questionsForDomain(project?.domain ?? ""), [project?.domain]);

  useEffect(() => {
    if (!user) return;
    const userId = user.uid;
    let cancelled = false;
    setProjectLoading(true);

    async function load() {
      try {
        const loadedProject = await getProject(userId, projectId);
        if (cancelled) return;
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

        const questionnaire = await getDoc(doc(getFirebaseDb(), "users", userId, "projects", projectId, "questionnaires", "current"));
        if (questionnaire.exists() && !cancelled) {
          setAnswers((questionnaire.data().answers ?? {}) as Record<string, string>);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Could not load project.");
        }
      } finally {
        if (!cancelled) {
          setProjectLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
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

  async function generateReport() {
    if (!user || !project) return;
    setIsSaving(true);
    try {
      const nextLatex = generateLatex(project, answers);
      const nextQuality = analyzeQuality(nextLatex, 0);
      await saveReportDraft(user.uid, project.id, nextLatex, nextQuality);
      setLatex(nextLatex);
      setQuality(nextQuality);
      setProject({ ...project, status: "latex_ready", latest_latex: nextLatex, quality_score: nextQuality.overall });
      setMessage("Report draft and quality score saved to Firebase.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate report.");
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
          <Button onClick={generateReport} disabled={isSaving}>{isSaving ? "Working..." : "Generate Report"}</Button>
        </div>
      </header>

      {message ? <p className="mt-4 rounded-md border bg-card p-3 text-sm text-muted-foreground">{message}</p> : null}

      <section className="mt-6 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Adaptive Questionnaire</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {questions.map((question) => (
                <label key={question.id} className="block">
                  <span className="mb-2 block text-sm font-medium">{question.label}</span>
                  <Textarea
                    value={answers[question.id] ?? ""}
                    onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                    placeholder="Enter project-specific answer..."
                  />
                </label>
              ))}
              <Button onClick={saveAnswers} disabled={isSaving}>Save answers</Button>
            </CardContent>
          </Card>
          {latex ? (
            <Card>
              <CardHeader>
                <CardTitle>Generated LaTeX Draft</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea value={latex} onChange={(event) => setLatex(event.target.value)} className="min-h-80 font-mono" />
              </CardContent>
            </Card>
          ) : null}
          <QualityPanel score={quality} />
        </div>
        <div className="space-y-5">
          <UploadWizard projectId={project.id} />
          <GenerationTimeline status={project.status} />
        </div>
      </section>
    </>
  );
}
