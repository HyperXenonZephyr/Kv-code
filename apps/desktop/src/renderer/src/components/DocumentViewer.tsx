import { ChevronLeft, ChevronRight, Code2, Eye, FileWarning, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { WorkspaceEntry } from "../../../shared/workspace-files";
import { useI18n } from "../i18n";
import { desktop } from "../lib/desktop";
import { HtmlPreview } from "./HtmlPreview";
import { SvgPreview } from "./SvgPreview";

interface SpreadsheetData {
  sheets: Array<{ name: string; rows: string[][] }>;
}

const MarkdownContent = lazy(() => import("./MarkdownContent"));

export function DocumentViewer({
  workspace,
  entry,
  revision,
  onClose,
}: {
  workspace: string;
  entry: WorkspaceEntry;
  revision: number;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState("");
  const [documentView, setDocumentView] = useState<"source" | "rendered">("rendered");
  const isMarkdown = entry.extension === "md";
  const isHtml = entry.extension === "html" || entry.extension === "htm";
  const isSvg = entry.extension === "svg";
  const hasViewControls = isMarkdown || isHtml || isSvg;
  const imageMimeType = IMAGE_TYPES[entry.extension];

  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    void desktop.readWorkspaceFile(workspace, entry.path)
      .then((file) => {
        if (active) setData(new Uint8Array(file.data));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : t("workbench.previewFailed"));
      });
    return () => { active = false; };
  }, [entry.path, revision, t, workspace]);

  useEffect(() => setDocumentView("rendered"), [entry.path]);

  return (
    <section className="document-viewer">
      <header className={hasViewControls ? "has-view-controls" : undefined}>
        <span>{entry.extension.toUpperCase()}</span>
        <strong>{entry.name}</strong>
        <small>{entry.path}</small>
        {hasViewControls && (
          <div className="document-view-control" aria-label={t("workbench.documentView")}>
            <button
              className={documentView === "source" ? "active" : ""}
              title={t("workbench.source")}
              aria-pressed={documentView === "source"}
              onClick={() => setDocumentView("source")}
            >
              <Code2 size={13} /> <span>{t("workbench.source")}</span>
            </button>
            <button
              className={documentView === "rendered" ? "active" : ""}
              title={t("workbench.rendered")}
              aria-pressed={documentView === "rendered"}
              onClick={() => setDocumentView("rendered")}
            >
              <Eye size={13} /> <span>{t("workbench.rendered")}</span>
            </button>
          </div>
        )}
        <button title={t("workbench.closePreview")} onClick={onClose}><X size={15} /></button>
      </header>
      <div className="document-stage">
        {error && <PreviewError message={error} />}
        {!data && !error && (
          <span className="document-loading">RENDERING DOCUMENT</span>
        )}
        {data && entry.extension === "docx" && <DocxPreview data={data} />}
        {data && entry.extension === "pptx" && <PptxPreview data={data} />}
        {data && entry.extension === "xlsx" && <SpreadsheetPreview data={data} />}
        {data && isMarkdown && (
          documentView === "source"
            ? <TextPreview data={data} />
            : (
              <Suspense fallback={<span className="document-loading">RENDERING MARKDOWN</span>}>
                <MarkdownContent
                  className="markdown-file-preview"
                  source={new TextDecoder().decode(data)}
                />
              </Suspense>
            )
        )}
        {data && isHtml && (
          documentView === "source"
            ? <TextPreview data={data} />
            : <HtmlPreview data={data} title={entry.name} />
        )}
        {data && isSvg && (
          documentView === "source"
            ? <TextPreview data={data} />
            : <SvgPreview source={new TextDecoder().decode(data)} />
        )}
        {data && !isMarkdown && !isHtml && !isSvg && TEXT_EXTENSIONS.has(entry.extension) && <TextPreview data={data} />}
        {data && imageMimeType && (
          <BinaryPreview data={data} mimeType={imageMimeType} kind="image" />
        )}
        {data && entry.extension === "pdf" && (
          <BinaryPreview data={data} mimeType="application/pdf" kind="pdf" />
        )}
        {data && !isPreviewable(entry.extension) && (
          <PreviewError message={t("workbench.unsupportedPreview")} />
        )}
      </div>
    </section>
  );
}

function TextPreview({ data }: { data: Uint8Array }) {
  return <pre className="text-file-preview">{new TextDecoder().decode(data)}</pre>;
}

function BinaryPreview({
  data,
  mimeType,
  kind,
}: {
  data: Uint8Array;
  mimeType: string;
  kind: "image" | "pdf";
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([toArrayBuffer(data)], { type: mimeType }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [data, mimeType]);
  if (!url) return null;
  return kind === "image"
    ? <div className="image-file-preview"><img src={url} alt="" /></div>
    : <embed className="pdf-file-preview" src={url} type="application/pdf" />;
}

function DocxPreview({ data }: { data: Uint8Array }) {
  const container = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const target = container.current;
    if (!target) return;
    target.replaceChildren();
    void import("docx-preview")
      .then(({ renderAsync }) => renderAsync(toArrayBuffer(data), target, undefined, {
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        useBase64URL: true,
      }))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "DOCX render failed."));
  }, [data]);
  return error ? <PreviewError message={error} /> : <div className="docx-preview" ref={container} />;
}

function PptxPreview({ data }: { data: Uint8Array }) {
  const container = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const target = container.current;
    if (!target) return;
    let destroyed = false;
    let destroy = () => {};
    target.replaceChildren();
    void import("@aiden0z/pptx-renderer")
      .then(async ({ PptxViewer, RECOMMENDED_ZIP_LIMITS }) => {
        if (destroyed) return;
        const previewer = await PptxViewer.open(toArrayBuffer(data), target, {
          fitMode: "contain",
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          lazyMedia: true,
          lazySlides: true,
          pdfjs: false,
          renderMode: "list",
          scrollContainer: target.parentElement ?? undefined,
          listOptions: {
            windowed: true,
            initialSlides: 4,
            batchSize: 4,
          },
        });
        destroy = () => previewer.destroy();
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "PPTX render failed."));
    return () => {
      destroyed = true;
      destroy();
    };
  }, [data]);
  return error ? <PreviewError message={error} /> : <div className="pptx-preview" ref={container} />;
}

function SpreadsheetPreview({ data }: { data: Uint8Array }) {
  const [workbook, setWorkbook] = useState<SpreadsheetData | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const pageSize = 200;

  useEffect(() => {
    let active = true;
    void import("read-excel-file/browser")
      .then(async ({ default: readXlsxFile }) => {
        const source = await readXlsxFile(toArrayBuffer(data));
        const sheets = source.map((sheet) => ({
          name: sheet.sheet,
          rows: sheet.data.map((row) => row.map(formatCellValue)),
        }));
        if (active) setWorkbook({ sheets });
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "XLSX render failed.");
      });
    return () => { active = false; };
  }, [data]);

  if (error) return <PreviewError message={error} />;
  const sheet = workbook?.sheets[sheetIndex];
  if (!sheet) return <span className="document-loading">READING WORKBOOK</span>;
  const pageCount = Math.max(1, Math.ceil(sheet.rows.length / pageSize));
  const rows = sheet.rows.slice(page * pageSize, (page + 1) * pageSize);
  const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);

  return (
    <div className="spreadsheet-preview">
      <div className="spreadsheet-tabs">
        {workbook?.sheets.map((candidate, index) => (
          <button
            className={index === sheetIndex ? "active" : ""}
            key={candidate.name}
            onClick={() => { setSheetIndex(index); setPage(0); }}
          >
            {candidate.name}
          </button>
        ))}
      </div>
      <div className="spreadsheet-grid">
        <table>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={page * pageSize + rowIndex}>
                <th>{page * pageSize + rowIndex + 1}</th>
                {Array.from({ length: columnCount }, (_, column) => (
                  <td key={column}>{row[column] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer>
        <button disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={14} /></button>
        <span>{page + 1} / {pageCount}</span>
        <button disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight size={14} /></button>
      </footer>
    </div>
  );
}

function PreviewError({ message }: { message: string }) {
  return <div className="document-error"><FileWarning size={22} /><span>{message}</span></div>;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleString();
  return String(value);
}

const TEXT_EXTENSIONS = new Set([
  "c", "cc", "cpp", "cs", "css", "csv", "go", "h", "hpp", "html",
  "htm", "ini", "java", "js", "json", "jsx", "kt", "log", "lua", "md", "mjs",
  "php", "properties", "ps1", "py", "rb", "rs", "scss", "sh", "sql",
  "svg", "toml", "ts", "tsx", "txt", "vue", "xml", "yaml", "yml",
]);

const IMAGE_TYPES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function isPreviewable(extension: string): boolean {
  return (
    ["docx", "pptx", "xlsx", "pdf"].includes(extension) ||
    TEXT_EXTENSIONS.has(extension) ||
    Boolean(IMAGE_TYPES[extension])
  );
}
