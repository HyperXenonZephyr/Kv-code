import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./agent-prompt";

describe("agent prompt response formatting", () => {
  it("separates KaTeX math from complete LaTeX source", () => {
    const prompt = buildSystemPrompt("code", "high", "");

    expect(prompt).toContain("use $...$ for inline math and $$...$$ for display math");
    expect(prompt).toContain("Put every complete LaTeX document in a fenced code block labeled latex");
    expect(prompt).toContain("Never wrap a complete LaTeX document in $$ delimiters");
    expect(prompt).toContain("emit a fenced jsx or tsx block exactly where the interactive result should appear");
    expect(prompt).toContain("Never emit infinite or unbounded loops");
    expect(prompt).toContain("emit a fenced svg block at the desired position");
  });
});
