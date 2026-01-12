# Editor Autocomplete Strategy

This document outlines how Codenote will add autocomplete to the CodeMirror v6 editor in phases, balancing quality, latency, and complexity.

## Goals

- Fast, reliable completions that never block typing.
- Clear separation between deterministic completions and probabilistic suggestions.
- A path to full TypeScript intelligence without committing to it on day one.

## Non-goals (for now)

- Real-time multi-user code intelligence.
- LLM-only autocomplete.
- Multi-file project indexing.

## Phased approach

### Phase 1: Editor-native completions (fast, deterministic) ✅

Start with CodeMirror v6 completions based on:

- language keywords and snippets
- local tokens in the current file

Why:

- zero backend dependency
- predictable performance
- good baseline UX

UX rules:

- dropdown suggestions only (no ghost text)
- debounce ~150-250ms
- cancel stale completion requests on new input
- tab accepts a highlighted completion; otherwise it indents
- escape, then tab lets keyboard users move focus out of the editor

### Phase 2: TypeScript language intelligence (LSP-style) ✅

Add true TypeScript-aware completions via:

- a TypeScript language service running in a client-side worker
- a small bridge to map language service items into CodeMirror completions

Why:

- type-aware completions, signatures, and auto-imports
- significantly higher quality than token-based suggestions

Notes:

- requires a virtual file system and incremental updates
- requires TypeScript lib definitions (lib.d.ts)
- add caching and debouncing to stay responsive
- include completions, diagnostics, and hover (errors + warnings)
- load ES2022 + DOM lib definitions from local copies; expand as needed

Status:

- Phase 1 complete (keywords/snippets/local tokens).
- Phase 2 complete (completions + diagnostics + hover via TS language service worker).

### Phase 3: LLM ghost-text suggestions (optional)

Layer LLM suggestions as ghost text, separate from the dropdown.

Rules:

- never block typing or delay deterministic completions
- cancel on new keystrokes
- trigger only on idle (300-700ms) or explicit hotkey
- context limited to current file window (plus optional LSP summary)

Plan (server-side, OpenAI):

- Model: `gpt-5-nano` (one-shot suggestion, no streaming to start).
- Endpoint: `POST /api/ai/completions`.
- Request: `{ language, prefix, suffix, cursor, maxTokens }`.
- Response: `{ completionText }` (ghost text only).
- UX: local completions stay dropdown + arrow keys; Tab accepts LLM ghost text.
- Fallback: if endpoint unavailable, skip LLM and show a small "LLM unavailable" status.
- Guardrails: debounce requests, cancel in-flight on new input, cap context window.

### Phase 4: Backend flexibility (optional)

Support multiple inference backends behind one interface:

- local in-browser model (privacy/offline)
- local native model (e.g., Ollama)
- remote inference service

## UX separation

- **Dropdown**: deterministic, correct suggestions (Phase 1/2).
- **Ghost text**: probabilistic LLM completions (Phase 3).

This avoids confusing the user about which suggestions are guaranteed to be correct.

## Implementation checklist (Phase 1)

- Add CodeMirror autocomplete extension.
- Provide a completion source for keywords/snippets.
- Optional: simple in-file token extraction.

## Upgrade path

Phase 1 should define a narrow completion interface so Phase 2 can replace the backend without changing editor UI code.
