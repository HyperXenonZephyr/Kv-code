export function sanitizeSvgDataUrl(source: string): {
  error: string;
  image: string;
} {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") {
    return { error: "Invalid SVG source.", image: "" };
  }
  document.querySelectorAll("script,foreignObject,iframe,object,embed").forEach((node) => node.remove());
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      else if ((name === "href" || name === "xlink:href") && !value.startsWith("#")) {
        element.removeAttribute(attribute.name);
      } else if (
        name === "style" &&
        /(?:@import|expression\s*\(|url\s*\(\s*["']?(?:https?:|\/\/|data:))/i.test(value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  document.querySelectorAll("style").forEach((style) => {
    if (/(?:@import|url\s*\(\s*["']?(?:https?:|\/\/|data:))/i.test(style.textContent ?? "")) {
      style.remove();
    }
  });
  const serialized = new XMLSerializer().serializeToString(document.documentElement);
  const bytes = new TextEncoder().encode(serialized);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { error: "", image: `data:image/svg+xml;base64,${btoa(binary)}` };
}
