import { transform } from "sucrase";
import preactRuntime from "../../../../node_modules/preact/dist/preact.min.umd.js?raw";
import preactHooksRuntime from "../../../../node_modules/preact/hooks/dist/hooks.umd.js?raw";

const MAX_SOURCE_LENGTH = 24_000;
const ALLOWED_MODULES = new Set(["react", "react-dom/client"]);
const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|SharedWorker|Worker)\b/, "Network and worker APIs are unavailable."],
  [/\b(?:eval|setInterval)\s*\(/, "Dynamic or unbounded execution is unavailable."],
  [/\bnew\s+Function\b|\bFunction\s*\(/, "Dynamic code construction is unavailable."],
  [/\bwhile\s*\(\s*true\s*\)|\bfor\s*\(\s*;\s*;\s*\)/, "Unbounded loops are unavailable."],
  [/\b(?:localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.clipboard)\b/, "Persistent storage and clipboard APIs are unavailable."],
  [/\bwindow\s*\.\s*(?:parent|top|opener)\b|\bparent\s*\.|\btop\s*\./, "Parent-window access is unavailable."],
  [/\b(?:dangerouslySetInnerHTML|postMessage)\b/, "Raw HTML injection and custom bridge messages are unavailable."],
  [/\bimport\s*\(/, "Dynamic imports are unavailable."],
];

export function validateInteractiveSource(source: string): string | null {
  if (!source.trim()) return "The interactive component is empty.";
  if (source.length > MAX_SOURCE_LENGTH) return "The interactive component exceeds 24,000 characters.";
  for (const [pattern, message] of DANGEROUS_PATTERNS) {
    if (pattern.test(source)) return message;
  }
  const imports = source.matchAll(/(?:\bfrom\s*|\brequire\s*\(\s*)["']([^"']+)["']/g);
  for (const match of imports) {
    if (!ALLOWED_MODULES.has(match[1] ?? "")) {
      return `Module "${match[1]}" is not available in inline components.`;
    }
  }
  return null;
}

export function compileInteractiveSource(source: string): string {
  return transform(source, {
    transforms: ["typescript", "jsx", "imports"],
    jsxPragma: "h",
    jsxFragmentPragma: "Fragment",
    production: true,
  }).code;
}

export function buildInteractiveDocument({
  compiledSource,
  id,
  theme,
}: {
  compiledSource: string;
  id: string;
  theme: "dark" | "light";
}): string {
  const colors = theme === "dark"
    ? { background: "#111519", text: "#e7eaec", muted: "#8a949d", accent: "#67d9e5", line: "#2b3239" }
    : { background: "#f4f5f4", text: "#171b1d", muted: "#596267", accent: "#087b89", line: "#c3c9c9" };
  const runtime = `${preactRuntime}\n${preactHooksRuntime}\n${createExecutionScript(compiledSource, id)}`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'">
<style>
:root{color-scheme:${theme}}*{box-sizing:border-box}html,body,#root{min-height:100%;margin:0}body{overflow:hidden;background:${colors.background};color:${colors.text};font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}#root{padding:18px}button,input,select,textarea{font:inherit;color:inherit}button{border:1px solid ${colors.line};background:transparent;padding:6px 10px;cursor:pointer}input[type=range]{accent-color:${colors.accent}}svg,canvas{max-width:100%}.kv-error{padding:14px;border:1px solid #8f3e46;color:#ffb7bd;white-space:pre-wrap}.kv-muted{color:${colors.muted}}
</style></head><body><div id="root"><span class="kv-muted">Rendering interactive component…</span></div><script>${escapeInlineScript(runtime)}</script></body></html>`;
}

function createExecutionScript(compiledSource: string, id: string): string {
  return `
const {h,Fragment,render}=self.preact;
const React=Object.assign({__esModule:true,default:null,createElement:h,Fragment},self.preact,self.preactHooks);React.default=React;
const {useState,useEffect,useMemo,useCallback,useRef,useReducer,useContext,useLayoutEffect}=self.preactHooks;
const ReactDomClient={createRoot:(target)=>({render:(node)=>render(node,target)})};
function require(name){if(name==='react')return React;if(name==='react-dom/client')return ReactDomClient;throw new Error('Module "'+name+'" is unavailable.');}
var module={exports:{}};var exports=module.exports;
try{
${compiledSource}
const Component=exports.default||module.exports.default||(typeof module.exports==='function'&&module.exports)||(typeof App!=='undefined'&&App)||(typeof Demo!=='undefined'&&Demo);
if(!Component)throw new Error('Export a default component, for example: export default function Demo() { ... }');
const root=document.getElementById('root');if(!root)throw new Error('Inline component root is missing.');root.replaceChildren();
render(typeof Component==='function'?h(Component,{}):Component,root);
const report=()=>parent.postMessage({type:'kv-inline-resize',id:${JSON.stringify(id)},height:Math.ceil(document.documentElement.scrollHeight)},'*');
new ResizeObserver(report).observe(document.documentElement);requestAnimationFrame(()=>{report();parent.postMessage({type:'kv-inline-ready',id:${JSON.stringify(id)}},'*');});
}catch(error){const message=error instanceof Error?error.message:String(error);const target=document.getElementById('root');target.innerHTML='';const box=document.createElement('div');box.className='kv-error';box.textContent=message;target.appendChild(box);parent.postMessage({type:'kv-inline-error',id:${JSON.stringify(id)},message},'*');}
`;
}

function escapeInlineScript(source: string): string {
  return source
    .replace(/<\/script/gi, "<\\/script")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
