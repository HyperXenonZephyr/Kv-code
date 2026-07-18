import { describe, expect, it } from "vitest";
import {
  normalizeLatexDelimiters,
  prepareMarkdownSource,
} from "./MarkdownContent";

describe("Markdown LaTeX delimiter normalization", () => {
  it("normalizes common delimiters while preserving fenced code", () => {
    const source = [
      "Inline \\(x^2\\)",
      "Display \\[x^2\\]",
      "\\begin{aligned}x&=1\\end{aligned}",
      "```text",
      "\\(keep-as-code\\)",
      "```",
    ].join("\n");
    const normalized = normalizeLatexDelimiters(source);

    expect(normalized).toContain("Inline $x^2$");
    expect(normalized).toContain("Display $$x^2$$");
    expect(normalized).toContain("$$\\begin{aligned}x&=1\\end{aligned}$$");
    expect(normalized).toContain("\\(keep-as-code\\)");
  });

  it("fences complete LaTeX documents instead of treating them as math", () => {
    const source = [
      "Example:",
      "\\documentclass{article}",
      "\\begin{document}",
      "Hello $x^2$",
      "\\end{document}$$",
    ].join("\n");

    expect(prepareMarkdownSource(source)).toBe([
      "Example:",
      "",
      "",
      "~~~latex",
      "\\documentclass{article}",
      "\\begin{document}",
      "Hello $x^2$",
      "\\end{document}$$",
      "~~~",
      "",
      "",
    ].join("\n"));
  });
});
