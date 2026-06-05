import { AppShell } from "@/components/app-shell";
import { ProjectWorkspace } from "@/components/project-workspace";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-5 py-6">
        <ProjectWorkspace projectId={id} />
      </div>
    </AppShell>
  );
}
