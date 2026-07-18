import { FileWarning } from "lucide-react";
import { useMemo } from "react";
import { sanitizeSvgDataUrl } from "./svg-rendering";

export function SvgPreview({ source }: { source: string }) {
  const result = useMemo(() => sanitizeSvgDataUrl(source), [source]);
  if (result.error) {
    return <div className="document-error"><FileWarning size={22} /><span>{result.error}</span></div>;
  }
  return <div className="image-file-preview"><img src={result.image} alt="" /></div>;
}
