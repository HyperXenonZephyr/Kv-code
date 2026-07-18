import { lazy, Suspense } from "react";
import { SafeMarkdown } from "./SafeMarkdown";

const MathMarkdownContent = lazy(() => import("./MathMarkdownContent"));
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|(^|[^\\])\$[^$\n]+?\$/m;

export default function MarkdownContent({
  className,
  interactive = false,
  source,
}: {
  className: string;
  interactive?: boolean;
  source: string;
}) {
  const preparedSource = prepareMarkdownSource(source);
  if (!MATH_PATTERN.test(preparedSource)) {
    return (
      <SafeMarkdown
        className={className}
        interactive={interactive}
        source={preparedSource}
      />
    );
  }
  return (
    <Suspense fallback={(
      <SafeMarkdown
        className={className}
        interactive={interactive}
        source={preparedSource}
      />
    )}>
      <MathMarkdownContent
        className={className}
        interactive={interactive}
        source={preparedSource}
      />
    </Suspense>
  );
}

export function prepareMarkdownSource(source: string): string {
  return normalizeLatexDelimiters(fenceLatexDocuments(source));
}

function fenceLatexDocuments(source: string): string {
  return mapOutsideCode(source, (segment) => segment.replace(
    /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}[\s\S]*?\\end\{document\}(?:\s*\$\$)?/g,
    (document) => `\n\n~~~latex\n${document.trim()}\n~~~\n\n`,
  ));
}

export function normalizeLatexDelimiters(source: string): string {
  return mapOutsideCode(source, (segment) => segment
        .replace(/\\\[([\s\S]*?)\\\]/g, "$$$$$1$$$$")
        .replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$")
        .replace(
          /\\begin\{([A-Za-z*]+)\}([\s\S]*?)\\end\{\1\}/g,
          "$$$$\\begin{$1}$2\\end{$1}$$$$",
        ));
}

function mapOutsideCode(source: string, transform: (segment: string) => string): string {
  return source
    .split(/(`{1,3}[\s\S]*?`{1,3}|~{3}[\s\S]*?~{3})/g)
    .map((segment, index) => index % 2 === 1 ? segment : transform(segment))
    .join("");
}
