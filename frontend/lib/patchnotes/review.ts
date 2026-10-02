import {
  isSectionName,
  isTopicName,
  isWeekKey,
  weekLabel,
  type SectionName,
  type TopicName,
} from "./notes";

export type ReviewBullet = {
  id: string;
  week?: string;
  section: SectionName;
  body: string;
  topic: TopicName | null;
  highlight: boolean;
  status: "pending" | "approved" | "denied";
  deny_reason: string | null;
  warning: string | null;
};

export type ReviewJob = {
  id: string;
  week: string;
  kind: "feedback" | "sort";
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  changed: number | null;
  feedback: string | null;
  created_at: string;
  finished_at: string | null;
};

export type ReviewWeek = {
  week: string;
  label: string;
  pending: number;
  approved: number;
  denied: number;
  postponed: boolean;
};

export type ReviewPayload = {
  week: string;
  postponed: boolean;
  deferredTo: string | null;
  bullets: ReviewBullet[];
  removed: ReviewBullet[];
  job: ReviewJob | null;
};

const REQUEST_TIMEOUT_MS = 10000;

function apiBase(): string | null {
  const value = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/$/, "");
  return value || null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readReviewBullet(value: unknown): ReviewBullet | null {
  const row = record(value);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.section !== "string" ||
    !isSectionName(row.section) ||
    typeof row.body !== "string"
  ) {
    return null;
  }
  const status = row.status;
  if (status !== "pending" && status !== "approved" && status !== "denied") return null;

  return {
    id: row.id,
    ...(typeof row.week === "string" ? { week: row.week } : {}),
    section: row.section,
    body: row.body,
    topic: typeof row.topic === "string" && isTopicName(row.topic) ? row.topic : null,
    highlight: row.highlight === true,
    status,
    deny_reason: typeof row.deny_reason === "string" ? row.deny_reason : null,
    warning: typeof row.warning === "string" ? row.warning : null,
  };
}

export function readReviewJob(value: unknown): ReviewJob | null {
  const row = record(value);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.week !== "string" ||
    !isWeekKey(row.week) ||
    (row.kind !== "feedback" && row.kind !== "sort") ||
    !["queued", "running", "done", "failed"].includes(String(row.status)) ||
    typeof row.created_at !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    week: row.week,
    kind: row.kind,
    status: row.status as ReviewJob["status"],
    error: typeof row.error === "string" ? row.error : null,
    changed: typeof row.changed === "number" ? row.changed : null,
    feedback: typeof row.feedback === "string" ? row.feedback : null,
    created_at: row.created_at,
    finished_at: typeof row.finished_at === "string" ? row.finished_at : null,
  };
}

export function readReviewPayload(value: unknown): ReviewPayload | null {
  const row = record(value);
  if (
    !row ||
    typeof row.week !== "string" ||
    !isWeekKey(row.week) ||
    !Array.isArray(row.bullets) ||
    !Array.isArray(row.removed)
  ) {
    return null;
  }
  const bullets = row.bullets
    .map(readReviewBullet)
    .filter((item): item is ReviewBullet => item !== null);
  const removed = row.removed
    .map(readReviewBullet)
    .filter((item): item is ReviewBullet => item !== null);

  return {
    week: row.week,
    postponed: row.postponed === true,
    deferredTo: typeof row.deferred_to === "string" ? row.deferred_to : null,
    bullets,
    removed,
    job: readReviewJob(row.job),
  };
}

async function request<T>(
  token: string,
  path: string,
  init?: RequestInit,
  parse?: (body: unknown) => T | null,
): Promise<T> {
  const root = apiBase();
  if (!root) throw new Error("NEXT_PUBLIC_API_URL is not set");
  const response = await fetch(root + "/patchnotes" + path, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: "Bearer " + token,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = record(body)?.detail;
    throw new Error(
      typeof detail === "string" ? detail : "Request failed (" + response.status + ").",
    );
  }
  const result = parse ? parse(body) : body as T;
  if (result === null) throw new Error("The server returned an invalid response.");
  return result;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

function readBulletResponse(value: unknown): ReviewBullet | null {
  return readReviewBullet(value);
}

export async function listReviewWeeks(
  token: string,
): Promise<{ current: string | null; weeks: ReviewWeek[] }> {
  return request(token, "/staff/weeks", undefined, (value) => {
    const row = record(value);
    if (!row || !Array.isArray(row.weeks)) return null;
    const weeks: ReviewWeek[] = [];
    for (const raw of row.weeks) {
      const item = record(raw);
      if (!item || typeof item.week !== "string" || !isWeekKey(item.week)) continue;
      weeks.push({
        week: item.week,
        label: weekLabel(item.week),
        pending: Number.isFinite(item.pending) ? Number(item.pending) : 0,
        approved: Number.isFinite(item.approved) ? Number(item.approved) : 0,
        denied: Number.isFinite(item.denied) ? Number(item.denied) : 0,
        postponed: item.postponed === true,
      });
    }
    return {
      current: typeof row.current === "string" && isWeekKey(row.current) ? row.current : null,
      weeks,
    };
  });
}

export function loadReviewWeek(token: string, week: string): Promise<ReviewPayload> {
  const path = "/staff/weeks/" + encodeURIComponent(week) + "/review";
  return request(token, path, undefined, readReviewPayload);
}

export function patchReviewBullet(
  token: string,
  id: string,
  patch: Partial<Pick<ReviewBullet, "section" | "body" | "topic" | "highlight">>,
): Promise<ReviewBullet> {
  const path = "/staff/bullets/" + encodeURIComponent(id);
  return request(token, path, json("PATCH", patch), readBulletResponse);
}

export function dropReviewBullet(token: string, id: string): Promise<ReviewBullet> {
  const path = "/staff/bullets/" + encodeURIComponent(id) + "/drop";
  return request(token, path, json("POST"), readBulletResponse);
}

export function restoreReviewBullet(token: string, id: string): Promise<ReviewBullet> {
  const path = "/staff/bullets/" + encodeURIComponent(id) + "/restore";
  return request(token, path, json("POST"), readBulletResponse);
}

export function addReviewBullet(
  token: string,
  week: string,
  section: SectionName,
  body: string,
): Promise<ReviewBullet> {
  return request(token, "/staff/bullets", json("POST", { week, section, body }), readBulletResponse);
}

export function approveReviewWeek(token: string, week: string): Promise<unknown> {
  const path = "/staff/weeks/" + encodeURIComponent(week) + "/auto-approve";
  return request(token, path, json("POST"));
}

export async function submitReviewFeedback(
  token: string,
  week: string,
  feedback: string,
): Promise<ReviewJob> {
  const path = "/staff/weeks/" + encodeURIComponent(week) + "/feedback";
  return request(token, path, json("POST", { feedback }), (value) => {
    return readReviewJob(record(value)?.job);
  });
}

export async function sortReviewWeek(token: string, week: string): Promise<ReviewJob> {
  const path = "/staff/weeks/" + encodeURIComponent(week) + "/sort";
  return request(token, path, json("POST"), (value) => readReviewJob(record(value)?.job));
}

export async function getReviewJob(
  token: string,
  id: string,
): Promise<{ job: ReviewJob; bullets: ReviewBullet[] | null }> {
  const path = "/staff/jobs/" + encodeURIComponent(id);
  return request(token, path, undefined, (value) => {
    const row = record(value);
    const job = readReviewJob(row?.job);
    if (!job) return null;
    const bullets = Array.isArray(row?.bullets)
      ? row.bullets.map(readReviewBullet).filter((item): item is ReviewBullet => item !== null)
      : null;
    return { job, bullets };
  });
}

export function postponeReviewWeek(token: string, week: string): Promise<unknown> {
  const path = "/staff/weeks/" + encodeURIComponent(week) + "/postpone";
  return request(token, path, json("POST"));
}

export function undoReviewPostpone(token: string, week: string): Promise<unknown> {
  const path = "/staff/weeks/" + encodeURIComponent(week) + "/undo-postpone";
  return request(token, path, json("POST"));
}

export function resetReviewWeek(token: string, week: string): Promise<unknown> {
  const path = "/staff/weeks/" + encodeURIComponent(week) + "/reset";
  return request(token, path, json("POST"));
}
