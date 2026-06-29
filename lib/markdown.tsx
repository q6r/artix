// Tiny inline-markdown renderer: supports **bold** and [text](url) only.
// Everything else is rendered as plain text (no raw HTML), so it's XSS-safe.

import type { ReactNode } from "react";

const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;

export function renderMarkdown(text: string): ReactNode[] {
  return text.split(TOKEN).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const raw = link[2].trim();
      // Only allow http(s) and same-origin paths.
      const href = /^(https?:\/\/|\/)/.test(raw) ? raw : "#";
      const external = /^https?:\/\//.test(href);
      return (
        <a
          key={i}
          href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          className="font-medium underline underline-offset-2 hover:opacity-80"
        >
          {link[1]}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
