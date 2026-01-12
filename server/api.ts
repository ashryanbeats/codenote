import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { projectSnapshots, projects } from "../db/schema.ts";

const DEFAULT_LANGUAGE = "typescript";
const DEFAULT_CONTENT = "// Start typing in Codenote\n";
const SNAPSHOT_INTERVAL_MS = 30_000;
const SNAPSHOT_EVERY_N_REVISIONS = 10;
const DEFAULT_OPENAI_MODEL = "gpt-5.1-codex-mini";
const OPENAI_API_URL = "https://api.openai.com/v1/responses";

type OpenAiResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

async function maybeSnapshot(projectId: string, revision: number, content: string) {
  const [latest] = await db
    .select({ createdAt: projectSnapshots.createdAt })
    .from(projectSnapshots)
    .where(eq(projectSnapshots.projectId, projectId))
    .orderBy(desc(projectSnapshots.createdAt))
    .limit(1);

  const now = Date.now();
  const lastSnapshotAt = latest ? new Date(latest.createdAt).getTime() : 0;
  const shouldSnapshot =
    !latest ||
    now - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS ||
    revision % SNAPSHOT_EVERY_N_REVISIONS === 0;

  if (!shouldSnapshot) return;

  await db.insert(projectSnapshots).values({
    id: crypto.randomUUID(),
    projectId,
    revision,
    content,
  });
}

export async function handleApi(req: Request): Promise<Response | null> {
  const url = new URL(req.url);

  if (!url.pathname.startsWith("/api/")) return null;

  // GET /api/health
  if (req.method === "GET" && url.pathname === "/api/health") {
    return Response.json({ ok: true });
  }

  // GET /api/ai/status
  if (req.method === "GET" && url.pathname === "/api/ai/status") {
    const model = Deno.env.get("OPENAI_MODEL") ?? DEFAULT_OPENAI_MODEL;
    const enabled = Boolean(Deno.env.get("OPENAI_API_KEY"));
    return Response.json({ enabled, model });
  }

  // POST /api/ai/completions
  if (req.method === "POST" && url.pathname === "/api/ai/completions") {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return Response.json(
        { error: "OPENAI_API_KEY is not set" },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const prefix = typeof body?.prefix === "string" ? body.prefix : null;
    const suffix = typeof body?.suffix === "string" ? body.suffix : "";
    const language =
      typeof body?.language === "string" && body.language.trim()
        ? body.language.trim()
        : DEFAULT_LANGUAGE;
    const requestedMaxTokens =
      typeof body?.maxTokens === "number" && Number.isFinite(body.maxTokens)
        ? Math.floor(body.maxTokens)
        : 256;
    const maxTokens = Math.max(64, Math.min(512, requestedMaxTokens));

    if (prefix === null) {
      return Response.json(
        { error: "prefix is required" },
        { status: 400 }
      );
    }

    const prompt = [
      `Language: ${language}`,
      "Complete the code at the cursor.",
      "Return only the completion text, keep it short (<= 1 line).",
      "Prefix:",
      "<<<",
      prefix,
      ">>>",
      "Suffix:",
      "<<<",
      suffix,
      ">>>",
    ].join("\n");

    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), 15_000);

    try {
      const model = Deno.env.get("OPENAI_MODEL") ?? DEFAULT_OPENAI_MODEL;
      const res = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          instructions:
            "You are a code completion engine. Return only the completion text.",
          input: prompt,
          reasoning: {
            effort: "low",
          },
          text: {
            format: {
              type: "text",
            },
            verbosity: "medium",
          },
          store: false,
          max_output_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        console.error("OpenAI request failed", {
          status: res.status,
          statusText: res.statusText,
          model,
          detail: errorText,
        });
        return Response.json(
          { error: "OpenAI request failed", detail: errorText, status: res.status },
          { status: 502 }
        );
      }

      const rawText = await res.text();
      let data: OpenAiResponse | null = null;
      try {
        data = JSON.parse(rawText) as OpenAiResponse;
      } catch {
        console.error("OpenAI response was not JSON", {
          model,
          raw: rawText.slice(0, 500),
        });
      }

      const choiceText = (data as unknown as {
        choices?: Array<{ message?: { content?: string }; text?: string }>;
      })?.choices
        ?.map((choice) => choice.message?.content ?? choice.text ?? "")
        .join("");

      const outputText =
        data?.output_text ??
        data?.output
          ?.flatMap((item) => item.content ?? [])
          .filter(
            (part) =>
              typeof part.text === "string" &&
              (!part.type || part.type === "output_text" || part.type === "text")
          )
          .map((part) => part.text ?? "")
          .join("") ??
        choiceText ??
        "";

      const isIncomplete =
        (data as { status?: string })?.status === "incomplete" &&
        (data as { incomplete_details?: { reason?: string } })?.incomplete_details
          ?.reason === "max_output_tokens";

      if (!outputText.trim()) {
        console.warn("OpenAI returned empty output", {
          model,
          raw: rawText.slice(0, 1000),
        });
      }

      return Response.json({ completionText: outputText });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "OpenAI request failed";
      console.error("OpenAI request threw", {
        model: Deno.env.get("OPENAI_MODEL") ?? DEFAULT_OPENAI_MODEL,
        error: message,
      });
      return Response.json({ error: message }, { status: 502 });
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  // GET /api/projects
  if (req.method === "GET" && url.pathname === "/api/projects") {
    const rows = await db
      .select()
      .from(projects)
      .orderBy(desc(projects.updatedAt));
    return Response.json(rows);
  }

  // POST /api/projects
  if (req.method === "POST" && url.pathname === "/api/projects") {
    const body = await req.json().catch(() => ({}));
    const name =
      typeof body?.name === "string" && body.name.trim()
        ? body.name.trim()
        : "Untitled Project";

    const [inserted] = await db
      .insert(projects)
      .values({
        id: crypto.randomUUID(),
        name,
        language: DEFAULT_LANGUAGE,
        content: DEFAULT_CONTENT,
        revision: 0,
      })
      .returning();
    return Response.json(inserted, { status: 201 });
  }

  // GET /api/projects/:id
  if (req.method === "GET" && url.pathname.startsWith("/api/projects/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/projects/", ""));
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    if (!project) return new Response("Not Found", { status: 404 });
    return Response.json(project);
  }

  // PATCH /api/projects/:id
  if (req.method === "PATCH" && url.pathname.startsWith("/api/projects/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/projects/", ""));
    const body = await req.json().catch(() => ({}));
    const content = typeof body?.content === "string" ? body.content : null;
    const rawName = typeof body?.name === "string" ? body.name.trim() : null;
    const name = rawName === null ? undefined : rawName;
    const baseRevision =
      typeof body?.baseRevision === "number" && Number.isInteger(body.baseRevision)
        ? body.baseRevision
        : null;

    if (content === null || baseRevision === null) {
      return new Response("content and baseRevision are required", {
        status: 400,
      });
    }

    const updateValues: {
      content: string;
      revision: number;
      updatedAt: Date;
      name?: string;
    } = {
      content,
      revision: baseRevision + 1,
      updatedAt: new Date(),
    };

    if (name !== undefined) {
      updateValues.name = name;
    }

    const [updated] = await db
      .update(projects)
      .set(updateValues)
      .where(and(eq(projects.id, id), eq(projects.revision, baseRevision)))
      .returning();

    if (!updated) {
      const [current] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, id));
      if (!current) return new Response("Not Found", { status: 404 });
      return Response.json(current, { status: 409 });
    }

    await maybeSnapshot(id, updated.revision, updated.content);

    return Response.json(updated);
  }

  return new Response("Not Found", { status: 404 });
}
