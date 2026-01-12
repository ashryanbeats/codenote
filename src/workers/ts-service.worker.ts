import * as ts from "typescript";

import { LIB_FILE_CONTENTS, LIB_FILE_NAMES } from "@/lib/ts-lib.ts";

type CompletionRequest = {
  id: number;
  type: "completions";
  text: string;
  pos: number;
  triggerCharacter?: string;
};

type DiagnosticsRequest = {
  id: number;
  type: "diagnostics";
  text: string;
};

type HoverRequest = {
  id: number;
  type: "hover";
  text: string;
  pos: number;
};

type WorkerRequest = CompletionRequest | DiagnosticsRequest | HoverRequest;

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

type CompletionResponse = {
  id: number;
  type: "completions";
  result: {
    entries: ts.CompletionEntry[];
    replacementSpan?: ts.TextSpan;
  } | null;
};

type DiagnosticsResponse = {
  id: number;
  type: "diagnostics";
  result: WorkerDiagnostic[];
};

type HoverResponse = {
  id: number;
  type: "hover";
  result: WorkerHoverResult;
};

type WorkerResponse = CompletionResponse | DiagnosticsResponse | HoverResponse;

const FILE_NAME = "file.ts";
const DEFAULT_LIB_NAME = "lib.es2022.d.ts";

const normalizeLibName = (fileName: string) => {
  const normalized = fileName.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? fileName;
};

const getLibText = (fileName: string) => {
  const direct = LIB_FILE_CONTENTS.get(fileName);
  if (direct) return direct;
  const normalized = normalizeLibName(fileName);
  return LIB_FILE_CONTENTS.get(normalized);
};

let fileText = "";
let version = 0;

const compilerOptions: ts.CompilerOptions = {
  allowJs: true,
  checkJs: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  noLib: true,
  jsx: ts.JsxEmit.ReactJSX,
};

const host: ts.LanguageServiceHost = {
  getCompilationSettings: () => compilerOptions,
  getScriptFileNames: () => [FILE_NAME, ...LIB_FILE_NAMES],
  getScriptVersion: (fileName) => {
    if (fileName === FILE_NAME) return version.toString();
    return "1";
  },
  getScriptSnapshot: (fileName) => {
    if (fileName === FILE_NAME) {
      return ts.ScriptSnapshot.fromString(fileText);
    }
    const libText = getLibText(fileName);
    if (libText) return ts.ScriptSnapshot.fromString(libText);
    return undefined;
  },
  getScriptKind: (fileName) =>
    fileName === FILE_NAME ? ts.ScriptKind.TS : ts.ScriptKind.TS,
  getCurrentDirectory: () => "/",
  getDefaultLibFileName: () => DEFAULT_LIB_NAME,
  fileExists: (fileName) =>
    fileName === FILE_NAME || Boolean(getLibText(fileName)),
  readFile: (fileName) => {
    if (fileName === FILE_NAME) return fileText;
    const libText = getLibText(fileName);
    if (libText) return libText;
    return undefined;
  },
  readDirectory: () => [],
  useCaseSensitiveFileNames: () => true,
  getNewLine: () => "\n",
};

const service = ts.createLanguageService(host, ts.createDocumentRegistry());

function updateFile(text: string) {
  if (text === fileText) return;
  fileText = text;
  version += 1;
}

const ctx = self as unknown as {
  postMessage: (message: WorkerResponse) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void
  ) => void;
};

const isTriggerCharacter = (
  value: string | undefined
): value is ts.CompletionsTriggerCharacter =>
  value === "." ||
  value === '"' ||
  value === "'" ||
  value === "`" ||
  value === "/" ||
  value === "@" ||
  value === "<" ||
  value === "#" ||
  value === " ";

const toSeverity = (category: ts.DiagnosticCategory) => {
  if (category === ts.DiagnosticCategory.Error) return "error";
  if (category === ts.DiagnosticCategory.Warning) return "warning";
  return null;
};

const getDiagnostics = (): WorkerDiagnostic[] => {
  const all = [
    ...service.getSyntacticDiagnostics(FILE_NAME),
    ...service.getSemanticDiagnostics(FILE_NAME),
  ];

  const result: WorkerDiagnostic[] = [];

  for (const diagnostic of all) {
    const severity = toSeverity(diagnostic.category);
    if (!severity) continue;
    if (diagnostic.start == null) continue;

    const from = diagnostic.start;
    const to = diagnostic.start + (diagnostic.length ?? 0);
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n"
    );

    result.push({ message, from, to, severity });
  }

  return result;
};

const getHoverInfo = (pos: number): WorkerHoverResult => {
  const info = service.getQuickInfoAtPosition(FILE_NAME, pos);
  if (!info) return null;

  const display = ts.displayPartsToString(info.displayParts ?? []);
  const docs = ts.displayPartsToString(info.documentation ?? []);
  const text = docs ? `${display}\n${docs}` : display;

  if (!text) return null;

  return {
    text,
    from: info.textSpan.start,
    to: info.textSpan.start + info.textSpan.length,
  };
};

ctx.addEventListener("message", (event) => {
  const data = event.data;
  updateFile(data.text);

  if (data.type === "completions") {
    const completionInfo = service.getCompletionsAtPosition(
      FILE_NAME,
      data.pos,
      {
        includeInsertTextCompletions: true,
        includeCompletionsForModuleExports: true,
        triggerCharacter: isTriggerCharacter(data.triggerCharacter)
          ? data.triggerCharacter
          : undefined,
      }
    );

    const response: CompletionResponse = {
      id: data.id,
      type: "completions",
      result: completionInfo
        ? {
            entries: completionInfo.entries,
            replacementSpan: completionInfo.optionalReplacementSpan,
          }
        : null,
    };

    ctx.postMessage(response);
    return;
  }

  if (data.type === "diagnostics") {
    const response: DiagnosticsResponse = {
      id: data.id,
      type: "diagnostics",
      result: getDiagnostics(),
    };

    ctx.postMessage(response);
    return;
  }

  if (data.type === "hover") {
    const response: HoverResponse = {
      id: data.id,
      type: "hover",
      result: getHoverInfo(data.pos),
    };

    ctx.postMessage(response);
  }
});
