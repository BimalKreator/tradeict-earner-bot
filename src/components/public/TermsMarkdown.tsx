"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function TermsMarkdown({ content }: { content: string }) {
  return (
    <div className="legal-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
