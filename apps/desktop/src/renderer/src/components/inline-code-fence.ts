export type InlineCodeLanguage = "jsx" | "svg" | "tsx";

export function isClosedRenderableFence(
  markdown: string,
  language: InlineCodeLanguage,
  code: string,
): boolean {
  const fences = /(?:^|\n)(`{3,}|~{3,})[ \t]*(jsx|tsx|svg)(?:[ \t]+[^\n]*)?\n([\s\S]*?)\n?\1(?=\n|$)/gi;
  for (const match of markdown.matchAll(fences)) {
    if (match[2]?.toLowerCase() !== language) continue;
    if (trimFenceContent(match[3] ?? "") === trimFenceContent(code)) return true;
  }
  return false;
}

function trimFenceContent(source: string): string {
  return source.replace(/\r\n/g, "\n").replace(/\n$/, "");
}
