import CodeMirror from "@uiw/react-codemirror";
import { autocompletion } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";
import { indentMore } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import * as React from "react";

import { acceptLlmSuggestion, llmGhostText } from "@/lib/llm-suggestions.ts";
import {
  resetTsServiceWorker,
  tsServiceCompletionSource,
  tsServiceDiagnostics,
  tsServiceHoverTooltip,
} from "@/lib/ts-service.ts";
import { cn } from "@/lib/utils.ts";

const tabKeymap = Prec.high(
  keymap.of([
    {
      key: "Tab",
      run: (view) => {
        if (acceptLlmSuggestion(view)) return true;
        return indentMore(view);
      },
    },
  ])
);

type CodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  onBlur?: () => void;
  language?: string;
  enableLlm?: boolean;
};

export function CodeEditor({
  value,
  onChange,
  className,
  onBlur,
  language,
  enableLlm = true,
}: CodeEditorProps) {
  React.useEffect(() => {
    return () => {
      resetTsServiceWorker();
    };
  }, []);

  const llmExtension = React.useMemo(
    () => llmGhostText({ language: language ?? "typescript" }),
    [language]
  );
  const extensions = React.useMemo(
    () => [
      javascript({ typescript: true }),
      tabKeymap,
      ...(!enableLlm ? [autocompletion({ override: [tsServiceCompletionSource] })] : []),
      ...(enableLlm ? [llmExtension] : []),
      linter(tsServiceDiagnostics, { delay: 500 }),
      tsServiceHoverTooltip,
    ],
    [enableLlm, llmExtension]
  );

  return (
    <div
      className={cn("overflow-hidden rounded-lg border bg-background", className)}
      onBlurCapture={onBlur}
    >
      <CodeMirror
        value={value}
        height="60vh"
        basicSetup={{ autocompletion: false }}
        extensions={extensions}
        onChange={(nextValue) => onChange(nextValue)}
      />
    </div>
  );
}
