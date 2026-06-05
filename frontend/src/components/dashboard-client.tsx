"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { onSnapshot } from "firebase/firestore";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { useAuth } from "@/components/auth-provider";
import { FirebaseConfigWarning } from "@/components/firebase-config-warning";
import { GenerationTimeline } from "@/components/generation-timeline";
import { MetricCard } from "@/components/metric-card";
import { ProjectCard } from "@/components/project-card";
import { ProjectForm } from "@/components/project-form";
import { QualityPanel } from "@/components/quality-panel";
import { UploadWizard } from "@/components/upload-wizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getFirebaseAuth } from "@/lib/firebase";
import { projectsQuery, getUserProfile, saveUserProfile, uploadAvatar } from "@/lib/firestore";
import type { Project, QualityScore } from "@/lib/types";
import { updateProfile, updateEmail } from "firebase/auth";
import { Camera, User, Mail, Building2, GraduationCap, Briefcase, Upload, Loader2, Sun, Moon, Palette } from "lucide-react";



function SettingsView({ user }: { user: any }) {
  const [apiKey, setApiKey] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const router = useRouter();

  // Theme states
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [accentTheme, setAccentTheme] = useState<"ocean" | "emerald" | "royal">("ocean");

  useEffect(() => {
    const savedKey = localStorage.getItem("reportai_custom_api_key") || "";
    setApiKey(savedKey);

    // Load theme settings
    const savedTheme = localStorage.getItem("reportai_theme") || "light";
    const savedAccent = localStorage.getItem("reportai_accent") || "ocean";
    setThemeMode(savedTheme as "light" | "dark");
    setAccentTheme(savedAccent as "ocean" | "emerald" | "royal");
  }, []);

  const handleSaveKey = () => {
    localStorage.setItem("reportai_custom_api_key", apiKey.trim());
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleSignOut = async () => {
    try {
      await signOut(getFirebaseAuth());
      localStorage.removeItem("reportai_custom_api_key");
      router.push("/login");
    } catch (err) {
      console.error("Sign out failed", err);
    }
  };

  const changeThemeMode = (mode: "light" | "dark") => {
    setThemeMode(mode);
    localStorage.setItem("reportai_theme", mode);
    if (mode === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const changeAccentTheme = (accent: "ocean" | "emerald" | "royal") => {
    setAccentTheme(accent);
    localStorage.setItem("reportai_accent", accent);
    
    // Remove existing accent classes
    document.documentElement.classList.remove("theme-emerald", "theme-royal");
    
    // Add new accent class
    if (accent === "emerald") {
      document.documentElement.classList.add("theme-emerald");
    } else if (accent === "royal") {
      document.documentElement.classList.add("theme-royal");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border border-border bg-card shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" /> Theme & Appearance
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Customize the platform's visual appearance and color accents.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Light/Dark Toggle */}
          <div className="space-y-2.5">
            <label className="text-sm font-semibold text-muted-foreground block uppercase tracking-wider">Interface Mode</label>
            <div className="grid grid-cols-2 gap-4 max-w-md">
              <button
                type="button"
                onClick={() => changeThemeMode("light")}
                className={`flex items-center justify-center gap-2.5 rounded-lg border-2 p-3.5 transition-all text-sm font-medium ${
                  themeMode === "light"
                    ? "border-primary bg-primary/5 text-primary shadow-sm"
                    : "border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <Sun className="h-4.5 w-4.5" /> Light Mode
              </button>
              <button
                type="button"
                onClick={() => changeThemeMode("dark")}
                className={`flex items-center justify-center gap-2.5 rounded-lg border-2 p-3.5 transition-all text-sm font-medium ${
                  themeMode === "dark"
                    ? "border-primary bg-primary/5 text-primary shadow-sm"
                    : "border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <Moon className="h-4.5 w-4.5" /> Dark Mode
              </button>
            </div>
          </div>

          {/* Accent Color Palette Toggle */}
          <div className="space-y-2.5">
            <label className="text-sm font-semibold text-muted-foreground block uppercase tracking-wider">Accent Theme</label>
            <div className="grid grid-cols-3 gap-4 max-w-lg">
              {/* Ocean Blue */}
              <button
                type="button"
                onClick={() => changeAccentTheme("ocean")}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all ${
                  accentTheme === "ocean" ? "border-primary bg-primary/5 shadow-sm font-semibold" : "border-border bg-card hover:bg-muted text-muted-foreground"
                }`}
              >
                <div className="h-6 w-6 rounded-full bg-blue-600 border border-black/10" />
                <span className="text-xs">Ocean Blue</span>
              </button>
              
              {/* Emerald Green */}
              <button
                type="button"
                onClick={() => changeAccentTheme("emerald")}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all ${
                  accentTheme === "emerald" ? "border-primary bg-primary/5 shadow-sm font-semibold" : "border-border bg-card hover:bg-muted text-muted-foreground"
                }`}
              >
                <div className="h-6 w-6 rounded-full bg-emerald-600 border border-black/10" />
                <span className="text-xs">Forest Emerald</span>
              </button>
              
              {/* Royal Purple */}
              <button
                type="button"
                onClick={() => changeAccentTheme("royal")}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all ${
                  accentTheme === "royal" ? "border-primary bg-primary/5 shadow-sm font-semibold" : "border-border bg-card hover:bg-muted text-muted-foreground"
                }`}
              >
                <div className="h-6 w-6 rounded-full bg-purple-600 border border-black/10" />
                <span className="text-xs">Royal Purple</span>
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border bg-card shadow-md">
        <CardHeader>
          <CardTitle>OpenAI/Gemini API Key</CardTitle>
          <p className="text-sm text-muted-foreground">
            Configure your personal OpenAI-compatible or Gemini API key. This key will be forwarded to the backend to perform AI tasks.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="api-key" className="text-sm font-medium leading-none">API Key</label>
            <Input
              id="api-key"
              type="password"
              placeholder="AIzaSy... (Gemini) or sk-... (OpenAI)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              If left blank, the platform will use the system's default API key (if configured).
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleSaveKey}>Save Key</Button>
            {isSaved && <span className="text-sm text-green-500 font-medium">✓ Saved successfully!</span>}
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border bg-card shadow-md">
        <CardHeader>
          <CardTitle>Account Details</CardTitle>
          <p className="text-sm text-muted-foreground">Your authenticated account credentials and profile</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <span className="text-xs font-semibold text-muted-foreground block">EMAIL ADDRESS</span>
            <span className="text-sm font-medium text-foreground">{user?.email || "Not available"}</span>
          </div>
          <div>
            <span className="text-xs font-semibold text-muted-foreground block">USER UID</span>
            <span className="text-sm font-mono text-foreground">{user?.uid || "Not available"}</span>
          </div>
          <div className="pt-2">
            <Button variant="outline" className="text-red-500 hover:text-red-600 border-red-200 hover:bg-red-50" onClick={handleSignOut}>
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Preset premium academic avatars (nice SVG gradients or simple illustrations)
const PRESET_AVATARS = [
  "https://api.dicebear.com/7.x/bottts/svg?seed=Academic1",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Researcher2",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Student1",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Professor2",
  "https://api.dicebear.com/7.x/identicon/svg?seed=LabTech3",
  "https://api.dicebear.com/7.x/pixel-art/svg?seed=Scholar",
];

function ProfileView({ user }: { user: any }) {
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [email, setEmail] = useState(user?.email || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.photoURL || PRESET_AVATARS[0]);
  const [institution, setInstitution] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("");
  const [bio, setBio] = useState("");
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    async function loadProfile() {
      if (!user) return;
      try {
        const profile = await getUserProfile(user.uid);
        if (profile) {
          if (profile.displayName) setDisplayName(profile.displayName);
          if (profile.email) setEmail(profile.email);
          if (profile.avatarUrl) setAvatarUrl(profile.avatarUrl);
          if (profile.institution) setInstitution(profile.institution);
          if (profile.department) setDepartment(profile.department);
          if (profile.role) setRole(profile.role);
          if (profile.bio) setBio(profile.bio);
        }
      } catch (err) {
        console.error("Failed to load user profile", err);
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [user]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setSaving(true);
      const url = await uploadAvatar(user.uid, file);
      setAvatarUrl(url);
      setSaveStatus({ type: "success", message: "Avatar uploaded successfully!" });
    } catch (err: any) {
      console.error(err);
      setSaveStatus({ type: "error", message: err.message || "Failed to upload avatar." });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveStatus(null);
    try {
      // 1. Update Firebase Auth Profile (Name & Avatar)
      if (displayName !== user?.displayName || avatarUrl !== user?.photoURL) {
        await updateProfile(user, {
          displayName: displayName.trim(),
          photoURL: avatarUrl,
        });
      }

      // 2. Update Firebase Auth Email if changed
      if (email.trim().toLowerCase() !== user?.email?.toLowerCase()) {
        try {
          await updateEmail(user, email.trim());
        } catch (authErr: any) {
          if (authErr.code === "auth/requires-recent-login") {
            throw new Error("Updating email requires a recent login session. Please sign out and sign back in, then try again.");
          }
          throw authErr;
        }
      }

      // 3. Save profile to Firestore
      await saveUserProfile(user.uid, {
        displayName: displayName.trim(),
        email: email.trim(),
        avatarUrl,
        institution: institution.trim(),
        department: department.trim(),
        role: role.trim(),
        bio: bio.trim(),
      });

      setSaveStatus({ type: "success", message: "Profile saved successfully!" });
    } catch (err: any) {
      console.error("Failed to save profile", err);
      setSaveStatus({ type: "error", message: err.message || "Failed to update profile." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-sm text-muted-foreground">Loading profile...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <Card className="border border-border bg-card shadow-md">
        <CardHeader>
          <CardTitle>User Profile</CardTitle>
          <p className="text-sm text-muted-foreground">
            Manage your personal profile, institutional affiliations, and display settings.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveProfile} className="space-y-6">
            {/* Avatar Section */}
            <div className="space-y-3">
              <label className="text-sm font-semibold text-muted-foreground block uppercase tracking-wider">Avatar / Profile Picture</label>
              <div className="flex flex-col sm:flex-row items-center gap-6 p-4 rounded-lg bg-muted/30 border border-muted/50">
                <div className="relative h-24 w-24 rounded-full overflow-hidden border-2 border-primary/20 bg-card group shadow-inner">
                  <img
                    src={avatarUrl}
                    alt="User Avatar"
                    className="h-full w-full object-cover transition-opacity duration-200"
                  />
                  <label className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer">
                    <Camera className="h-6 w-6 text-white" />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarUpload}
                    />
                  </label>
                </div>
                <div className="flex-1 space-y-3 w-full">
                  <span className="text-xs text-muted-foreground font-medium block">Choose from premium default presets:</span>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_AVATARS.map((url, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setAvatarUrl(url)}
                        className={`h-10 w-10 rounded-full overflow-hidden border-2 transition-all ${
                          avatarUrl === url ? "border-primary ring-2 ring-primary/20 scale-105" : "border-transparent hover:scale-105"
                        }`}
                      >
                        <img src={url} alt={`Preset ${idx + 1}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                  <div className="pt-1">
                    <label className="text-xs text-muted-foreground hover:underline cursor-pointer flex items-center gap-1.5">
                      <Upload className="h-3 w-3" />
                      <span>Upload custom picture (PNG, JPG)</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleAvatarUpload}
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Core Fields */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="displayName" className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                  <User className="h-4 w-4" /> Full Name
                </label>
                <Input
                  id="displayName"
                  type="text"
                  placeholder="e.g. Jane Doe"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Mail className="h-4 w-4" /> Email Address
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="e.g. jane.doe@university.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Affiliations / Academic details */}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="institution" className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Building2 className="h-4 w-4" /> Institution
                </label>
                <Input
                  id="institution"
                  type="text"
                  placeholder="e.g. Stanford University"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="department" className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                  <GraduationCap className="h-4 w-4" /> Department
                </label>
                <Input
                  id="department"
                  type="text"
                  placeholder="e.g. Computer Science"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="role" className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4" /> Academic Role
                </label>
                <select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Select a role...</option>
                  <option value="Student">Student (Undergrad/Postgrad)</option>
                  <option value="PhD Candidate">PhD Candidate / Researcher</option>
                  <option value="Postdoc">Postdoctoral Scholar</option>
                  <option value="Lecturer">Lecturer / Instructor</option>
                  <option value="Professor">Professor / Faculty</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            {/* Bio Field */}
            <div className="space-y-2">
              <label htmlFor="bio" className="text-sm font-semibold text-muted-foreground">
                Biography / Research Focus
              </label>
              <textarea
                id="bio"
                placeholder="Write a brief overview of your current academic focus or projects..."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {/* Action buttons & feedback */}
            <div className="flex items-center gap-4 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Profile"
                )}
              </Button>

              {saveStatus && (
                <span className={`text-sm font-medium ${saveStatus.type === "success" ? "text-green-500" : "text-red-500"}`}>
                  {saveStatus.type === "success" ? "✓" : "✗"} {saveStatus.message}
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function DashboardContent() {
  const { user, loading, configured } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "dashboard";

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      projectsQuery(user.uid),
      (snapshot) => {
        setProjects(snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as Project));
        setError("");
      },
      (nextError) => setError(nextError.message),
    );
  }, [user]);

  const score = useMemo<QualityScore | null>(() => {
    const scores = projects.map((project) => project.quality_score).filter((value): value is number => typeof value === "number");
    if (!scores.length) return null;
    const average = Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
    return {
      grammar: average,
      readability: average,
      technical_depth: average,
      formatting_quality: average,
      citation_quality: average,
      overall: average,
      suggestions: ["Open each project to improve questionnaire answers, citations, and generated LaTeX."],
    };
  }, [projects]);

  if (!configured) {
    return <FirebaseConfigWarning />;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading account...</p>;
  }

  if (!user) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <h2 className="text-lg font-semibold">Sign in required</h2>
        <p className="mt-2 text-sm text-muted-foreground">Log in to create projects and store reports in Firebase.</p>
        <Button className="mt-4" asChild>
          <Link href="/login">Login</Link>
        </Button>
      </div>
    );
  }

  if (activeTab === "settings") {
    return <SettingsView user={user} />;
  }

  if (activeTab === "profile") {
    return <ProfileView user={user} />;
  }

  if (activeTab === "quality") {
    return (
      <div className="space-y-6">
        <section className="grid gap-4 md:grid-cols-1">
          <MetricCard label="Average quality score across projects" value={score ? String(score.overall) : "-"} detail="Calculated from all active LaTeX draft compile metrics" />
        </section>
        <div className="max-w-4xl">
          <QualityPanel score={score} />
        </div>
      </div>
    );
  }

  return (
    <>
      {error ? <p className="mb-4 rounded-md border bg-card p-3 text-sm text-muted-foreground">{error}</p> : null}
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Active projects" value={String(projects.length)} detail="Stored in your Firebase account" />
        <MetricCard label="Templates learned" value={String(projects.filter((project) => project.status !== "draft").length)} detail="Uploaded and saved as template profiles" />
        <MetricCard label="Average quality" value={score ? String(score.overall) : "-"} detail="Calculated from generated drafts" />
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {projects.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-lg font-semibold">No projects yet</h2>
              <p className="mt-2 text-sm text-muted-foreground">Create your first project and it will appear here instantly from Firestore.</p>
            </div>
          )}
          <QualityPanel score={score} />
        </div>
        <div className="space-y-5">
          <ProjectForm userId={user.uid} />
          <UploadWizard projectId={projects[0]?.id} />
          <GenerationTimeline status={projects[0]?.status} />
        </div>
      </section>
    </>
  );
}

export function DashboardClient() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading dashboard...</p>}>
      <DashboardContent />
    </Suspense>
  );
}
