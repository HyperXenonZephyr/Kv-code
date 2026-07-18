import { describe, expect, it } from "vitest";
import { isClosedRenderableFence } from "./inline-code-fence";

describe("inline code fences", () => {
  it("renders only a closed block and allows later response text", () => {
    const code = "export default function Demo() { return <div>ready</div>; }";
    const closed = `Before\n\n\`\`\`tsx\n${code}\n\`\`\`\n\nAfter`;
    const streaming = `Before\n\n\`\`\`tsx\n${code}`;

    expect(isClosedRenderableFence(closed, "tsx", code)).toBe(true);
    expect(isClosedRenderableFence(streaming, "tsx", code)).toBe(false);
  });

  it("recognizes a closed SVG block", () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>';
    expect(isClosedRenderableFence(`~~~svg\n${svg}\n~~~`, "svg", svg)).toBe(true);
  });
});
