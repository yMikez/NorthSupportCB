"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChatBubble } from "@/components/ui/ChatBubble";
import { Input } from "@/components/ui/Input";
import { Stepper, type StepperStep } from "@/components/ui/Stepper";
import { TrustBadges } from "@/components/ui/TrustBadges";
import { TypingIndicator } from "@/components/ui/TypingIndicator";
import { PageShell } from "@/components/layout/PageShell";

const BRAND_NAME = "Support Center";
const AGENT_NAME = "Maya";
const AGENT_INITIAL = "M";

type Phase = "receipt" | "existing" | "chat" | "submitted";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type ExistingTicket = {
  ticketId: string;
  type: string;
  status: string;
  openedDate: string;
};

const ACTION_REGEX = /\{\s*"action"\s*:\s*"create_refund"[^}]*\}/;

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || "USD"}`;
  }
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function stripAction(content: string): string {
  return content.replace(ACTION_REGEX, "").trim();
}

function buildSteps(phase: Phase): StepperStep[] {
  if (phase === "receipt") {
    return [
      { label: "Verify order", state: "active" },
      { label: "Talk to support", state: "upcoming" },
      { label: "Resolved", state: "upcoming" },
    ];
  }
  if (phase === "existing" || phase === "chat") {
    return [
      { label: "Verify order", state: "complete" },
      { label: "Talk to support", state: "active" },
      { label: "Resolved", state: "upcoming" },
    ];
  }
  return [
    { label: "Verify order", state: "complete" },
    { label: "Talk to support", state: "complete" },
    { label: "Resolved", state: "complete" },
  ];
}

const SendArrowIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5"
    aria-hidden="true"
  >
    <path d="M4 12h16m-6-6 6 6-6 6" />
  </svg>
);

export default function CustomerPage() {
  const [phase, setPhase] = useState<Phase>("receipt");
  const [receipt, setReceipt] = useState("");
  const [receiptError, setReceiptError] = useState("");
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [globalDetail, setGlobalDetail] = useState("");

  const [existingTicket, setExistingTicket] = useState<ExistingTicket | null>(
    null,
  );
  const [refundAmount, setRefundAmount] = useState(0);
  const [currency, setCurrency] = useState("USD");
  const [vendor, setVendor] = useState<string>("");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [submittingRefund, setSubmittingRefund] = useState(false);
  const [conversationId, setConversationId] = useState<string>("");

  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, phase, sending]);

  async function handleReceiptSubmit(e: FormEvent) {
    e.preventDefault();
    setGlobalError("");
    setGlobalDetail("");
    const trimmed = receipt.trim();
    if (trimmed.length < 4) {
      setReceiptError("Receipt must be at least 4 characters.");
      return;
    }
    setReceiptError("");
    setLoading(true);

    try {
      const ticketRes = await fetch("/api/check-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt: trimmed }),
      });
      const ticketData = await ticketRes.json();
      if (!ticketRes.ok) {
        setGlobalError(ticketData.error ?? "Something went wrong.");
        if (ticketData.detail) setGlobalDetail(ticketData.detail);
        return;
      }

      if (ticketData.hasOpenTicket) {
        setExistingTicket(ticketData.ticket);
        setPhase("existing");
        return;
      }

      const refundRes = await fetch("/api/refund-amount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt: trimmed }),
      });
      const refundData = await refundRes.json();
      if (!refundRes.ok) {
        setGlobalError(refundData.error ?? "Could not fetch refund amount.");
        if (refundData.detail) setGlobalDetail(refundData.detail);
        return;
      }

      setRefundAmount(refundData.refundAmount ?? 0);
      setCurrency(refundData.currency ?? "USD");
      setVendor(refundData.vendor ?? "");
      setConversationId(
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      );
      setMessages([
        {
          role: "assistant",
          content: `Hi, I'm ${AGENT_NAME} — I'm so sorry you're having trouble with your order. I can see everything on my end. Could you tell me a little about what went wrong? I'll do my best to help.`,
          timestamp: formatTime(new Date()),
        },
      ]);
      setPhase("chat");
    } catch {
      setGlobalError("We couldn't reach our servers. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function triggerRefund(receiptForRefund: string) {
    setSubmittingRefund(true);
    try {
      const res = await fetch("/api/create-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt: receiptForRefund }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGlobalError(data.error ?? "Could not submit refund request.");
        if (data.detail) setGlobalDetail(data.detail);
        return;
      }
      setPhase("submitted");
    } catch {
      setGlobalError("Network error while submitting refund.");
    } finally {
      setSubmittingRefund(false);
    }
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const now = new Date();
    const payloadMessages: { role: "user" | "assistant"; content: string }[] = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text, timestamp: formatTime(now) },
    ]);
    setInput("");
    setSending(true);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          receipt: receipt.trim(),
          refundAmount,
          currency,
          messages: payloadMessages,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setGlobalError(data.error ?? "Maya is unavailable right now.");
        setSending(false);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let placeholderAdded = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        acc += chunk;

        if (!placeholderAdded) {
          placeholderAdded = true;
          setStreaming(false);
          const stamp = formatTime(new Date());
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: acc, timestamp: stamp },
          ]);
        } else {
          setMessages((prev) => {
            const copy = prev.slice();
            copy[copy.length - 1] = {
              ...copy[copy.length - 1],
              content: acc,
            };
            return copy;
          });
        }
      }

      const match = acc.match(ACTION_REGEX);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]) as {
            action?: string;
            receipt?: string;
          };
          if (parsed.action === "create_refund") {
            await triggerRefund(parsed.receipt || receipt.trim());
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      setGlobalError("Connection lost while talking to Maya. Please retry.");
    } finally {
      setSending(false);
      setStreaming(false);
    }
  }

  function reset() {
    setPhase("receipt");
    setReceipt("");
    setReceiptError("");
    setGlobalError("");
    setGlobalDetail("");
    setExistingTicket(null);
    setRefundAmount(0);
    setCurrency("USD");
    setVendor("");
    setMessages([]);
    setInput("");
  }

  return (
    <PageShell brandName={BRAND_NAME} tagline="We're here to help">
      <div className="space-y-6">
        <div className="animate-fade-up-soft delay-250">
          <Stepper steps={buildSteps(phase)} theme="light" />
        </div>

        {globalError && (
          <Alert
            variant="error"
            title="Something went wrong"
            onDismiss={() => {
              setGlobalError("");
              setGlobalDetail("");
            }}
          >
            <div>{globalError}</div>
            {globalDetail && (
              <pre className="mt-2 overflow-x-auto rounded bg-red-100/60 p-2 font-mono text-[11px] leading-snug text-red-900">
                {globalDetail}
              </pre>
            )}
          </Alert>
        )}

        <div className="animate-fade-up-card delay-350">
          {phase === "receipt" && (
            <Card variant="glass" padding="lg">
              <h1 className="heading-glow font-serif text-[2rem] leading-tight">
                Let&rsquo;s sort this out for you
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                Enter your order receipt number below and we&rsquo;ll take care
                of the rest.
              </p>

              <form onSubmit={handleReceiptSubmit} className="mt-7 space-y-5">
                <Input
                  theme="light"
                  label="Order Receipt Number"
                  value={receipt}
                  onChange={(e) => setReceipt(e.target.value)}
                  placeholder="e.g. ABC12345"
                  autoComplete="off"
                  autoFocus
                  error={receiptError || undefined}
                />

                <Button type="submit" size="lg" fullWidth loading={loading}>
                  Get Support <span aria-hidden="true">→</span>
                </Button>
              </form>

              <div className="mt-7 border-t border-emerald-100 pt-5 animate-fade-up-soft delay-600">
                <TrustBadges />
              </div>
            </Card>
          )}

          {phase === "existing" && existingTicket && (
            <Card variant="glass" padding="lg">
              <div className="flex items-start gap-3">
                <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5m0-8.5h.01" strokeLinecap="round" />
                  </svg>
                </span>
                <div className="flex-1">
                  <h2 className="font-serif text-xl text-neutral-900">
                    You already have a ticket open
                  </h2>
                  <p className="mt-1 text-sm text-neutral-500">
                    Our team is already working on ticket{" "}
                    <span className="font-semibold text-neutral-900">
                      #{existingTicket.ticketId}
                    </span>
                    . We&rsquo;ll be in touch soon.
                  </p>
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-1 gap-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-[0.1em] text-neutral-400">
                    Status
                  </dt>
                  <dd className="mt-1.5">
                    <Badge variant="info">
                      {existingTicket.status || "Open"}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.1em] text-neutral-400">
                    Type
                  </dt>
                  <dd className="mt-1.5 font-medium text-neutral-800">
                    {existingTicket.type || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.1em] text-neutral-400">
                    Opened
                  </dt>
                  <dd className="mt-1.5 font-medium text-neutral-800">
                    {existingTicket.openedDate || "—"}
                  </dd>
                </div>
              </dl>

              <div className="mt-6">
                <Button
                  variant="secondary"
                  tone="light"
                  onClick={reset}
                  fullWidth
                >
                  Check a different order
                </Button>
              </div>
            </Card>
          )}

          {phase === "chat" && (
            <Card variant="glass" padding="none" className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-emerald-100 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="maya-avatar" aria-hidden="true">
                    {AGENT_INITIAL}
                    <span className="maya-online-dot" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">
                      {AGENT_NAME}
                    </p>
                    <p className="text-xs text-neutral-400">
                      Support agent &middot; usually replies instantly
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
                >
                  Close
                </button>
              </div>

              <div className="px-5 pb-4 pt-4">
                <div className="refund-pill flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.1em] text-emerald-600">
                      Your eligible refund
                    </p>
                    <p className="mt-1 font-serif text-3xl font-semibold text-emerald-900">
                      {formatMoney(refundAmount, currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium uppercase tracking-[0.1em] text-neutral-400">
                      Receipt
                    </p>
                    <p className="mt-1 text-sm font-medium text-neutral-700">
                      {receipt}
                    </p>
                    {vendor && (
                      <p className="mt-0.5 text-xs text-neutral-400">
                        from{" "}
                        <span className="font-medium text-neutral-500">
                          {vendor}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div
                ref={scrollerRef}
                className="space-y-4 overflow-y-auto px-5 py-4"
                style={{ maxHeight: "380px", minHeight: "220px" }}
              >
                {messages.map((m, i) => (
                  <ChatBubble
                    key={i}
                    role={m.role}
                    timestamp={m.timestamp}
                    agentInitial={AGENT_INITIAL}
                    theme="light"
                  >
                    {stripAction(m.content) || (
                      <span className="text-neutral-300">…</span>
                    )}
                  </ChatBubble>
                ))}

                {streaming && (
                  <ChatBubble
                    role="assistant"
                    agentInitial={AGENT_INITIAL}
                    typing
                    theme="light"
                  />
                )}

                {submittingRefund && (
                  <div className="flex items-center gap-2 pl-10 text-xs text-neutral-500">
                    <TypingIndicator
                      theme="light"
                      label="Submitting refund request"
                    />
                    <span>Submitting your refund request…</span>
                  </div>
                )}
              </div>

              <form
                onSubmit={sendMessage}
                className="flex items-center gap-2 border-t border-neutral-200 bg-neutral-50 px-4 py-3"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`Message ${AGENT_NAME}…`}
                  disabled={sending || submittingRefund || phase !== "chat"}
                  aria-label={`Message ${AGENT_NAME}`}
                  className="chat-input-light flex-1"
                />
                <button
                  type="submit"
                  disabled={submittingRefund || !input.trim() || sending}
                  aria-label="Send message"
                  className="chat-send flex items-center justify-center"
                >
                  {SendArrowIcon}
                </button>
              </form>
            </Card>
          )}

          {phase === "submitted" && (
            <Card variant="glass" padding="lg" className="text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center">
                <svg
                  viewBox="0 0 64 64"
                  className="h-16 w-16 text-emerald-500"
                  aria-hidden="true"
                >
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="check-circle-path"
                  />
                  <path
                    d="M20 33 l9 9 l16 -18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="check-path"
                  />
                </svg>
              </div>
              <h1 className="heading-glow font-serif text-[2rem] leading-tight">
                Refund request submitted
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                Thanks for working through this with us &mdash; here&rsquo;s
                what happens next.
              </p>

              <ol className="mx-auto mt-7 max-w-md space-y-3 text-left">
                {[
                  "Check your inbox for the return shipping instructions (we'll send them within a few minutes).",
                  "Pack the product and send it back using the prepaid label provided.",
                  "Once we receive the product, your refund will be processed within 3–5 business days.",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                      {i + 1}
                    </span>
                    <span className="text-sm text-neutral-700">{step}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-7">
                <Button
                  variant="secondary"
                  tone="light"
                  onClick={reset}
                  fullWidth
                >
                  Start a new request
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </PageShell>
  );
}
