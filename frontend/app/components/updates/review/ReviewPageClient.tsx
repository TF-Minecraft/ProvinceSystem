"use client";

import { useCallback, useEffect, useState } from "react";

import { WeekSections } from "@/app/components/updates/WeekArchiveList";
import { useSiteStaffAccess } from "@/app/hooks/useSiteStaffAccess";
import { getSession, isSessionValid } from "@/lib/characters/session";
import {
  isWeekKey,
  SECTION_LABELS,
  SECTION_ORDER,
  type PublicBullet,
  type SectionName,
} from "@/lib/patchnotes/notes";
import {
  addReviewBullet,
  approveReviewWeek,
  dropReviewBullet,
  getReviewJob,
  listReviewWeeks,
  loadReviewWeek,
  patchReviewBullet,
  postponeReviewWeek,
  resetReviewWeek,
  restoreReviewBullet,
  sortReviewWeek,
  submitReviewFeedback,
  undoReviewPostpone,
  type ReviewBullet,
  type ReviewPayload,
  type ReviewWeek,
} from "@/lib/patchnotes/review";

import AddLine from "./AddLine";
import RemovedLines from "./RemovedLines";
import ReviewSection from "./ReviewSection";
import ReviewToolbar, { type ToolbarPanel } from "./ReviewToolbar";

export default function ReviewPageClient() {
  const { state } = useSiteStaffAccess();
  const [token, setToken] = useState("");
  const [weeks, setWeeks] = useState<ReviewWeek[]>([]);
  const [week, setWeek] = useState("");
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [addSection, setAddSection] = useState<SectionName>("new");
  const [addText, setAddText] = useState("");
  const [panel, setPanel] = useState<ToolbarPanel>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const activeJob = review?.job?.status === "queued" || review?.job?.status === "running"
    ? review.job
    : null;
  const disabled = busy || Boolean(activeJob);
  const waitingCount = review?.bullets.filter((bullet) => bullet.status === "pending").length ?? 0;

  const reloadWeek = useCallback(async (target: string, auth: string) => {
    setError("");
    try {
      setReview(await loadReviewWeek(auth, target));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this week.");
    }
  }, []);

  const reloadAll = useCallback(async (target: string, auth: string) => {
    const results = await Promise.allSettled([
      loadReviewWeek(auth, target),
      listReviewWeeks(auth),
    ]);
    if (results[0].status === "fulfilled") {
      setReview(results[0].value);
    } else {
      setError(results[0].reason instanceof Error
        ? results[0].reason.message
        : "Could not load this week.");
    }
    if (results[1].status === "fulfilled") {
      setWeeks(results[1].value.weeks);
    } else {
      setError(results[1].reason instanceof Error
        ? results[1].reason.message
        : "Could not load review weeks.");
    }
  }, []);

  const setLineError = useCallback((id: string, value: string) => {
    setLineErrors((current) => ({ ...current, [id]: value }));
  }, []);

  const runAction = useCallback(async (
    action: () => Promise<unknown>,
    message?: (result: unknown) => string,
  ) => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await action();
      if (message) setSuccess(message(result));
      if (week) await reloadAll(week, token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }, [reloadAll, token, week]);

  const updateLine = useCallback(async (
    bullet: ReviewBullet,
    patch: Parameters<typeof patchReviewBullet>[2],
  ) => {
    setError("");
    try {
      const updated = await patchReviewBullet(token, bullet.id, patch);
      setLineError(bullet.id, "");
      setReview((current) => current
        ? {
          ...current,
          bullets: current.bullets.map((item) => item.id === updated.id ? updated : item),
        }
        : current);
    } catch (reason) {
      setLineError(bullet.id, reason instanceof Error
        ? reason.message
        : "Could not update this line.");
    }
  }, [setLineError, token]);

  const removeLine = useCallback(async (bullet: ReviewBullet) => {
    try {
      const updated = await dropReviewBullet(token, bullet.id);
      setReview((current) => current
        ? {
          ...current,
          bullets: current.bullets.filter((item) => item.id !== bullet.id),
          removed: [updated, ...current.removed],
        }
        : current);
      setLineError(bullet.id, "");
    } catch (reason) {
      setLineError(bullet.id, reason instanceof Error
        ? reason.message
        : "Could not remove this line.");
    }
  }, [setLineError, token]);

  const restoreLine = useCallback(async (bullet: ReviewBullet) => {
    try {
      const updated = await restoreReviewBullet(token, bullet.id);
      setReview((current) => current
        ? {
          ...current,
          removed: current.removed.filter((item) => item.id !== bullet.id),
          bullets: [...current.bullets, updated],
        }
        : current);
      setLineError(bullet.id, "");
    } catch (reason) {
      setLineError(bullet.id, reason instanceof Error
        ? reason.message
        : "Could not restore this line.");
    }
  }, [setLineError, token]);

  const chooseWeek = useCallback((value: string) => {
    setReview(null);
    setWeek(value);
    setError("");
    setSuccess("");
    setLineErrors({});
  }, []);

  const confirmAction = useCallback(() => {
    if (!panel || panel === "feedback") return;
    const selected = panel;
    setPanel(null);
    const action = selected === "sort"
      ? () => sortReviewWeek(token, week)
      : selected === "reset"
        ? () => resetReviewWeek(token, week)
        : review?.postponed
          ? () => undoReviewPostpone(token, week)
          : () => postponeReviewWeek(token, week);
    void runAction(action, selected === "sort"
      ? undefined
      : () => selected === "reset"
        ? "Week reset."
        : review?.postponed ? "Postponement undone." : "Week postponed.");
  }, [panel, review?.postponed, runAction, token, week]);

  useEffect(() => {
    if (state !== "staff") {
      setToken("");
      return;
    }
    const session = getSession();
    setToken(isSessionValid(session) ? session?.session_token ?? "" : "");
  }, [state]);

  useEffect(() => {
    if (state !== "staff" || !token) return;
    let cancelled = false;
    void (async () => {
      try {
        const index = await listReviewWeeks(token);
        if (cancelled) return;
        setWeeks(index.weeks);
        const params = new URLSearchParams(window.location.search);
        const requested = params.get("week");
        const selected = requested && isWeekKey(requested)
          ? requested
          : index.weeks.find((item) => item.pending > 0)?.week ?? index.weeks[0]?.week ?? "";
        setWeek(selected);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Could not load review weeks.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, token]);

  useEffect(() => {
    if (!week || !token) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("week") !== week) {
      params.set("week", week);
      window.history.replaceState(
        null,
        "",
        window.location.pathname + "?" + params.toString(),
      );
    }
    void reloadWeek(week, token);
  }, [reloadWeek, token, week]);

  useEffect(() => {
    if (!activeJob || !token) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await getReviewJob(token, activeJob.id);
        if (cancelled) return;
        if (result.job.status === "queued" || result.job.status === "running") {
          setReview((current) => current ? { ...current, job: result.job } : current);
          return;
        }
        setReview((current) => current ? { ...current, job: result.job } : current);
        if (result.job.status === "done") {
          setError("");
          setSuccess(result.job.changed
            ? "Sol changed " + result.job.changed + " lines."
            : "Nothing changed.");
        } else if (result.job.error) {
          setError(result.job.error);
        }
        await reloadAll(week, token);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error
            ? reason.message
            : "Could not check the rewrite status.");
        }
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJob?.id, reloadAll, token, week]);

  if (state === "loading") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm text-[var(--tfmc-mist)]">Checking access…</p>
      </main>
    );
  }
  if (state !== "staff") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm text-[var(--tfmc-mist)]">
          This page is for staff. Sign in with a staff account to review weekly notes.
        </p>
      </main>
    );
  }

  const currentWeek = weeks.find((item) => item.week === week);
  const grouped: Record<SectionName, ReviewBullet[]> = {
    new: [],
    fixed: [],
    adjusted: [],
    technical: [],
  };
  for (const bullet of review?.bullets ?? []) grouped[bullet.section].push(bullet);
  const search = filter.trim().toLocaleLowerCase();
  const matchingBySection = Object.fromEntries(SECTION_ORDER.map((section) => [
    section,
    grouped[section].filter((bullet) => bullet.body.toLocaleLowerCase().includes(search)),
  ])) as Record<SectionName, ReviewBullet[]>;
  const activeJobMessage = activeJob
    ? activeJob.kind === "sort" ? "Sol is sorting the note." : "Sol is rewriting the note from the feedback."
    : null;

  return (
    <main className="mx-auto min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Review weekly notes
      </h1>
      <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
        Read and edit every line before the weekly notes are published.
      </p>
      {weeks.length > 0 && (
        <nav className="mt-4 flex flex-wrap gap-1.5" aria-label="Review weeks">
          {weeks.map((item) => (
            <button
              key={item.week}
              className={"rounded-sm border px-2 py-1 text-xs text-[var(--tfmc-cream)] " +
                (item.week === week
                  ? "border-[var(--tfmc-accent)]"
                  : "border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)]")}
              type="button"
              onClick={() => chooseWeek(item.week)}
            >
              {item.label} ({item.week === review?.week ? waitingCount : item.pending})
            </button>
          ))}
        </nav>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-[var(--tfmc-accent)]">{error}</p>}
      {success && <p role="status" className="mt-3 text-sm text-[var(--tfmc-accent)]">{success}</p>}
      {!week ? (
        <p className="mt-8 text-sm text-[var(--tfmc-stone)]">There are no weeks to review.</p>
      ) : review && (
        <>
          <header
            className="mt-5 border-b
              border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] pb-3"
          >
            <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
              {currentWeek?.label ?? review.week}
            </h2>
            <p className="mt-1 text-xs text-[var(--tfmc-stone)]">
              {SECTION_ORDER
                .map((name) => SECTION_LABELS[name] + " " + grouped[name].length)
                .join(" · ")}
            </p>
            {review.postponed && (
              <p className="mt-1 text-xs text-[var(--tfmc-accent)]">This week is postponed.</p>
            )}
            {activeJobMessage && (
              <p className="mt-1 text-xs text-[var(--tfmc-accent)]">{activeJobMessage}</p>
            )}
            {!activeJob && review.job?.status === "failed" && (
              <p className="mt-1 text-xs text-[var(--tfmc-accent)]">
                {review.job.error ?? "The rewrite failed."}
              </p>
            )}
          </header>
          <ReviewToolbar
            filter={filter}
            preview={preview}
            feedback={feedback}
            confirm={panel}
            postponed={review.postponed}
            disabled={disabled}
            waitingCount={waitingCount}
            onFilterChange={setFilter}
            onPreviewToggle={() => setPreview((value) => !value)}
            onApprove={() => void runAction(
              async () => await approveReviewWeek(token, week) as { approved?: unknown },
              (result) => {
                const approved = (result as { approved?: unknown }).approved;
                return typeof approved === "number"
                  ? "Approved " + approved + " lines."
                  : "Week approved.";
              },
            )}
            onConfirmSelect={setPanel}
            onConfirm={confirmAction}
            onFeedbackChange={setFeedback}
            onFeedbackSend={() => {
              void runAction(async () => {
                const job = await submitReviewFeedback(token, week, feedback.trim());
                setFeedback("");
                setPanel(null);
                setReview((current) => current ? { ...current, job } : current);
                return job;
              });
            }}
            onFeedbackCancel={() => {
              setFeedback("");
              setPanel(null);
            }}
          />
          {preview ? (
            <section className="mt-4">
              <WeekSections
                bullets={review.bullets.map((bullet): PublicBullet => ({
                  id: bullet.id,
                  section: bullet.section,
                  body: bullet.body,
                  ...(bullet.topic ? { topic: bullet.topic } : {}),
                  ...(bullet.highlight ? { highlight: true } : {}),
                }))}
              />
            </section>
          ) : (
            <div className="mt-3">
              {SECTION_ORDER.map((section) => (
                <ReviewSection
                  key={section}
                  section={section}
                  bullets={matchingBySection[section]}
                  matchCount={matchingBySection[section].length}
                  filtering={search.length > 0}
                  disabled={disabled}
                  lineErrors={lineErrors}
                  onPatch={updateLine}
                  onDrop={(bullet) => void removeLine(bullet)}
                  onError={setLineError}
                />
              ))}
            </div>
          )}
          <RemovedLines
            bullets={review.removed}
            disabled={disabled}
            errors={lineErrors}
            onRestore={(bullet) => void restoreLine(bullet)}
          />
          <AddLine
            section={addSection}
            text={addText}
            disabled={disabled}
            onSectionChange={setAddSection}
            onTextChange={setAddText}
            onAdd={() => void runAction(async () => {
              const bullet = await addReviewBullet(token, week, addSection, addText.trim());
              setAddText("");
              setReview((current) => current
                ? { ...current, bullets: [...current.bullets, bullet] }
                : current);
              return bullet;
            })}
          />
        </>
      )}
    </main>
  );
}
