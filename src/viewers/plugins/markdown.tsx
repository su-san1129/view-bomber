import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";
import { MermaidBlock } from "../../components/MermaidBlock";
import type { ViewerPlugin } from "../types";

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-mermaid/.exec(className || "");
    if (match) {
      return <MermaidBlock>{String(children).replace(/\n$/, "")}</MermaidBlock>;
    }
    return <code className={className} {...props}>{children}</code>;
  }
};

export const markdownViewerPlugin: ViewerPlugin = {
  id: "markdown",
  label: "Markdown",
  extensions: ["md", "markdown"],
  supportsFind: true,
  render({ content, contentRef }) {
    return (
      <div ref={contentRef} className="markdown-body" style={{ maxWidth: 900, margin: "0 auto" }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }
};
