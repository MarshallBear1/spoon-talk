import katex from "katex";
import { useMemo } from "react";

/** Renders a KaTeX expression to static HTML (works on the server and the client). */
export function Tex({ children, block = false, className }: { children: string; block?: boolean; className?: string }) {
  const html = useMemo(
    () => katex.renderToString(children, { displayMode: block, throwOnError: false, strict: "ignore", output: "html" }),
    [children, block],
  );
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
