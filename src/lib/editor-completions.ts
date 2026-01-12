import {
  type Completion,
  type CompletionContext,
  snippetCompletion,
} from "@codemirror/autocomplete";

const KEYWORDS = [
  "abstract",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "module",
  "namespace",
  "new",
  "null",
  "of",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "set",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
];

const KEYWORD_SET = new Set(KEYWORDS);

const SNIPPETS: Completion[] = [
  snippetCompletion("const ${1:name} = ${2:value};", {
    label: "const",
    type: "keyword",
    detail: "declaration",
  }),
  snippetCompletion("let ${1:name} = ${2:value};", {
    label: "let",
    type: "keyword",
    detail: "declaration",
  }),
  snippetCompletion("function ${1:name}(${2:params}) {\n\t$0\n}", {
    label: "function",
    type: "keyword",
    detail: "function",
  }),
  snippetCompletion("(${1:params}) => {\n\t$0\n}", {
    label: "arrow",
    type: "keyword",
    detail: "function",
  }),
  snippetCompletion(
    "for (let ${1:i} = 0; ${1:i} < ${2:count}; ${1:i}++) {\n\t$0\n}",
    {
      label: "for",
      type: "keyword",
      detail: "loop",
    }
  ),
  snippetCompletion("for (const ${1:item} of ${2:items}) {\n\t$0\n}", {
    label: "for...of",
    type: "keyword",
    detail: "loop",
  }),
  snippetCompletion("if (${1:condition}) {\n\t$0\n}", {
    label: "if",
    type: "keyword",
    detail: "branch",
  }),
  snippetCompletion(
    "switch (${1:value}) {\n\tcase ${2:match}:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}",
    {
      label: "switch",
      type: "keyword",
      detail: "branch",
    }
  ),
  snippetCompletion("try {\n\t$0\n} catch (${1:error}) {\n\t\n}", {
    label: "try/catch",
    type: "keyword",
    detail: "error handling",
  }),
  snippetCompletion("import { ${1:name} } from \"${2:module}\";", {
    label: "import",
    type: "keyword",
    detail: "module",
  }),
  snippetCompletion("export { ${1:name} };", {
    label: "export",
    type: "keyword",
    detail: "module",
  }),
  snippetCompletion("console.log(${1:value});", {
    label: "log",
    type: "function",
    detail: "console",
  }),
];

const KEYWORD_COMPLETIONS: Completion[] = KEYWORDS.map((keyword) => ({
  label: keyword,
  type: "keyword",
}));

const WORD_RE = /\b[$A-Za-z_][\w$]*\b/g;

function collectLocalCompletions(
  docText: string,
  prefix: string,
  limit = 200
) {
  WORD_RE.lastIndex = 0;
  const matches = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = WORD_RE.exec(docText)) !== null) {
    const word = match[0];
    if (KEYWORD_SET.has(word)) continue;
    if (prefix && !word.startsWith(prefix)) continue;
    matches.add(word);
    if (matches.size >= limit) break;
  }

  return Array.from(matches).map<Completion>((word) => ({
    label: word,
    type: "variable",
  }));
}

function filterCompletions(options: Completion[], prefix: string) {
  if (!prefix) return options;
  return options.filter((option) => option.label.startsWith(prefix));
}

export function basicCompletionSource(context: CompletionContext) {
  const word = context.matchBefore(/[$A-Za-z_][\w$]*/);
  if (!word && !context.explicit) return null;

  const prefix = word?.text ?? "";
  const from = word?.from ?? context.pos;
  const to = word?.to ?? context.pos;
  const localOptions = collectLocalCompletions(
    context.state.doc.toString(),
    prefix
  );
  const staticOptions = [
    ...filterCompletions(SNIPPETS, prefix),
    ...filterCompletions(KEYWORD_COMPLETIONS, prefix),
  ];

  const seen = new Set<string>();
  const options = [...staticOptions, ...localOptions].filter((option) => {
    if (seen.has(option.label)) return false;
    seen.add(option.label);
    return true;
  });

  return {
    from,
    to,
    options,
    validFor: /[$A-Za-z_][\w$]*/,
  };
}

export const tsCompletionSource = basicCompletionSource;
