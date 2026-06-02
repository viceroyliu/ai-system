"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 统一的 Markdown 渲染组件（支持 GFM：表格、任务列表、删除线、自动链接等）。
 * 用于 AI 对话与「今天想思考什么」洞察弹窗。
 */
export default function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`md${className ? " " + className : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          img: ({ ...props }) => <img {...props} loading="lazy" alt={props.alt || ""} />,
          table: ({ ...props }) => (
            <div className="md-table-wrap">
              <table {...props} />
            </div>
          ),
        }}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
