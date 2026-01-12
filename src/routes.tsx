import * as React from "react";
import {
  createBrowserRouter,
  redirect,
  Form,
  Link,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router-dom";
import { Root } from "./root.tsx";
import type { Project } from "./types.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { CodeEditor } from "@/components/code-editor.tsx";
import {
  clearDraft,
  getDraft,
  setDraft,
  type DraftRecord,
} from "@/lib/drafts.ts";

const SAVE_DEBOUNCE_MS = 500;
const SAVE_MAX_INTERVAL_MS = 5_000;
const DRAFT_DEBOUNCE_MS = 250;

async function projectsLoader() {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to load projects");
  return (await res.json()) as Project[];
}

async function projectLoader({ params }: LoaderFunctionArgs) {
  const projectId = params.projectId;
  if (!projectId) throw new Response("Not Found", { status: 404 });

  const res = await fetch(`/api/projects/${projectId}`);
  if (!res.ok) throw new Response("Not Found", { status: res.status });
  return (await res.json()) as Project;
}

async function createProjectAction(_args: ActionFunctionArgs) {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!res.ok) throw new Error("Failed to create project");
  const project = (await res.json()) as Project;
  return redirect(`/${project.id}`);
}

function Dashboard() {
  const projects = useLoaderData() as Project[];

  return (
    <section className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold">Your projects</h2>
        </div>
        <Form method="post">
          <Button type="submit">
            <Plus className="size-4" />
            Add project
          </Button>
        </Form>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <Link key={project.id} to={`/${project.id}`} className="block">
              <Card className="group transition hover:-translate-y-0.5 hover:shadow-md">
                <CardHeader>
                  <CardTitle className="text-xl">
                    {project.name || "Untitled Project"}
                  </CardTitle>
                  <CardDescription className="space-y-1">
                    <div>
                      Created {new Date(project.createdAt).toLocaleString()}
                    </div>
                    <div>
                      Updated {new Date(project.updatedAt).toLocaleString()}
                    </div>
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function IndexRedirect() {
  return null;
}

function ProjectView() {
  const project = useLoaderData() as Project;
  const [value, setValue] = React.useState(project.content);
  const [name, setName] = React.useState(project.name);
  const namePlaceholder = "Untitled Project";
  const [saveState, setSaveState] = React.useState<
    "idle" | "saving" | "error" | "conflict"
  >("idle");
  const [llmStatus, setLlmStatus] = React.useState({
    enabled: false,
    model: "",
  });
  const [llmUserEnabled, setLlmUserEnabled] = React.useState(true);
  const [restoreDraft, setRestoreDraft] = React.useState<DraftRecord | null>(null);
  const [conflictProject, setConflictProject] = React.useState<Project | null>(
    null
  );

  const latestValueRef = React.useRef(project.content);
  const latestNameRef = React.useRef(project.name);
  const baseRevisionRef = React.useRef(project.revision);
  const lastSavedRef = React.useRef(project.content);
  const lastSavedNameRef = React.useRef(project.name);
  const projectIdRef = React.useRef(project.id);
  const savingRef = React.useRef(false);
  const pendingSaveRef = React.useRef(false);
  const conflictRef = React.useRef<Project | null>(null);
  const flushRef = React.useRef<(reason: string) => void>(() => {});
  const scheduleSaveRef = React.useRef<() => void>(() => {});
  const debounceRef = React.useRef<number | null>(null);
  const maxFlushRef = React.useRef<number | null>(null);
  const draftTimerRef = React.useRef<number | null>(null);
  const llmStorageKey = "codenote:llm-enabled";

  const clearTimers = React.useCallback(() => {
    if (debounceRef.current) {
      globalThis.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (maxFlushRef.current) {
      globalThis.clearTimeout(maxFlushRef.current);
      maxFlushRef.current = null;
    }
  }, []);

  const scheduleDraftWrite = React.useCallback((draft: DraftRecord) => {
    if (draftTimerRef.current) {
      globalThis.clearTimeout(draftTimerRef.current);
    }

    draftTimerRef.current = globalThis.setTimeout(() => {
      void setDraft(draft).catch(() => {
        // no-op for local draft failures
      });
    }, DRAFT_DEBOUNCE_MS);
  }, []);

  const flush = React.useCallback(
    async (_reason: string) => {
      if (conflictRef.current) return;
      if (savingRef.current) return;

      const content = latestValueRef.current;
      const currentName = latestNameRef.current;
      if (
        content === lastSavedRef.current &&
        currentName === lastSavedNameRef.current
      ) {
        return;
      }

      savingRef.current = true;
      pendingSaveRef.current = false;
      clearTimers();
      setSaveState("saving");

      try {
        const res = await fetch(`/api/projects/${projectIdRef.current}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content,
            baseRevision: baseRevisionRef.current,
            name: currentName,
          }),
        });

        if (res.status === 409) {
          const latest = (await res.json()) as Project;
          conflictRef.current = latest;
          setConflictProject(latest);
          setSaveState("conflict");
          return;
        }

        if (!res.ok) {
          throw new Error(await res.text());
        }

        const updated = (await res.json()) as Project;
        baseRevisionRef.current = updated.revision;
        lastSavedRef.current = updated.content;
        lastSavedNameRef.current = updated.name;
        setSaveState("idle");
        if (
          latestValueRef.current === updated.content &&
          latestNameRef.current === updated.name
        ) {
          await clearDraft(projectIdRef.current).catch(() => {
            // no-op for draft cleanup failures
          });
        } else {
          scheduleDraftWrite({
            projectId: projectIdRef.current,
            content: latestValueRef.current,
            name: latestNameRef.current,
            updatedAt: new Date().toISOString(),
            baseRevision: baseRevisionRef.current,
          });
        }
      } catch {
        setSaveState("error");
      } finally {
        savingRef.current = false;
        if (pendingSaveRef.current && !conflictRef.current) {
          scheduleSaveRef.current();
        }
      }
    },
    [clearTimers, scheduleDraftWrite]
  );

  flushRef.current = flush;

  const scheduleServerSave = React.useCallback(() => {
    if (conflictRef.current) return;

    if (debounceRef.current) {
      globalThis.clearTimeout(debounceRef.current);
    }

    debounceRef.current = globalThis.setTimeout(() => {
      flushRef.current("debounce");
    }, SAVE_DEBOUNCE_MS);

    if (!maxFlushRef.current) {
      maxFlushRef.current = globalThis.setTimeout(() => {
        flushRef.current("max");
      }, SAVE_MAX_INTERVAL_MS);
    }
  }, []);

  scheduleSaveRef.current = scheduleServerSave;

  React.useEffect(() => {
    projectIdRef.current = project.id;
    baseRevisionRef.current = project.revision;
    lastSavedRef.current = project.content;
    lastSavedNameRef.current = project.name;
    latestValueRef.current = project.content;
    latestNameRef.current = project.name;
    conflictRef.current = null;
    savingRef.current = false;
    pendingSaveRef.current = false;
    setValue(project.content);
    setName(project.name);
    setSaveState("idle");
    setConflictProject(null);
    setRestoreDraft(null);
    clearTimers();

    void (async () => {
      try {
        const draft = await getDraft(project.id);
        if (!draft) return;

        const normalizedDraft = {
          ...draft,
          name: typeof draft.name === "string" ? draft.name : project.name,
        };

        if (
          normalizedDraft.content === project.content &&
          normalizedDraft.name === project.name
        ) {
          await clearDraft(project.id);
          return;
        }

        const draftTime = Date.parse(draft.updatedAt);
        const projectTime = Date.parse(project.updatedAt);

        if (Number.isNaN(draftTime) || draftTime <= projectTime) return;

        setRestoreDraft(normalizedDraft);
      } catch {
        // ignore draft load failures
      }
    })();
  }, [clearTimers, project.content, project.id, project.revision, project.updatedAt]);

  React.useEffect(() => {
    try {
      const stored = globalThis.localStorage?.getItem(llmStorageKey);
      if (stored === "true") setLlmUserEnabled(true);
      if (stored === "false") setLlmUserEnabled(false);
    } catch {
      // ignore storage failures
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(
      () => controller.abort(),
      5_000
    );
    let active = true;

    void (async () => {
      try {
        const res = await fetch("/api/ai/status", {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("status fetch failed");
        const data = (await res.json()) as {
          enabled?: boolean;
          model?: string;
        };
        if (!active) return;
        setLlmStatus({
          enabled: Boolean(data.enabled),
          model: data.model ?? "",
        });
      } catch {
        if (!active) return;
        setLlmStatus({ enabled: false, model: "" });
      } finally {
        globalThis.clearTimeout(timeoutId);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      globalThis.clearTimeout(timeoutId);
    };
  }, []);

  const handleToggleLlm = React.useCallback(() => {
    if (!llmStatus.enabled) return;
    setLlmUserEnabled((current) => {
      const next = !current;
      try {
        globalThis.localStorage?.setItem(llmStorageKey, String(next));
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, [llmStatus.enabled]);

  const isLlmActive = llmStatus.enabled && llmUserEnabled;

  React.useEffect(() => {
    latestValueRef.current = value;
    latestNameRef.current = name;
    if (
      value === lastSavedRef.current &&
      name === lastSavedNameRef.current
    ) {
      return;
    }

    scheduleDraftWrite({
      projectId: projectIdRef.current,
      content: value,
      name,
      updatedAt: new Date().toISOString(),
      baseRevision: baseRevisionRef.current,
    });

    if (conflictRef.current) return;
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    scheduleServerSave();
  }, [name, scheduleDraftWrite, scheduleServerSave, value]);

  React.useEffect(() => {
    const handlePageHide = () => {
      flushRef.current("pagehide");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handlePageHide();
      }
    };

    globalThis.addEventListener("pagehide", handlePageHide);
    globalThis.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      globalThis.removeEventListener("pagehide", handlePageHide);
      globalThis.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  React.useEffect(() => {
    return () => {
      flushRef.current("unmount");
    };
  }, []);

  const handleRestore = () => {
    if (!restoreDraft) return;
    setValue(restoreDraft.content);
    latestValueRef.current = restoreDraft.content;
    setName(restoreDraft.name);
    latestNameRef.current = restoreDraft.name;
    setRestoreDraft(null);
  };

  const handleDiscardDraft = () => {
    if (!restoreDraft) return;
    void clearDraft(projectIdRef.current);
    setRestoreDraft(null);
  };

  const handleReloadFromServer = () => {
    if (!conflictProject) return;
    conflictRef.current = null;
    baseRevisionRef.current = conflictProject.revision;
    lastSavedRef.current = conflictProject.content;
    lastSavedNameRef.current = conflictProject.name;
    latestValueRef.current = conflictProject.content;
    latestNameRef.current = conflictProject.name;
    setValue(conflictProject.content);
    setName(conflictProject.name);
    setConflictProject(null);
    setSaveState("idle");
    void clearDraft(projectIdRef.current);
  };

  const handleOverwriteServer = () => {
    if (!conflictProject) return;
    conflictRef.current = null;
    baseRevisionRef.current = conflictProject.revision;
    setConflictProject(null);
    setSaveState("idle");
    void flush("overwrite");
  };

  return (
    <section className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-baseline gap-1">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={namePlaceholder}
              aria-label="Project name"
              size={Math.max(name.length, namePlaceholder.length, 1)}
              className="h-auto w-auto flex-none border-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
            />
            <span className="text-sm italic text-muted-foreground">
              .ts (typescript)
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-pressed={isLlmActive}
            disabled={!llmStatus.enabled}
            onClick={handleToggleLlm}
            className={[
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition",
              isLlmActive
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-100 text-slate-500",
              llmStatus.enabled
                ? "cursor-pointer hover:border-emerald-200/70"
                : "cursor-not-allowed opacity-70",
            ].join(" ")}
          >
            {isLlmActive ? "AI autocomplete on" : "AI autocomplete off"}
          </button>
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Autosave on
          </span>
          {saveState === "error" ? (
            <Button size="sm" variant="secondary" onClick={() => void flush("retry")}>
              Retry
            </Button>
          ) : null}
        </div>
      </div>

      <CodeEditor
        value={value}
        onChange={setValue}
        onBlur={() => void flush("blur")}
        className="bg-card shadow-sm font-mono"
        language={project.language}
        enableLlm={isLlmActive}
      />

      <Dialog open={restoreDraft !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore local draft?</DialogTitle>
            <DialogDescription>
              A newer local draft was found in this browser. You can restore it or
              discard it and use the server version.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleDiscardDraft}>
              Discard
            </Button>
            <Button onClick={handleRestore}>Restore draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={conflictProject !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conflict detected</DialogTitle>
            <DialogDescription>
              This project changed in another tab. Choose whether to reload the
              server version or overwrite it with your local changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleReloadFromServer}>
              Reload server
            </Button>
            <Button onClick={handleOverwriteServer}>Overwrite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      {
        index: true,
        loader: () => redirect("/dashboard"),
        Component: IndexRedirect,
      },
      {
        path: "dashboard",
        loader: projectsLoader,
        action: createProjectAction,
        Component: Dashboard,
      },
      {
        path: ":projectId",
        loader: projectLoader,
        Component: ProjectView,
      },
    ],
  },
]);
