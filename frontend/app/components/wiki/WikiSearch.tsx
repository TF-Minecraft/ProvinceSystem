"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { normalizeSearchText, searchWikiIndex, type WikiSearchEntry } from "@/lib/wikiSearch";

type LoadState = "loading" | "ready" | "error";

type NormalizedCharacter = { value: string; start: number; end: number };

function normalizedCharacters(text: string): NormalizedCharacter[] {
  const characters: NormalizedCharacter[] = [];
  for (let start = 0; start < text.length;) {
    const original = String.fromCodePoint(text.codePointAt(start)!);
    const end = start + original.length;
    if (/^[\u0300-\u036f]$/.test(original)) {
      for (let index = characters.length - 1; index >= 0 && characters[index].end === start; index -= 1) {
        characters[index].end = end;
      }
      start = end;
      continue;
    }
    const normalized = normalizeSearchText(original);
    if (normalized) {
      for (const value of normalized) characters.push({ value, start, end });
    } else if (characters.length && characters.at(-1)?.value !== " ") {
      characters.push({ value: " ", start, end });
    }
    start = end;
  }
  return characters;
}

export function highlightSearchText(text: string, query: string): ReactNode {
  const tokens = [...new Set(normalizeSearchText(query).split(" ").filter(Boolean))];
  if (!tokens.length || !text) return text;

  const characters = normalizedCharacters(text);
  const normalizedText = characters.map(({ value }) => value).join("");
  const matches: Array<{ start: number; end: number }> = [];
  for (const token of tokens) {
    let matchAt = normalizedText.indexOf(token);
    while (matchAt >= 0) {
      matches.push({
        start: characters[matchAt].start,
        end: characters[matchAt + token.length - 1].end,
      });
      matchAt = normalizedText.indexOf(token, matchAt + 1);
    }
  }
  if (!matches.length) return text;

  matches.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = matches.reduce<Array<{ start: number; end: number }>>((ranges, match) => {
    const previous = ranges.at(-1);
    if (previous && match.start <= previous.end) previous.end = Math.max(previous.end, match.end);
    else ranges.push({ ...match });
    return ranges;
  }, []);

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of merged) {
    if (match.start > cursor) parts.push(text.slice(cursor, match.start));
    parts.push(
      <strong key={`${match.start}:${match.end}`} className="font-bold text-[var(--tfmc-cream)]">
        {text.slice(match.start, match.end)}
      </strong>,
    );
    cursor = match.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export default function WikiSearch() {
  const [entries, setEntries] = useState<WikiSearchEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const listId = useId();
  const results = useMemo(() => searchWikiIndex(entries, query), [entries, query]);
  const [dismissed, setDismissed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isOpen = query.trim().length > 0 && !dismissed;

  // Clicking or tabbing anywhere outside closes the results but keeps the typed query.
  useEffect(() => {
    const onOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setDismissed(true);
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/wiki/search-index.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Search index unavailable");
        return response.json() as Promise<WikiSearchEntry[]>;
      })
      .then((index) => {
        setEntries(index);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("error");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setActiveIndex(results.length ? 0 : -1);
  }, [query, results.length]);

  useEffect(() => {
    if (activeIndex >= 0) {
      const activeResult = resultRefs.current[activeIndex];
      if (typeof activeResult?.scrollIntoView === "function") {
        activeResult.scrollIntoView({ block: "nearest" });
      }
    }
  }, [activeIndex]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setQuery("");
      setActiveIndex(-1);
      inputRef.current?.focus();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + direction + results.length) % results.length);
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      resultRefs.current[activeIndex]?.click();
    }
  }

  return (
    <div ref={rootRef} className="relative mt-3" role="search">
      <label className="sr-only" htmlFor={`${listId}-input`}>
        Search the gameplay guide
      </label>
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="search"
        value={query}
        placeholder="Search the guide"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          setDismissed(false);
        }}
        onFocus={() => setDismissed(false)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-[color-mix(in_srgb,var(--tfmc-stone)_45%,transparent)] bg-[var(--tfmc-forest-deep)] px-3 py-2 text-sm text-[var(--tfmc-cream)] outline-none placeholder:text-[var(--tfmc-stone)] focus:border-[var(--tfmc-mist)]"
      />
      {isOpen ? (
        <div className="absolute left-0 z-50 mt-1 max-h-80 w-[min(22rem,calc(100vw-3rem))] overflow-y-auto rounded-md border border-[color-mix(in_srgb,var(--tfmc-stone)_45%,transparent)] bg-[var(--tfmc-forest-deep)] p-1 shadow-xl">
          {loadState === "loading" ? (
            <p className="px-3 py-2 text-sm text-[var(--tfmc-stone)]">Loading search...</p>
          ) : null}
          {loadState === "error" ? (
            <p role="status" className="px-3 py-2 text-sm text-[var(--tfmc-stone)]">
              Search is unavailable right now.
            </p>
          ) : null}
          {loadState === "ready" && !results.length ? (
            <p role="status" className="px-3 py-2 text-sm text-[var(--tfmc-stone)]">
              No guide results found.
            </p>
          ) : null}
          {loadState === "ready" && results.length ? (
            <ul id={listId} role="listbox" aria-label="Guide search results">
              {results.map((result, index) => (
                <li key={`${result.href}:${result.sectionTitle ?? result.pageTitle}`}>
                  <a
                    ref={(node) => {
                      resultRefs.current[index] = node;
                    }}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    href={result.href}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`block rounded px-3 py-2 ${index === activeIndex ? "bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]" : ""}`}
                  >
                    <span className="block text-sm text-[var(--tfmc-cream)]">
                      {result.sectionTitle ?? result.pageTitle}
                    </span>
                    {result.sectionTitle ? (
                      <span className="block text-xs text-[var(--tfmc-mist)]">{result.pageTitle}</span>
                    ) : null}
                    <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-[var(--tfmc-stone)]">
                      {highlightSearchText(result.snippet, query)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
