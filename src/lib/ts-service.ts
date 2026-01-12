import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { Diagnostic } from "@codemirror/lint";
import { hoverTooltip, type EditorView, type Tooltip } from "@codemirror/view";

import { basicCompletionSource } from "@/lib/editor-completions.ts";

type WorkerCompletionEntry = {
  name: string;
  kind: string;
  kindModifiers?: string;
  insertText?: string;
};

type WorkerCompletionResult = {
  entries: WorkerCompletionEntry[];
  replacementSpan?: { start: number; length: number };
} | null;

type WorkerDiagnostic = {
  message: string;
  from: number;
  to: number;
  severity: "error" | "warning";
};

type WorkerHoverResult = {
  text: string;
  from: number;
  to: number;
} | null;

type WorkerRequestMap = {
  completions: {
    id: number;
    text: string;
    pos: number;
    triggerCharacter?: string;
  };
  diagnostics: {
    id: number;
    text: string;
  };
  hover: {
    id: number;
    text: string;
    pos: number;
  };
};

type WorkerResponseMap = {
  completions: WorkerCompletionResult;
  diagnostics: WorkerDiagnostic[];
  hover: WorkerHoverResult;
};

type WorkerResponse = {
  [Key in keyof WorkerResponseMap]: {
    id: number;
    type: Key;
    result: WorkerResponseMap[Key];
  };
}[keyof WorkerResponseMap];

type PendingEntry = {
  resolve: (result: WorkerResponseMap[keyof WorkerResponseMap]) => void;
  fallback: WorkerResponseMap[keyof WorkerResponseMap];
};

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<number, PendingEntry>();

export function resetTsServiceWorker() {
  if (!worker) return;
  for (const entry of pending.values()) {
    entry.resolve(entry.fallback);
  }
  pending.clear();
  worker.terminate();
  worker = null;
}

function ensureWorker() {
  if (worker) return;
  worker = new Worker(
    new URL("../workers/ts-service.worker.ts", import.meta.url),
    {
      type: "module",
    }
  );

  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const { id, result } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    entry.resolve(result);
  });

  worker.addEventListener("error", () => {
    resetTsServiceWorker();
  });
}

function requestWorker<Key extends keyof WorkerResponseMap>(
  type: Key,
  payload: Omit<WorkerRequestMap[Key], "id">,
  fallback: WorkerResponseMap[Key]
): Promise<WorkerResponseMap[Key]> {
  ensureWorker();
  if (!worker) return Promise.resolve(fallback);

  return new Promise((resolve) => {
    const id = (requestId += 1);
    pending.set(id, {
      resolve: resolve as PendingEntry["resolve"],
      fallback,
    });
    worker!.postMessage({
      type,
      ...payload,
      id,
    });
  });
}

function requestCompletions(
  text: string,
  pos: number,
  triggerCharacter?: string
): Promise<WorkerCompletionResult> {
  return requestWorker(
    "completions",
    {
      text,
      pos,
      triggerCharacter,
    },
    null
  );
}

function requestDiagnostics(text: string): Promise<WorkerDiagnostic[]> {
  return requestWorker(
    "diagnostics",
    {
      text,
    },
    []
  );
}

function requestHover(text: string, pos: number): Promise<WorkerHoverResult> {
  return requestWorker(
    "hover",
    {
      text,
      pos,
    },
    null
  );
}

function mapKindToType(kind: string) {
  switch (kind) {
    case "keyword":
      return "keyword";
    case "function":
    case "local function":
    case "method":
    case "getter":
    case "setter":
      return "function";
    case "property":
      return "property";
    case "class":
    case "local class":
      return "class";
    case "interface":
      return "interface";
    case "module":
      return "module";
    case "enum":
    case "enum member":
      return "enum";
    case "const":
    case "let":
    case "var":
    case "local var":
    case "alias":
    default:
      return "variable";
  }
}

function toCompletion(entry: WorkerCompletionEntry): Completion {
  return {
    label: entry.name,
    type: mapKindToType(entry.kind),
    apply: entry.insertText ?? entry.name,
  };
}

function mergeOptions(primary: Completion[], secondary: Completion[]) {
  const seen = new Set<string>();
  const combined: Completion[] = [];

  for (const option of [...primary, ...secondary]) {
    if (seen.has(option.label)) continue;
    seen.add(option.label);
    combined.push(option);
  }

  return combined;
}

export async function tsServiceCompletionSource(
  context: CompletionContext
): Promise<CompletionResult | null> {
  const docText = context.state.doc.toString();
  const word = context.matchBefore(/[$A-Za-z_][\w$]*/);
  const triggerChar = context.state.doc.sliceString(
    Math.max(0, context.pos - 1),
    context.pos
  );
  const isMemberTrigger = triggerChar === ".";

  if (!word && !context.explicit && !isMemberTrigger) {
    return null;
  }

  const tsResult = await requestCompletions(
    docText,
    context.pos,
    isMemberTrigger ? "." : undefined
  );

  const baseResult = await Promise.resolve(basicCompletionSource(context));
  const baseOptions = baseResult?.options ?? [];

  if (!tsResult && baseOptions.length === 0) {
    return null;
  }

  const tsOptions = tsResult ? tsResult.entries.map(toCompletion) : [];

  const from = tsResult?.replacementSpan
    ? tsResult.replacementSpan.start
    : baseResult?.from ?? word?.from ?? context.pos;
  const to = tsResult?.replacementSpan
    ? tsResult.replacementSpan.start + tsResult.replacementSpan.length
    : baseResult?.to ?? word?.to ?? context.pos;

  return {
    from,
    to,
    options: mergeOptions(tsOptions, baseOptions),
    validFor: /[$A-Za-z_][\w$]*/,
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export async function tsServiceDiagnostics(
  view: EditorView
): Promise<Diagnostic[]> {
  const docText = view.state.doc.toString();
  const diagnostics = await requestDiagnostics(docText);
  const docLength = view.state.doc.length;

  return diagnostics.map((diagnostic) => {
    const from = clamp(diagnostic.from, 0, docLength);
    const to = clamp(diagnostic.to, from, docLength);

    return {
      from,
      to,
      severity: diagnostic.severity,
      message: diagnostic.message,
      source: "ts",
    };
  });
}

export const tsServiceHoverTooltip = hoverTooltip(
  async (view, pos): Promise<Tooltip | null> => {
    const info = await requestHover(view.state.doc.toString(), pos);
    if (!info) return null;

    const docLength = view.state.doc.length;
    const from = clamp(info.from, 0, docLength);
    const to = clamp(info.to, from, docLength);

    if (pos < from || pos > to) return null;

    const dom = document.createElement("div");
    dom.className = "cm-tooltip cm-tooltip-hover";
    const pre = document.createElement("pre");
    pre.textContent = info.text;
    pre.style.whiteSpace = "pre-wrap";
    dom.append(pre);

    return {
      pos: from,
      end: to,
      above: true,
      create: () => ({ dom }),
    };
  }
);
