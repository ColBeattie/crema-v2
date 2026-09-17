"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * The setup command, with a copy button.
 *
 * The command is multi-line with backslash continuations, which is exactly the
 * shape that gets mangled when someone selects it by hand — hence a copy
 * button rather than trusting a drag-select. Feedback is required: a copy that
 * silently succeeds is indistinguishable from one that silently failed.
 */
export default function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Don't leave a timer pointing at a setState for an unmounted component.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    if (timer.current) clearTimeout(timer.current);

    try {
      // Not optional-chained: clipboard access is refused outside a secure
      // context and by some permission policies, and a button that appears to
      // do nothing is the hardest kind of bug to report. Fall through to the
      // visible "select it yourself" message instead.
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setFailed(false);
    } catch {
      setCopied(false);
      setFailed(true);
    }

    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2500);
  };

  return (
    <div>
      <div className="relative">
        {/* Wide content scrolls inside its own box so the page body never
            scrolls sideways on a phone. */}
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-4 pr-14 text-xs leading-relaxed text-foreground">
          <code className="font-mono whitespace-pre">{command}</code>
        </pre>

        <button
          type="button"
          onClick={copy}
          // Positioned inside the padded gutter reserved by `pr-14` above, so
          // it never sits on top of the command text.
          className="absolute right-2 top-2 flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label={copied ? "Command copied" : "Copy command"}
        >
          {copied ? (
            <>
              <Check
                className="h-3.5 w-3.5 text-green-600 dark:text-green-500"
                aria-hidden="true"
              />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Announced politely: it's a status update, not an interruption. */}
      <p aria-live="polite" className="sr-only">
        {copied ? "Command copied to clipboard." : ""}
      </p>

      {failed && (
        <p className="mt-2 text-xs text-muted-foreground">
          Your browser blocked clipboard access — select the command above and
          copy it manually.
        </p>
      )}
    </div>
  );
}
