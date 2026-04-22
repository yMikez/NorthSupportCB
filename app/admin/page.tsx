"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AdminShell } from "@/components/layout/AdminShell";

const BRAND_NAME = "Support Center";
const REFRESH_MS = 60_000;

type AdminTicket = {
  ticketId: string;
  receipt: string;
  type: string;
  status: string;
  openedDate: string;
  vendor?: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmail?: string;
};

const VENDOR_FILTER_ALL = "__all__";

type ActionEntry = {
  loading: boolean;
  message?: string;
  error?: string;
};

function statusBadgeVariant(status: string): BadgeVariant {
  const s = (status || "").toLowerCase();
  if (s === "open") return "success";
  if (s === "reopened") return "warning";
  if (s === "closed") return "neutral";
  return "neutral";
}

function typeLabel(type: string): string {
  if (!type) return "—";
  const lower = type.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function isResolvedToday(_t: AdminTicket): boolean {
  return false;
}

export default function AdminPage() {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [vendorFilter, setVendorFilter] = useState<string>(VENDOR_FILTER_ALL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [actionState, setActionState] = useState<Record<string, ActionEntry>>(
    {},
  );

  const loadTickets = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/admin/tickets", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not load tickets.");
        return;
      }
      setTickets(data.tickets ?? []);
      setVendors(data.vendors ?? []);
      setLastRefreshed(new Date());
    } catch {
      setError("Network error while loading tickets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTickets();
    const id = setInterval(loadTickets, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadTickets]);

  async function markReturned(ticketId: string) {
    setActionState((s) => ({ ...s, [ticketId]: { loading: true } }));
    try {
      const res = await fetch("/api/mark-returned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionState((s) => ({
          ...s,
          [ticketId]: { loading: false, error: data.error ?? "Failed." },
        }));
        return;
      }
      setActionState((s) => ({
        ...s,
        [ticketId]: { loading: false, message: "Marked returned" },
      }));
      loadTickets();
    } catch {
      setActionState((s) => ({
        ...s,
        [ticketId]: { loading: false, error: "Network error." },
      }));
    }
  }

  async function signOut() {
    await fetch("/api/admin/login", { method: "DELETE" });
    window.location.href = "/admin/login";
  }

  const visibleTickets = useMemo(() => {
    if (vendorFilter === VENDOR_FILTER_ALL) return tickets;
    return tickets.filter(
      (t) => (t.vendor || "").toLowerCase() === vendorFilter,
    );
  }, [tickets, vendorFilter]);

  const stats = useMemo(() => {
    const open = visibleTickets.length;
    const refund = visibleTickets.filter(
      (t) => (t.type || "").toUpperCase() === "REFUND",
    ).length;
    const resolvedToday = visibleTickets.filter(isResolvedToday).length;
    return { open, refund, resolvedToday };
  }, [visibleTickets]);

  return (
    <AdminShell brandName={BRAND_NAME} onSignOut={signOut}>
      <div className="animate-fade-in-up space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl sm:text-3xl">Open tickets</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Auto-refreshing every 60 seconds.
              {lastRefreshed && (
                <>
                  {" "}Last updated {lastRefreshed.toLocaleTimeString()}.
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {vendors.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-neutral-600">
                <span className="text-xs uppercase tracking-wide text-neutral-500">
                  Vendor
                </span>
                <select
                  value={vendorFilter}
                  onChange={(e) => setVendorFilter(e.target.value)}
                  className="rounded-md border-[1.5px] border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
                >
                  <option value={VENDOR_FILTER_ALL}>All ({tickets.length})</option>
                  {vendors.map((v) => {
                    const count = tickets.filter(
                      (t) => (t.vendor || "").toLowerCase() === v,
                    ).length;
                    return (
                      <option key={v} value={v}>
                        {v} ({count})
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
            <Button variant="secondary" size="sm" onClick={loadTickets}>
              Refresh now
            </Button>
          </div>
        </div>

        {error && (
          <Alert
            variant="error"
            title="Couldn't load tickets"
            onDismiss={() => setError("")}
          >
            {error}
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Open tickets" value={stats.open} accent="open" />
          <StatCard
            label="Refund tickets"
            value={stats.refund}
            accent="refund"
          />
          <StatCard
            label="Resolved today"
            value={stats.resolvedToday}
            accent="resolved"
          />
        </div>

        <Card
          padding="none"
          className="overflow-hidden rounded-2xl border border-[#f0f0ef] shadow-sm"
        >
          <div className="hidden border-b border-neutral-100 bg-[#f5f5f4] px-5 py-3 text-xs font-semibold uppercase tracking-[0.06em] text-[#57534e] md:grid md:grid-cols-12">
            <div className="md:col-span-2">ID</div>
            <div className="md:col-span-3">Customer</div>
            <div className="md:col-span-2">Receipt</div>
            <div className="md:col-span-1">Vendor</div>
            <div className="md:col-span-1">Type</div>
            <div className="md:col-span-1">Opened</div>
            <div className="md:col-span-1">Status</div>
            <div className="md:col-span-1 text-right">Action</div>
          </div>

          {loading && visibleTickets.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-neutral-500">
              Loading tickets…
            </div>
          ) : visibleTickets.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {visibleTickets.map((t, idx) => {
                const st = actionState[t.ticketId];
                const isRefund = (t.type || "").toUpperCase() === "REFUND";
                const name = [t.customerFirstName, t.customerLastName]
                  .filter(Boolean)
                  .join(" ");
                const stripe = idx % 2 === 1 ? "bg-neutral-50/50" : "bg-white";

                return (
                  <li
                    key={t.ticketId}
                    className={`${stripe} px-5 py-4 text-sm transition-colors duration-100 hover:bg-[#fafaf9] md:grid md:grid-cols-12 md:items-center`}
                  >
                    <div className="font-medium text-neutral-900 md:col-span-2">
                      #{t.ticketId}
                    </div>
                    <div className="mt-2 text-neutral-700 md:col-span-3 md:mt-0">
                      <div className="font-medium text-neutral-900">
                        {name || "—"}
                      </div>
                      {t.customerEmail && (
                        <div className="text-xs text-neutral-500">
                          {t.customerEmail}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 text-neutral-700 md:col-span-2 md:mt-0">
                      {t.receipt || "—"}
                    </div>
                    <div className="mt-1 md:col-span-1 md:mt-0">
                      {t.vendor ? (
                        <Badge variant="neutral">{t.vendor}</Badge>
                      ) : (
                        <span className="text-xs text-neutral-300">—</span>
                      )}
                    </div>
                    <div className="mt-1 md:col-span-1 md:mt-0">
                      {isRefund ? (
                        <Badge variant="info">{typeLabel(t.type)}</Badge>
                      ) : (
                        <span className="text-neutral-600">
                          {typeLabel(t.type)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-neutral-600 md:col-span-1 md:mt-0">
                      {t.openedDate || "—"}
                    </div>
                    <div className="mt-2 md:col-span-1 md:mt-0">
                      <Badge variant={statusBadgeVariant(t.status)}>
                        {t.status || "open"}
                      </Badge>
                    </div>
                    <div className="mt-3 md:col-span-1 md:mt-0 md:text-right">
                      {isRefund ? (
                        <button
                          type="button"
                          disabled={st?.loading}
                          onClick={() => markReturned(t.ticketId)}
                          className="btn-outline-emerald disabled:opacity-60"
                        >
                          {st?.loading ? "…" : "Mark returned"}
                        </button>
                      ) : (
                        <span className="text-xs text-neutral-300">—</span>
                      )}
                      {st?.message && (
                        <p className="mt-1 text-xs text-primary-600">
                          {st.message}
                        </p>
                      )}
                      {st?.error && (
                        <p className="mt-1 text-xs text-error">{st.error}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "open" | "refund" | "resolved";
}) {
  const accentClass =
    accent === "refund"
      ? "stat-accent-refund"
      : accent === "resolved"
        ? "stat-accent-resolved"
        : "stat-accent-open";

  return (
    <div
      className={`rounded-[16px] border border-[#f0f0ef] bg-white p-5 shadow-sm ${accentClass}`}
    >
      <p className="text-sm font-medium text-[#a8a29e]">{label}</p>
      <p className="mt-1 font-serif text-2xl font-semibold text-[#1c1917]">
        {value}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
      <div
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-primary-500"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-7 w-7"
        >
          <path d="M20 7 9 18l-5-5" />
        </svg>
      </div>
      <h2 className="mt-4 font-serif text-xl">
        No open tickets — you&rsquo;re all caught up!
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        New support requests will appear here automatically.
      </p>
    </div>
  );
}
