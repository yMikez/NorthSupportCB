"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AdminShell } from "@/components/layout/AdminShell";

const BRAND_NAME = "Support Center";
const PAGE_SIZE = 25;

type Outcome =
  | "in_progress"
  | "refund_issued"
  | "refund_abandoned"
  | "resolved";

type Mood = "unknown" | "calm" | "disappointed" | "angry";

interface ConversationRow {
  id: string;
  receipt: string;
  vendor: string | null;
  productTitle: string | null;
  customerName: string | null;
  customerEmail: string | null;
  refundAmount: number | null;
  currency: string | null;
  startedAt: string;
  endedAt: string | null;
  lastActivityAt: string;
  initialMood: Mood;
  outcome: Outcome;
  retentionAttempts: number;
  messagesCount: number;
}

interface Stats {
  byOutcome: Record<Outcome, number>;
  byMood: Record<Mood, number>;
  byVendor: Record<string, number>;
  totalFinalized: number;
  retentionRate: number;
  refundRate: number;
}

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  conversations: ConversationRow[];
  stats: Stats;
  vendors: string[];
}

interface DetailMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface DetailResponse extends Omit<ConversationRow, "messagesCount"> {
  messages: DetailMessage[];
}

const OUTCOME_LABELS: Record<Outcome, string> = {
  in_progress: "In progress",
  refund_issued: "Refund issued",
  refund_abandoned: "Refund abandoned",
  resolved: "Resolved",
};

const OUTCOME_VARIANT: Record<Outcome, BadgeVariant> = {
  in_progress: "neutral",
  refund_issued: "warning",
  refund_abandoned: "info",
  resolved: "success",
};

const MOOD_LABELS: Record<Mood, string> = {
  unknown: "Unknown",
  calm: "Calm",
  disappointed: "Disappointed",
  angry: "Angry",
};

const MOOD_VARIANT: Record<Mood, BadgeVariant> = {
  unknown: "neutral",
  calm: "success",
  disappointed: "warning",
  angry: "error",
};

type Preset = "today" | "7d" | "30d" | "all" | "custom";

function isoDayStart(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function isoDayEnd(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

function computePresetRange(
  preset: Preset,
): { from: string; to: string } | null {
  const now = new Date();
  if (preset === "today") {
    return { from: isoDayStart(now), to: isoDayEnd(now) };
  }
  if (preset === "7d") {
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    return { from: isoDayStart(from), to: isoDayEnd(now) };
  }
  if (preset === "30d") {
    const from = new Date(now);
    from.setDate(from.getDate() - 29);
    return { from: isoDayStart(from), to: isoDayEnd(now) };
  }
  return null;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "< 1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || "USD"}`;
  }
}

export default function AdminPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [preset, setPreset] = useState<Preset>("7d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [vendor, setVendor] = useState<string>("");
  const [outcome, setOutcome] = useState<string>("");
  const [mood, setMood] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState(1);

  const [detailId, setDetailId] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();

    if (preset !== "all" && preset !== "custom") {
      const r = computePresetRange(preset);
      if (r) {
        params.set("from", r.from);
        params.set("to", r.to);
      }
    } else if (preset === "custom") {
      if (customFrom) params.set("from", new Date(customFrom).toISOString());
      if (customTo)
        params.set(
          "to",
          isoDayEnd(new Date(customTo)),
        );
    }

    if (vendor) params.set("vendor", vendor);
    if (outcome) params.set("outcome", outcome);
    if (mood) params.set("mood", mood);
    if (search.trim()) params.set("search", search.trim());
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    return params.toString();
  }, [preset, customFrom, customTo, vendor, outcome, mood, search, page]);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/admin/conversations?${queryString}`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not load conversations.");
        return;
      }
      setData(body);
    } catch {
      setError("Network error while loading conversations.");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [preset, customFrom, customTo, vendor, outcome, mood, search]);

  async function signOut() {
    await fetch("/api/admin/login", { method: "DELETE" });
    window.location.href = "/admin/login";
  }

  const stats = data?.stats;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <AdminShell brandName={BRAND_NAME} onSignOut={signOut}>
      <div className="animate-fade-in-up space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl sm:text-3xl">Conversations</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Real-time log of every AI support conversation.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={load}>
            Refresh
          </Button>
        </div>

        {error && (
          <Alert variant="error" onDismiss={() => setError("")}>
            {error}
          </Alert>
        )}

        {/* Filters */}
        <Card padding="md">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Period
              </label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(
                  [
                    ["today", "Today"],
                    ["7d", "7 days"],
                    ["30d", "30 days"],
                    ["all", "All"],
                    ["custom", "Custom"],
                  ] as [Preset, string][]
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPreset(k)}
                    className={
                      preset === k
                        ? "rounded-full border border-primary-500 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700"
                        : "rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-600 hover:border-neutral-300"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {preset === "custom" && (
              <>
                <FilterField label="From">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="admin-input"
                  />
                </FilterField>
                <FilterField label="To">
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="admin-input"
                  />
                </FilterField>
              </>
            )}

            <FilterField label="Vendor">
              <select
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="admin-input"
              >
                <option value="">All</option>
                {data?.vendors.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Outcome">
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className="admin-input"
              >
                <option value="">All</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
                <option value="refund_issued">Refund issued</option>
                <option value="refund_abandoned">Refund abandoned</option>
              </select>
            </FilterField>

            <FilterField label="Initial mood">
              <select
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                className="admin-input"
              >
                <option value="">All</option>
                <option value="calm">Calm</option>
                <option value="disappointed">Disappointed</option>
                <option value="angry">Angry</option>
                <option value="unknown">Unknown</option>
              </select>
            </FilterField>

            <FilterField label="Search">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Receipt, email or name…"
                className="admin-input"
                style={{ minWidth: "22ch" }}
              />
            </FilterField>
          </div>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Total" value={data?.total ?? 0} accent="neutral" />
          <KpiCard
            label="In progress"
            value={stats?.byOutcome.in_progress ?? 0}
            accent="neutral"
          />
          <KpiCard
            label="Resolved"
            value={stats?.byOutcome.resolved ?? 0}
            accent="success"
          />
          <KpiCard
            label="Refund abandoned"
            value={stats?.byOutcome.refund_abandoned ?? 0}
            accent="info"
          />
          <KpiCard
            label="Refund issued"
            value={stats?.byOutcome.refund_issued ?? 0}
            accent="warning"
          />
          <KpiCard
            label="Retention"
            value={
              stats
                ? `${(stats.retentionRate * 100).toFixed(0)}%`
                : "—"
            }
            accent="success"
            hint={
              stats && stats.totalFinalized > 0
                ? `${stats.byOutcome.refund_abandoned + stats.byOutcome.resolved}/${stats.totalFinalized} saved`
                : "No finalized yet"
            }
          />
        </div>

        {/* Table */}
        <Card padding="none" className="overflow-hidden">
          <div className="hidden border-b border-neutral-100 bg-[#f5f5f4] px-5 py-3 text-xs font-semibold uppercase tracking-[0.06em] text-[#57534e] md:grid md:grid-cols-12">
            <div className="md:col-span-2">Started</div>
            <div className="md:col-span-2">Customer</div>
            <div className="md:col-span-2">Receipt</div>
            <div className="md:col-span-1">Vendor</div>
            <div className="md:col-span-1">Mood</div>
            <div className="md:col-span-1">Msg</div>
            <div className="md:col-span-1">Duration</div>
            <div className="md:col-span-2">Outcome</div>
          </div>

          {loading && !data ? (
            <div className="px-5 py-12 text-center text-sm text-neutral-500">
              Loading conversations…
            </div>
          ) : !data || data.conversations.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="font-serif text-lg">No conversations found.</p>
              <p className="mt-1 text-sm text-neutral-500">
                Adjust your filters or wait for new customers to come through.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {data.conversations.map((c, idx) => {
                const stripe = idx % 2 === 1 ? "bg-neutral-50/50" : "bg-white";
                const name =
                  c.customerName ||
                  c.customerEmail ||
                  "Unknown";
                return (
                  <li
                    key={c.id}
                    onClick={() => setDetailId(c.id)}
                    className={`${stripe} cursor-pointer px-5 py-4 text-sm transition-colors duration-100 hover:bg-[#fafaf9] md:grid md:grid-cols-12 md:items-center`}
                  >
                    <div className="text-neutral-700 md:col-span-2">
                      {formatDateTime(c.startedAt)}
                    </div>
                    <div className="mt-1 text-neutral-700 md:col-span-2 md:mt-0">
                      <div className="font-medium text-neutral-900">{name}</div>
                      {c.customerEmail && c.customerName && (
                        <div className="text-xs text-neutral-500">
                          {c.customerEmail}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-xs text-neutral-700 md:col-span-2 md:mt-0">
                      {c.receipt}
                    </div>
                    <div className="mt-1 md:col-span-1 md:mt-0">
                      {c.vendor ? (
                        <Badge variant="neutral">{c.vendor}</Badge>
                      ) : (
                        <span className="text-xs text-neutral-300">—</span>
                      )}
                    </div>
                    <div className="mt-1 md:col-span-1 md:mt-0">
                      <Badge variant={MOOD_VARIANT[c.initialMood]}>
                        {MOOD_LABELS[c.initialMood]}
                      </Badge>
                    </div>
                    <div className="mt-1 text-neutral-700 md:col-span-1 md:mt-0">
                      {c.messagesCount}
                    </div>
                    <div className="mt-1 text-neutral-600 md:col-span-1 md:mt-0">
                      {formatDuration(c.startedAt, c.endedAt)}
                    </div>
                    <div className="mt-2 md:col-span-2 md:mt-0">
                      <Badge variant={OUTCOME_VARIANT[c.outcome]}>
                        {OUTCOME_LABELS[c.outcome]}
                      </Badge>
                      {c.outcome === "refund_issued" && c.refundAmount && (
                        <div className="mt-0.5 text-xs text-neutral-500">
                          {formatMoney(c.refundAmount, c.currency)}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {data && data.total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-neutral-100 bg-[#fafaf9] px-5 py-3 text-sm">
              <span className="text-neutral-600">
                Page {data.page} of {totalPages} · {data.total} total
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() =>
                    setPage((p) => Math.min(totalPages, p + 1))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {detailId && (
        <ConversationDrawer
          conversationId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}

      <style jsx>{`
        .admin-input {
          min-width: 10ch;
          padding: 0.375rem 0.625rem;
          border: 1.5px solid #e7e5e4;
          border-radius: 8px;
          font-size: 0.875rem;
          background: #ffffff;
          color: #1c1917;
        }
        .admin-input:focus {
          outline: none;
          border-color: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
        }
      `}</style>
    </AdminShell>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent: "neutral" | "success" | "warning" | "info";
}) {
  const accentClass =
    accent === "success"
      ? "border-l-4 border-l-primary-500"
      : accent === "warning"
        ? "border-l-4 border-l-amber-500"
        : accent === "info"
          ? "border-l-4 border-l-blue-500"
          : "border-l-4 border-l-neutral-300";
  return (
    <div
      className={`rounded-[14px] border border-[#f0f0ef] bg-white p-4 shadow-sm ${accentClass}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-[#a8a29e]">
        {label}
      </p>
      <p className="mt-1 font-serif text-2xl font-semibold text-[#1c1917]">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

function ConversationDrawer({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `/api/admin/conversations/${conversationId}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? "Could not load.");
          return;
        }
        setData(body);
      } catch {
        if (!cancelled) setError("Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <div>
            <h2 className="font-serif text-lg">Conversation</h2>
            {data && (
              <p className="mt-0.5 text-xs text-neutral-500">
                {formatDateTime(data.startedAt)} · {data.messages.length}{" "}
                messages
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        {loading && (
          <div className="flex-1 p-6 text-sm text-neutral-500">Loading…</div>
        )}
        {error && (
          <div className="p-6">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {data && (
          <>
            <div className="border-b border-neutral-100 bg-[#fafaf9] px-6 py-4">
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <InfoCell
                  label="Customer"
                  value={
                    data.customerName || data.customerEmail || "Unknown"
                  }
                />
                <InfoCell label="Receipt" value={data.receipt} />
                <InfoCell label="Vendor" value={data.vendor ?? "—"} />
                <InfoCell
                  label="Product"
                  value={data.productTitle ?? "—"}
                />
                <InfoCell
                  label="Refund amount"
                  value={formatMoney(data.refundAmount, data.currency)}
                />
                <InfoCell
                  label="Duration"
                  value={formatDuration(data.startedAt, data.endedAt)}
                />
                <InfoCell
                  label="Initial mood"
                  value={MOOD_LABELS[data.initialMood]}
                />
                <InfoCell
                  label="Outcome"
                  value={OUTCOME_LABELS[data.outcome]}
                />
                <InfoCell
                  label="Retention attempts"
                  value={String(data.retentionAttempts)}
                />
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              {data.messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.role === "assistant"
                      ? "flex justify-start"
                      : "flex justify-end"
                  }
                >
                  <div
                    className={
                      m.role === "assistant"
                        ? "max-w-[80%] rounded-2xl rounded-bl-sm border border-neutral-200 bg-[#f0fdf4] px-4 py-3 text-sm text-neutral-800"
                        : "max-w-[80%] rounded-2xl rounded-br-sm bg-primary-500 px-4 py-3 text-sm text-white"
                    }
                  >
                    <div className="whitespace-pre-wrap">{m.content}</div>
                    <div
                      className={
                        m.role === "assistant"
                          ? "mt-1 text-[10px] text-neutral-400"
                          : "mt-1 text-[10px] text-white/70"
                      }
                    >
                      {formatDateTime(m.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-neutral-900">{value}</div>
    </div>
  );
}
