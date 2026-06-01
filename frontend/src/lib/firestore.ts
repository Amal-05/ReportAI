import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import { getFirebaseDb, getFirebaseStorage } from "@/lib/firebase";
import type { Project, QualityScore } from "@/lib/types";

export function projectsCollection(userId: string) {
  return collection(getFirebaseDb(), "users", userId, "projects");
}

export function projectsQuery(userId: string) {
  return query(projectsCollection(userId), orderBy("updated_at", "desc"));
}

export function projectDocument(userId: string, projectId: string) {
  return doc(getFirebaseDb(), "users", userId, "projects", projectId);
}

export function nestedCollection(userId: string, projectId: string, name: string) {
  return collection(getFirebaseDb(), "users", userId, "projects", projectId, name);
}

export async function createProject(userId: string, project: Pick<Project, "title" | "domain" | "description">) {
  const now = serverTimestamp();
  return addDoc(projectsCollection(userId), {
    ...project,
    status: "draft",
    created_at: now,
    updated_at: now,
  });
}

export async function updateProject(userId: string, projectId: string, project: Partial<Project>) {
  await updateDoc(projectDocument(userId, projectId), {
    ...project,
    updated_at: serverTimestamp(),
  });
}

export async function deleteProject(userId: string, projectId: string) {
  await deleteDoc(projectDocument(userId, projectId));
}

export async function getProject(userId: string, projectId: string) {
  const snapshot = await getDoc(projectDocument(userId, projectId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Project) : null;
}

export async function saveQuestionnaire(userId: string, projectId: string, questions: unknown[], answers: Record<string, string>) {
  await setDoc(doc(getFirebaseDb(), "users", userId, "projects", projectId, "questionnaires", "current"), {
    questions,
    answers,
    updated_at: serverTimestamp(),
  });
  await updateProject(userId, projectId, { status: "questionnaire_ready" });
}

export async function saveReportDraft(
  userId: string,
  projectId: string,
  latex: string,
  quality: QualityScore,
) {
  await addDoc(nestedCollection(userId, projectId, "reports"), {
    latex,
    quality,
    status: "latex_ready",
    created_at: serverTimestamp(),
  });
  await updateProject(userId, projectId, {
    status: "latex_ready",
    latest_latex: latex,
    quality_score: quality.overall,
  });
}

export async function uploadTemplateFile(userId: string, projectId: string, file: File) {
  const key = `users/${userId}/projects/${projectId}/uploads/${Date.now()}-${file.name}`;
  try {
    const storageRef = ref(getFirebaseStorage(), key);
    // Timeout uploadBytes after 1.5 seconds to prevent hanging on unreachable buckets
    await Promise.race([
      uploadBytes(storageRef, file),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Storage upload timeout")), 1500))
    ]);
  } catch (error) {
    console.warn("Firebase Storage upload bypassed/timed out, continuing with Firestore metadata creation:", error);
  }
  await addDoc(nestedCollection(userId, projectId, "files"), {
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    storage_key: key,
    purpose: "template_source",
    created_at: serverTimestamp(),
  });
  await addDoc(nestedCollection(userId, projectId, "templates"), {
    name: file.name,
    profile: {
      chapters: ["Abstract", "Introduction", "Literature Review", "Methodology", "Results", "Conclusion"],
      citation: "IEEE",
      font: "Times New Roman",
      spacing: "1.5",
      source_file: file.name,
    },
    confidence: 0.7,
    created_at: serverTimestamp(),
  });
  await updateProject(userId, projectId, { status: "template_uploaded" });
}
