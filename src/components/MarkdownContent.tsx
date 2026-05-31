import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

type ListItem = {
  text: string;
  ordered: boolean;
};

const inlineTokenPattern =
  "(`[^`]+`|\\*\\*[^*]+\\*\\*|\\*[^*]+\\*|\\[[^\\]]+\\]\\([^)]+\\))";

const getSafeHref = (href: string) => {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  return null;
};

const renderInline = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const tokenPattern = new RegExp(inlineTokenPattern, "g");

  while ((match = tokenPattern.exec(text)) !== null) {
    const [token] = match;

    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${match.index}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${match.index}`}>
          {renderInline(token.slice(2, -2), `${keyPrefix}-strong-${match.index}`)}
        </strong>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={`${keyPrefix}-em-${match.index}`}>
          {renderInline(token.slice(1, -1), `${keyPrefix}-em-${match.index}`)}
        </em>
      );
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = linkMatch ? getSafeHref(linkMatch[2]) : null;
      nodes.push(
        href ? (
          <a
            key={`${keyPrefix}-link-${match.index}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
          >
            {renderInline(linkMatch![1], `${keyPrefix}-link-${match.index}`)}
          </a>
        ) : (
          token
        )
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
};

const renderList = (items: ListItem[], key: string) => {
  const className = "my-2 space-y-1 pl-5";
  const children = items.map((item, index) => (
    <li key={`${key}-${index}`}>{renderInline(item.text, `${key}-${index}`)}</li>
  ));

  return items[0]?.ordered ? (
    <ol key={key} className={cn(className, "list-decimal")}>
      {children}
    </ol>
  ) : (
    <ul key={key} className={cn(className, "list-disc")}>
      {children}
    </ul>
  );
};

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: ListItem[] = [];
  let codeLines = null as string[] | null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ").trim();
    if (text) {
      const key = `p-${blocks.length}`;
      blocks.push(
        <p key={key} className="my-2 leading-6">
          {renderInline(text, key)}
        </p>
      );
    }
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(renderList(listItems, `list-${blocks.length}`));
    listItems = [];
  };

  const flushTextBlocks = () => {
    flushParagraph();
    flushList();
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (codeLines !== null) {
      if (trimmed.startsWith("```")) {
        const key = `code-${blocks.length}`;
        blocks.push(
          <pre
            key={key}
            className="my-2 max-w-full overflow-x-auto rounded-md bg-muted p-3 text-xs"
          >
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      return;
    }

    if (trimmed.startsWith("```")) {
      flushTextBlocks();
      codeLines = [];
      return;
    }

    if (!trimmed) {
      flushTextBlocks();
      return;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushTextBlocks();
      const key = `heading-${blocks.length}`;
      const sizeClass =
        headingMatch[1].length === 1
          ? "text-base"
          : headingMatch[1].length === 2
            ? "text-sm"
            : "text-xs";
      blocks.push(
        <div key={key} className={cn("mb-1 mt-3 font-semibold", sizeClass)}>
          {renderInline(headingMatch[2], key)}
        </div>
      );
      return;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const ordered = Boolean(orderedMatch);
      if (listItems.length > 0 && listItems[0].ordered !== ordered) {
        flushList();
      }
      listItems.push({
        text: (orderedMatch ?? unorderedMatch)![1],
        ordered,
      });
      return;
    }

    const quoteMatch = trimmed.match(/^>\s+(.+)$/);
    if (quoteMatch) {
      flushTextBlocks();
      const key = `quote-${blocks.length}`;
      blocks.push(
        <blockquote
          key={key}
          className="my-2 border-l-2 border-border pl-3 text-muted-foreground"
        >
          {renderInline(quoteMatch[1], key)}
        </blockquote>
      );
      return;
    }

    paragraph.push(trimmed);

    if (index === lines.length - 1) {
      flushTextBlocks();
    }
  });

  if (codeLines !== null) {
    const key = `code-${blocks.length}`;
    blocks.push(
      <pre
        key={key}
        className="my-2 max-w-full overflow-x-auto rounded-md bg-muted p-3 text-xs"
      >
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
  }

  flushTextBlocks();

  if (blocks.length === 0) return null;

  return (
    <div className={cn("text-sm text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      {blocks}
    </div>
  );
}
