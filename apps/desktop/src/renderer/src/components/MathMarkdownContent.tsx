import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { SafeMarkdown } from "./SafeMarkdown";

export default function MathMarkdownContent({
  className,
  interactive = false,
  source,
}: {
  className: string;
  interactive?: boolean;
  source: string;
}) {
  return (
    <SafeMarkdown
      className={className}
      interactive={interactive}
      source={source}
      remarkPlugins={[remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: "warn", throwOnError: false }]]}
    />
  );
}
