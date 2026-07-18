import { useMemo } from "react";

const FORBIDDEN_ELEMENTS = [
  "applet",
  "base",
  "embed",
  "frame",
  "frameset",
  "iframe",
  "object",
  "script",
].join(",");

const FRAME_CSP = [
  "default-src 'none'",
  "font-src data:",
  "img-src data:",
  "media-src data:",
  "style-src 'unsafe-inline'",
].join("; ");

export function HtmlPreview({ data, title }: { data: Uint8Array; title: string }) {
  const source = new TextDecoder().decode(data);
  const document = useMemo(() => hardenHtml(source), [source]);
  return (
    <iframe
      className="html-file-preview"
      referrerPolicy="no-referrer"
      sandbox=""
      srcDoc={document}
      title={title}
    />
  );
}

function hardenHtml(source: string): string {
  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll(FORBIDDEN_ELEMENTS).forEach((element) => element.remove());
  document.querySelectorAll("meta[http-equiv]").forEach((element) => element.remove());

  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "href" || name === "xlink:href") {
        if (!value.startsWith("#")) element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "src" || name === "poster") {
        if (!/^data:(?:image|audio|video)\//i.test(value)) {
          element.removeAttribute(attribute.name);
        }
        continue;
      }
      if (name === "action" || name === "formaction") {
        element.removeAttribute(attribute.name);
      }
    }
  });

  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = FRAME_CSP;
  document.head.prepend(policy);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}
