"use client";

import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";

export type SqlEditorHandle = { insert: (text: string) => void; focus: () => void };

type Props = {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  label: string;
  footer?: React.ReactNode;
};

/** A plain textarea with a line gutter: Tab indents, Ctrl or ⌘ + Enter runs. */
const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(
  { value, onChange, onRun, label, footer },
  ref,
) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState({ line: 1, column: 1 });

  function track() {
    const el = area.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const lines = before.split("\n");
    setCaret({ line: lines.length, column: lines[lines.length - 1].length + 1 });
  }

  function replaceSelection(text: string) {
    const el = area.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + text.length;
      el.focus();
      track();
    });
  }

  useImperativeHandle(ref, () => ({ insert: replaceSelection, focus: () => area.current?.focus() }));

  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onRun();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      replaceSelection("  ");
    }
  }

  const lines = Math.max(1, value.split("\n").length);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={gutter}
          aria-hidden
          className="w-11 shrink-0 select-none overflow-hidden py-3 pr-3 text-right font-mono text-[13px] leading-6 text-[color-mix(in_srgb,var(--tfmc-mist)_55%,transparent)]"
        >
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={i + 1 === caret.line ? "text-[var(--tfmc-cream)]" : undefined}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={area}
          aria-label={label}
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="SELECT * FROM … LIMIT 100"
          onChange={(e) => {
            onChange(e.target.value);
            track();
          }}
          onKeyDown={keyDown}
          onKeyUp={track}
          onClick={track}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          className="min-h-0 flex-1 resize-none bg-transparent py-3 pr-4 font-mono text-[13px] leading-6 text-[var(--tfmc-cream)] caret-[var(--tfmc-accent)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_45%,transparent)]"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <span className="font-mono text-xs text-[var(--tfmc-mist)]">
          Ln {caret.line}, Col {caret.column}
        </span>
        {footer}
      </div>
    </div>
  );
});

export default SqlEditor;
