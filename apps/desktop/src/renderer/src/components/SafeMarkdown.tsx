import {
  Children,
  isValidElement,
  lazy,
  Suspense,
  type ComponentProps,
  type ReactNode,
} from "react";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from "rehype-sanitize";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  isClosedRenderableFence,
  type InlineCodeLanguage,
} from "./inline-code-fence";

const InlineCodePreview = lazy(() => import("./InlineCodePreview"));

type RemarkPlugins = NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>;
type RehypePlugins = NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;

const markdownSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", "math-inline", "math-display"],
    ],
  },
};

export function SafeMarkdown({
  className,
  source,
  interactive = false,
  remarkPlugins = [],
  rehypePlugins = [],
}: {
  className: string;
  source: string;
  interactive?: boolean;
  remarkPlugins?: RemarkPlugins;
  rehypePlugins?: RehypePlugins;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...remarkPlugins]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, markdownSchema],
          ...rehypePlugins,
        ]}
        components={{
          a: ({ onAuxClick: _onAuxClick, onClick: _onClick, ...props }) => (
            <a
              {...props}
              onAuxClick={(event) => event.preventDefault()}
              onClick={(event) => event.preventDefault()}
            />
          ),
          pre: ({ children, ...props }) => {
            const renderable = interactive
              ? renderableCodeBlock(source, children)
              : null;
            if (!renderable) return <pre {...props}>{children}</pre>;
            return (
              <Suspense fallback={<pre {...props}>{children}</pre>}>
                <InlineCodePreview
                  language={renderable.language}
                  source={renderable.source}
                />
              </Suspense>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

function renderableCodeBlock(
  markdown: string,
  children: ReactNode,
): { language: InlineCodeLanguage; source: string } | null {
  const nodes = Children.toArray(children);
  const code = nodes.length === 1 && isValidElement<{
    children?: ReactNode;
    className?: string;
  }>(nodes[0]) ? nodes[0] : null;
  const match = /(?:^|\s)language-(jsx|tsx|svg)(?:\s|$)/i.exec(code?.props.className ?? "");
  if (!code || !match) return null;
  const language = match[1]?.toLowerCase() as InlineCodeLanguage;
  const codeSource = String(code.props.children ?? "").replace(/\n$/, "");
  return isClosedRenderableFence(markdown, language, codeSource)
    ? { language, source: codeSource }
    : null;
}
