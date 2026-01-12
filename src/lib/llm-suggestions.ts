import { StateEffect, StateField, Transaction } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from "@codemirror/view";

type GhostSuggestion = {
  from: number;
  text: string;
};

type LlmOptions = {
  language?: string;
  maxTokens?: number;
  debounceMs?: number;
  prefixChars?: number;
  suffixChars?: number;
};

const DEFAULT_OPTIONS: Required<LlmOptions> = {
  language: "typescript",
  maxTokens: 128,
  debounceMs: 400,
  prefixChars: 300,
  suffixChars: 80,
};

const setGhostEffect = StateEffect.define<GhostSuggestion | null>();

class GhostWidget extends WidgetType {
  constructor(private text: string) {
    super();
  }

  eq(other: GhostWidget) {
    return this.text === other.text;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghostText";
    span.textContent = this.text;
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

const ghostField = StateField.define<GhostSuggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhostEffect)) return effect.value;
    }

    if (tr.docChanged) return null;

    if (!tr.startState.selection.eq(tr.newSelection)) {
      return null;
    }

    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (ghost) => {
      if (!ghost?.text) return Decoration.none;
      return Decoration.set([
        Decoration.widget({
          widget: new GhostWidget(ghost.text),
          side: 1,
        }).range(ghost.from),
      ]);
    }),
});

function normalizeSuggestion(text: string) {
  const cleaned = text.replace(/\r/g, "");
  const lines = cleaned.split("\n");
  const line = lines.find((item) => item.trim().length > 0);
  return line ?? "";
}

export function acceptLlmSuggestion(view: EditorView): boolean {
  const ghost = view.state.field(ghostField, false);
  if (!ghost?.text) return false;

  view.dispatch({
    changes: { from: ghost.from, to: ghost.from, insert: ghost.text },
    selection: { anchor: ghost.from + ghost.text.length },
    effects: setGhostEffect.of(null),
    annotations: Transaction.userEvent.of("input"),
  });
  return true;
}

export function llmGhostText(options: LlmOptions = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  const plugin = ViewPlugin.fromClass(
    class {
      private enabled = false;
      private statusChecked = false;
      private timer: number | null = null;
      private inFlight = false;
      private pending = false;
      private requestId = 0;
      private lastPromptKey = "";

      constructor(private view: EditorView) {
        void this.checkStatus();
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
          this.clearGhost();
          this.scheduleRequest();
        }
      }

      destroy() {
        this.clearTimer();
        this.inFlight = false;
        this.pending = false;
      }

      private async checkStatus() {
        if (this.statusChecked) return;
        this.statusChecked = true;

        try {
          const res = await fetch("/api/ai/status");
          if (!res.ok) return;
          const data = (await res.json()) as { enabled?: boolean };
          this.enabled = Boolean(data.enabled);
        } catch {
          this.enabled = false;
        }
      }

      private clearGhost() {
        const existing = this.view.state.field(ghostField, false);
        if (!existing) return;
        this.view.dispatch({ effects: setGhostEffect.of(null) });
      }

      private clearTimer() {
        if (this.timer === null) return;
        globalThis.clearTimeout(this.timer);
        this.timer = null;
      }

      private scheduleRequest() {
        if (!this.view.hasFocus) return;
        if (this.statusChecked && !this.enabled) return;
        if (this.inFlight) {
          this.pending = true;
          return;
        }

        this.clearTimer();
        this.timer = globalThis.setTimeout(() => {
          void this.requestSuggestion();
        }, config.debounceMs);
      }

      private async requestSuggestion() {
        this.clearTimer();

        if (!this.view.hasFocus) return;
        await this.checkStatus();
        if (!this.enabled) return;
        if (this.inFlight) {
          this.pending = true;
          return;
        }

        const { state } = this.view;
        const selection = state.selection.main;
        if (!selection.empty) return;

        const pos = selection.head;
        const line = state.doc.lineAt(pos);
        const startLine = Math.max(1, line.number - 20);
        const endLine = Math.min(state.doc.lines, line.number + 4);
        const startPos = state.doc.line(startLine).from;
        const endPos = state.doc.line(endLine).to;

        let prefix = state.doc.sliceString(startPos, pos);
        let suffix = state.doc.sliceString(pos, endPos);

        if (prefix.length > config.prefixChars) {
          prefix = prefix.slice(-config.prefixChars);
        }
        if (suffix.length > config.suffixChars) {
          suffix = suffix.slice(0, config.suffixChars);
        }

        if (!prefix.trim() && !suffix.trim()) return;

        const promptKey = `${pos}:${prefix}::${suffix}`;
        if (promptKey === this.lastPromptKey) return;
        this.lastPromptKey = promptKey;

        this.inFlight = true;
        const requestId = (this.requestId += 1);

        let res: Response;
        try {
          res = await fetch("/api/ai/completions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              language: config.language,
              prefix,
              suffix,
              maxTokens: config.maxTokens,
            }),
          });
        } catch {
          return;
        } finally {
          this.inFlight = false;
          if (this.pending) {
            this.pending = false;
            this.scheduleRequest();
          }
        }

        if (requestId !== this.requestId) return;

        if (res.status === 503) {
          this.enabled = false;
          return;
        }

        if (!res.ok) return;

        let data: { completionText?: string } | null = null;
        try {
          data = (await res.json()) as { completionText?: string };
        } catch {
          return;
        }

        if (requestId !== this.requestId) return;

        const suggestion = normalizeSuggestion(data?.completionText ?? "");
        if (!suggestion.trim()) {
          this.clearGhost();
          return;
        }

        if (suffix.startsWith(suggestion)) {
          this.clearGhost();
          return;
        }

        if (this.view.state.selection.main.head !== pos) return;
        const currentPrefix = this.view.state.doc.sliceString(
          Math.max(startPos, pos - config.prefixChars),
          pos
        );
        if (currentPrefix !== prefix) return;

        this.view.dispatch({
          effects: setGhostEffect.of({ from: pos, text: suggestion }),
        });
      }
    },
    {
      eventHandlers: {
        blur: (_event, view) => {
          const existing = view.state.field(ghostField, false);
          if (!existing) return;
          view.dispatch({ effects: setGhostEffect.of(null) });
        },
      },
    }
  );

  return [ghostField, plugin];
}
