"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type RefundStatus = "pending" | "processed" | "failed" | "cancelled";

interface RefundRow {
  id: string;
  kind: "refund" | "handoff";
  urgent: boolean;
  platform: string;
  platformLabel: string;
  orderId: string;
  conversationId: string | null;
  vendor: string | null;
  productTitle: string | null;
  customerName: string | null;
  customerEmail: string | null;
  amount: number | null;
  currency: string | null;
  status: RefundStatus;
  note: string | null;
  createdAt: string;
  processedAt: string | null;
}

interface QueueResponse {
  status: string;
  total: number;
  refunds: RefundRow[];
}

const STATUS_VARIANT: Record<RefundStatus, BadgeVariant> = {
  pending: "warning",
  processed: "success",
  failed: "error",
  cancelled: "neutral",
};

const STATUS_LABEL: Record<RefundStatus, string> = {
  pending: "Awaiting action",
  processed: "Processed",
  failed: "Failed",
  cancelled: "Cancelled",
};

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

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ageInHours(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

/**
 * Refunds the agent promised the customer that a human still has to execute on
 * the platform dashboard (JVZoo always, the others when their API is off or
 * failed). Everything here is money already committed to — the age warning
 * exists so nothing sits forgotten and turns into a chargeback.
 */
export function RefundQueue({
  onCountChange,
  onOpenConversation,
}: {
  onCountChange?: (n: number) => void;
  /** Opens the transcript drawer so the operator can read before replying. */
  onOpenConversation?: (conversationId: string) => void;
}) {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/admin/refunds?status=${status}`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not load the refund queue.");
        return;
      }
      setData(body);
      if (status === "pending") onCountChange?.(body.total);
    } catch {
      setError("Network error while loading the refund queue.");
    } finally {
      setLoading(false);
    }
  }, [status, onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateStatus(id: string, next: RefundStatus) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/refunds/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not update that refund.");
        return;
      }
      await load();
    } catch {
      setError("Network error while updating the refund.");
    } finally {
      setBusyId(null);
    }
  }

  const rows = data?.refunds ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">Work queue</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Conversations the agent handed over. Each one has a customer waiting
            for a human reply — open the transcript before you answer.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex gap-1.5">
            {(
              [
                ["pending", "Awaiting action"],
                ["all", "All"],
              ] as ["pending" | "all", string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatus(key)}
                className={
                  status === key
                    ? "rounded-full border border-primary-500 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700"
                    : "rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-600 hover:border-neutral-300"
                }
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="error" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      <Card padding="none" className="overflow-hidden">
        {loading && !data ? (
          <div className="px-5 py-12 text-center text-sm text-neutral-500">
            Loading refund queue…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="font-serif text-lg">Nothing waiting.</p>
            <p className="mt-1 text-sm text-neutral-500">
              Every handed-over conversation has been dealt with.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {rows.map((row) => {
              const hours = ageInHours(row.createdAt);
              const overdue = row.status === "pending" && hours > 24;
              return (
                <li
                  key={row.id}
                  className={`px-5 py-4 text-sm ${overdue ? "bg-amber-50/60" : "bg-white"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {row.urgent && (
                          <Badge variant="error">URGENT</Badge>
                        )}
                        <Badge variant={STATUS_VARIANT[row.status]}>
                          {STATUS_LABEL[row.status]}
                        </Badge>
                        <Badge variant={row.kind === "handoff" ? "info" : "warning"}>
                          {row.kind === "handoff" ? "Needs a reply" : "Issue refund"}
                        </Badge>
                        {row.platformLabel && (
                          <Badge variant="neutral">{row.platformLabel}</Badge>
                        )}
                        {row.vendor && (
                          <Badge variant="neutral">{row.vendor}</Badge>
                        )}
                        {overdue && (
                          <span className="text-xs font-semibold text-amber-700">
                            waiting {Math.floor(hours)}h
                          </span>
                        )}
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                        <Field label="Case" value={row.orderId} mono />
                        <Field
                          label="Amount"
                          value={formatMoney(row.amount, row.currency)}
                        />
                        <Field
                          label="Customer"
                          value={row.customerName || row.customerEmail || "—"}
                        />
                        <Field
                          label="Requested"
                          value={formatDateTime(row.createdAt)}
                        />
                      </div>

                      {row.productTitle && (
                        <p className="mt-2 text-xs text-neutral-600">
                          {row.productTitle}
                        </p>
                      )}
                      {row.note && (
                        <p className="mt-1 text-xs italic text-neutral-500">
                          {row.note}
                        </p>
                      )}
                      {row.conversationId && (
                        <button
                          type="button"
                          onClick={() => onOpenConversation?.(row.conversationId!)}
                          className="mt-2 text-xs font-medium text-primary-700 underline underline-offset-2 hover:text-primary-800"
                        >
                          Read the conversation →
                        </button>
                      )}
                    </div>

                    {row.status === "pending" && (
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          loading={busyId === row.id}
                          onClick={() => updateStatus(row.id, "processed")}
                        >
                          {row.kind === "handoff" ? "Mark handled" : "Mark processed"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === row.id}
                          onClick={() => updateStatus(row.id, "failed")}
                        >
                          Failed
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-neutral-800 ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
