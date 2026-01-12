const LIB_ROOTS = ["es2022", "dom", "dom.iterable", "dom.asynciterable"];
const REF_LIB_RE = /^\s*\/\/\/\s*<reference\s+lib="([^"]+)"\s*\/?>\s*$/gm;

const libFiles = new Map<string, string>();

const LIB_BASE_URL =
  typeof globalThis.location === "undefined"
    ? "http://localhost"
    : globalThis.location.origin;

async function loadLib(name: string) {
  const fileName = `lib.${name}.d.ts`;
  const url = new URL(`/tslibs/${fileName}`, LIB_BASE_URL);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${fileName}`);
  }
  const text = await res.text();
  libFiles.set(fileName, text);
  return text;
}

async function collectLibs(name: string, seen: Set<string>) {
  if (seen.has(name)) return;
  seen.add(name);

  const source = await loadLib(name);
  const refs = Array.from(source.matchAll(REF_LIB_RE)).map((match) => match[1]);

  for (const ref of refs) {
    await collectLibs(ref, seen);
  }
}

const seen = new Set<string>();
for (const root of LIB_ROOTS) {
  await collectLibs(root, seen);
}

export const LIB_FILE_CONTENTS = libFiles;
export const LIB_FILE_NAMES = Array.from(libFiles.keys());
