import path from "node:path";

export function codexPathOverride() {
  return (
    process.env.CODEX_EXECUTABLE ??
    path.join(process.cwd(), "..", "..", "kv-code-rs", "target", "debug", "codex")
  );
}
