import { describe, expect, it } from "vitest";
import {
  buildInteractiveDocument,
  compileInteractiveSource,
  validateInteractiveSource,
} from "./inline-code-runtime";

describe("inline component runtime", () => {
  it("compiles a bounded TSX component into the isolated runtime", () => {
    const source = `
      import { useState } from "react";
      export default function Demo() {
        const [value, setValue] = useState(1);
        return <input value={value} onChange={(event) => setValue(event.currentTarget.value)} />;
      }
    `;
    expect(validateInteractiveSource(source)).toBeNull();
    const compiledSource = compileInteractiveSource(source);
    expect(compiledSource).toContain("exports.default = Demo");
    const document = buildInteractiveDocument({
      compiledSource,
      id: "test-runtime",
      theme: "dark",
    });
    expect(document).toContain("script-src 'unsafe-inline'");
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("kv-inline-ready");
    expect(document).toContain("var module={exports:{}};var exports=module.exports;");
    expect(document).not.toContain("const module={exports:{}}");
    expect(document).toContain("root.replaceChildren()");
    expect(document).toContain("test-runtime");
  });

  it("rejects dangerous and unavailable capabilities", () => {
    expect(validateInteractiveSource("while (true) {}"))
      .toContain("Unbounded loops");
    expect(validateInteractiveSource("fetch('https://example.com')")).toContain("Network");
    expect(validateInteractiveSource("import chart from 'unknown-chart'"))
      .toContain("unknown-chart");
  });
});
