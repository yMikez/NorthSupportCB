"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChatBubble } from "@/components/ui/ChatBubble";
import { Input } from "@/components/ui/Input";
import { Stepper, type StepperStep } from "@/components/ui/Stepper";
import { TrustBadges } from "@/components/ui/TrustBadges";
import { TypingIndicator } from "@/components/ui/TypingIndicator";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { PageShell } from "@/components/layout/PageShell";
import { DEFAULT_AGENT, pickAgent, type SupportAgent } from "@/lib/agents";

const BRAND_NAME = "Support Center";

type Phase = "identify" | "chat" | "submitted";

/** Mirrors the server-side check in lib/email.ts — the mail server is the real authority. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Everything the pre-written message quotes, as the server resolved it. */
type Handover = {
  supportEmail: string;
  reference: string;
  agentName: string;
  orderId: string | null;
  productTitle: string | null;
};

/**
 * A `mailto:` the customer can send without typing anything.
 *
 * The case details are already in the body, so the person who picks it up can
 * find the conversation — that is the job the automatic email used to do, minus
 * a delivery step that could fail without anyone noticing.
 */
function buildHandoverMailto(handover: Handover, customerEmail: string): string {
  const subject = handover.reference
    ? `Support case #${handover.reference}`
    : "My support request";

  const lines = [
    "Hi,",
    "",
    `I was just chatting with ${handover.agentName} and was passed to your team.`,
    "",
  ];
  if (handover.reference) lines.push(`Reference: #${handover.reference}`);
  if (handover.orderId) lines.push(`Order: ${handover.orderId}`);
  if (handover.productTitle) lines.push(`Product: ${handover.productTitle}`);
  if (customerEmail) lines.push(`Account email: ${customerEmail}`);
  lines.push(
    "",
    "— write anything else you'd like us to know below this line —",
    "",
    "",
  );

  return `mailto:${handover.supportEmail}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(lines.join("\n"))}`;
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

// The action key is "order"; "receipt" is still accepted so older knowledge
// files that spell it the ClickBank way keep working.
const ACTION_REGEX =
  /\{\s*"action"\s*:\s*"(?:escalate_to_human|create_refund|offer_close|resolve)"[^}]*\}/;

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
  if (phase === "identify") {
    return [
      { label: "Your order", state: "active" },
      { label: "Talk to support", state: "upcoming" },
      { label: "Resolved", state: "upcoming" },
    ];
  }
  if (phase === "chat") {
    return [
      { label: "Your order", state: "complete" },
      { label: "Talk to support", state: "active" },
      { label: "Resolved", state: "upcoming" },
    ];
  }
  return [
    { label: "Your order", state: "complete" },
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
  const [phase, setPhase] = useState<Phase>("identify");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [loading, setLoading] = useState(false);

  /**
   * Como o cliente se identifica. O ID DE TRANSAÇÃO (do recibo) é o caminho
   * principal: ele amarra a conversa a UM pedido — histórico, produto e o
   * dashboard inteiro dependem dessa chave. O e-mail continua existindo como
   * alternativa explícita, porque suporte nunca pode ser beco sem saída para
   * quem não acha o número.
   */
  const [idMode, setIdMode] = useState<"order" | "email">("order");
  const [orderInput, setOrderInput] = useState("");
  const [orderError, setOrderError] = useState("");

  /**
   * What every downstream call keys on: the resolved order number when the
   * email matched a purchase, the email address itself when it did not.
   */
  const [caseKey, setCaseKey] = useState("");
  /** Only set when a purchase was actually found — drives what we show. */
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState("");
  const [globalDetail, setGlobalDetail] = useState("");

  const [platform, setPlatform] = useState<string>("");
  const [refundAmount, setRefundAmount] = useState(0);
  const [currency, setCurrency] = useState("USD");
  const [customerName, setCustomerName] = useState<string>("");
  const [productTitle, setProductTitle] = useState<string>("");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [submittingRefund, setSubmittingRefund] = useState(false);
  const [conversationId, setConversationId] = useState<string>("");
  /**
   * Who is answering. Derived from the conversation id rather than drawn at
   * random, so the server re-derives the same person for the system prompt and
   * the handover email without us having to send it along.
   */
  const [agent, setAgent] = useState<SupportAgent>(DEFAULT_AGENT);
  const [endReason, setEndReason] = useState<
    "escalated" | "refund" | "resolved" | null
  >(null);
  const [caseReference, setCaseReference] = useState<string>("");
  /** A nota (1–5 estrelas) dada na tela final. Vira o CSAT do dashboard. */
  const [csat, setCsat] = useState<number | null>(null);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [offerClose, setOfferClose] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  /** O e-mail de suporte na tela final do caminho "resolvido". */
  const [supportContact, setSupportContact] = useState<string>("");

  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, phase, sending]);

  async function handleIdentifySubmit(e: FormEvent) {
    e.preventDefault();
    setGlobalError("");
    setGlobalDetail("");

    // O caminho principal: o ID de transação do recibo identifica UM pedido.
    const trimmedOrder = orderInput.trim();
    const trimmed = email.trim().toLowerCase();

    if (idMode === "order") {
      if (trimmedOrder.length < 4) {
        setOrderError("Please enter the order ID from your receipt (at least 4 characters).");
        return;
      }
      setOrderError("");
    } else {
      if (!EMAIL_RE.test(trimmed)) {
        setEmailError("Please enter a valid email address.");
        return;
      }
      setEmailError("");
    }
    setLoading(true);

    try {
      // One request. By order id it resolves THE order; by email it looks for
      // a purchase made with the address. Not finding one by email is fine —
      // support still opens, just without an order attached.
      const res = await fetch("/api/lookup-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          idMode === "order" ? { orderId: trimmedOrder } : { email: trimmed },
        ),
      });
      const data = await res.json();

      if (!res.ok || !data.found) {
        // Um número que não casou não encerra o caminho: a própria mensagem
        // aponta a alternativa por e-mail, que continua a um clique.
        if (idMode === "order") {
          setOrderError(data.error ?? "We couldn't find that order.");
        } else {
          setGlobalError(data.error ?? "We couldn't start your request.");
        }
        if (data.detail) setGlobalDetail(data.detail);
        return;
      }

      // No caminho por transação o e-mail vem DO PEDIDO — é ele que o resto
      // do fluxo (escalação, avaliação) usa.
      setEmail(data.email ?? (idMode === "email" ? trimmed : ""));
      setCaseKey(data.caseKey ?? (idMode === "order" ? trimmedOrder : trimmed));
      setOrderNumber(data.orderId ?? null);
      setPlatform(data.platform ?? "");
      setRefundAmount(data.refundAmount ?? 0);
      setCurrency(data.currency ?? "USD");
      setProductTitle(data.productTitle ?? "");

      // A case already on record is not a reason to turn anyone away: someone
      // who was refunded last week may have a new problem today. They go
      // straight into a fresh conversation, same as a first-time customer.
      const firstName: string = data.firstName ?? "";
      setCustomerName(firstName);
      const newConversationId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setConversationId(newConversationId);
      const assigned = pickAgent(newConversationId);
      setAgent(assigned);
      const greeting = firstName
        ? `Hi ${firstName}, I'm ${assigned.name} from support. How can I help you today?`
        : `Hi, I'm ${assigned.name} from support. How can I help you today?`;
      setMessages([
        {
          role: "assistant",
          content: greeting,
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

  /**
   * Retention failed — a person takes the conversation over. No money moves.
   * The server also emails the customer so they can reach that person directly.
   */
  async function triggerEscalation(keyToEscalate: string, urgent: boolean) {
    setSubmittingRefund(true);
    try {
      const res = await fetch("/api/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseKey: keyToEscalate,
          email,
          platform,
          conversationId,
          urgent,
        }),
      });
      const data = await res.json();
      // 409 = the server's own gate says retention isn't exhausted yet. The
      // agent jumped the gun; stay in the chat rather than showing the customer
      // an error for something that isn't their problem.
      if (res.status === 409) return;
      if (!res.ok) {
        setGlobalError(data.error ?? "Could not hand this over.");
        if (data.detail) setGlobalDetail(data.detail);
        return;
      }
      setCaseReference(data.reference ?? "");
      if (data.supportEmail) {
        setHandover({
          supportEmail: data.supportEmail,
          reference: data.reference ?? "",
          agentName: data.agentName ?? agent.name,
          orderId: data.orderId ?? null,
          productTitle: data.productTitle ?? null,
        });
      }
      setEndReason("escalated");
      setPhase("submitted");
    } catch {
      setGlobalError("Network error while handing this over.");
    } finally {
      setSubmittingRefund(false);
    }
  }

  /**
   * A avaliação é cortesia, nunca obrigação: falhar em silêncio é o
   * comportamento certo — uma tela de erro por causa de uma estrela seria
   * pior que não ter estrela. Clicar de novo sobrescreve (a API grava a
   * última nota no atendimento mais recente).
   */
  async function sendCsat(rating: number) {
    setCsat(rating);
    try {
      await fetch("/api/csat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseKey, email, rating }),
      });
    } catch {
      /* fire-and-forget */
    }
  }

  async function triggerResolve(keyToResolve: string) {
    try {
      const res = await fetch("/api/resolve-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseKey: keyToResolve, platform }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.supportEmail) setSupportContact(String(data.supportEmail));
    } catch {
      /* non-blocking — UI still closes the conversation */
    }
    setEndReason("resolved");
    setPhase("submitted");
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
    setOfferClose(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          platform,
          caseKey,
          orderId: orderNumber,
          email,
          refundAmount,
          currency,
          messages: payloadMessages,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setGlobalError(data.error ?? `${agent.name} is unavailable right now.`);
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
        // O JSON da ação é protocolo, não conversa: nunca pode aparecer na
        // bolha. E se o modelo foi lacônico e mandou SÓ o JSON, o aviso de
        // repasse entra por nós — o cliente precisa saber o que vai acontecer
        // antes de a tela mudar.
        const visivel = acc.replace(ACTION_REGEX, "").trim();
        const isHandover = /"action"\s*:\s*"(escalate_to_human|create_refund)"/.test(match[0]);
        const aviso = visivel
          || (isHandover
            ? "I'm passing this to a human colleague right now — you'll see their direct contact email on the next screen, along with a quick rating for this chat."
            : "Thanks for chatting with us!");
        setMessages((prev) => {
          const copy = prev.slice();
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: aviso };
          return copy;
        });

        try {
          const parsed = JSON.parse(match[0]) as {
            action?: string;
            order?: string;
            receipt?: string;
            urgent?: boolean;
          };
          // The model echoes back whatever case key we gave it; fall back to
          // ours rather than trusting a value it may have mangled.
          const target = parsed.order || parsed.receipt || caseKey;
          if (
            parsed.action === "escalate_to_human" ||
            parsed.action === "create_refund"
          ) {
            // O aviso precisa ser LIDO antes de a tela mudar: sem esta pausa,
            // o encerramento parece um corte no meio da frase.
            setSending(false);
            setStreaming(false);
            await new Promise((r) => setTimeout(r, 3500));
            await triggerEscalation(target, parsed.urgent === true);
          } else if (parsed.action === "offer_close") {
            setOfferClose(target);
          } else if (parsed.action === "resolve") {
            await triggerResolve(target);
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      setGlobalError(
        `Connection lost while talking to ${agent.name}. Please retry.`,
      );
    } finally {
      setSending(false);
      setStreaming(false);
    }
  }

  function reset() {
    setPhase("identify");
    setEmail("");
    setEmailError("");
    setCaseKey("");
    setOrderNumber(null);
    setGlobalError("");
    setGlobalDetail("");
    setPlatform("");
    setRefundAmount(0);
    setCurrency("USD");
    setCustomerName("");
    setProductTitle("");
    setConversationId("");
    setAgent(DEFAULT_AGENT);
    setMessages([]);
    setInput("");
    setEndReason(null);
    setCaseReference("");
    setHandover(null);
    setOfferClose(null);
    setClosing(false);
    setSupportContact("");
    setCsat(null);
  }

  async function confirmCloseTicket() {
    if (!offerClose || closing) return;
    setClosing(true);
    await triggerResolve(offerClose);
    setClosing(false);
  }

  return (
    <PageShell
      brandName={BRAND_NAME}
      tagline="We're here to help"
      status="Support team online"
    >
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
          {phase === "identify" && (
            <Card variant="glass" padding="lg">
              <h1 className="heading-glow font-serif text-[2rem] leading-tight">
                Let&rsquo;s sort this out for you
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                {idMode === "order"
                  ? "Enter the order ID from your receipt. It ties this chat to the right purchase from the start."
                  : "Enter the email address you used at checkout. We'll look for your purchase and take it from there."}
              </p>

              <form onSubmit={handleIdentifySubmit} className="mt-7 space-y-5">
                {idMode === "order" ? (
                  <Input
                    theme="light"
                    type="text"
                    label="Order ID"
                    value={orderInput}
                    onChange={(e) => {
                      setOrderInput(e.target.value);
                      if (orderError) setOrderError("");
                    }}
                    placeholder="e.g. 9WXYZ123 (on your receipt email)"
                    autoComplete="off"
                    autoFocus
                    error={orderError || undefined}
                    hint="It's on the receipt you received right after purchase."
                  />
                ) : (
                  <Input
                    theme="light"
                    type="email"
                    inputMode="email"
                    label="Email address"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError("");
                    }}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    error={emailError || undefined}
                    hint="Don't worry if you used a different address — we can still help."
                  />
                )}

                <Button type="submit" size="lg" fullWidth loading={loading}>
                  Get Support <span aria-hidden="true">→</span>
                </Button>
              </form>

              {/* A alternativa fica sempre a um clique: quem não acha o número
                  do pedido não pode ficar trancado do lado de fora. */}
              <p className="mt-4 text-center text-xs text-neutral-500">
                {idMode === "order" ? (
                  <>
                    Can&rsquo;t find your order ID?{" "}
                    <button
                      type="button"
                      className="font-medium text-primary-700 underline underline-offset-2"
                      onClick={() => setIdMode("email")}
                    >
                      Use your email instead
                    </button>
                  </>
                ) : (
                  <>
                    Have your order ID?{" "}
                    <button
                      type="button"
                      className="font-medium text-primary-700 underline underline-offset-2"
                      onClick={() => setIdMode("order")}
                    >
                      Use it instead
                    </button>{" "}
                    — it finds your purchase faster.
                  </>
                )}
              </p>

              <div className="mt-7 border-t border-neutral-200 pt-5 animate-fade-up-soft delay-600">
                <TrustBadges />
              </div>
            </Card>
          )}

          {phase === "chat" && (
            <Card variant="glass" padding="none" className="overflow-hidden">
              {/* No close/dismiss control here on purpose: once the chat is
                  open, the way out is through the conversation — the agent's
                  close offer, or a handover. */}
              <div className="flex items-center gap-3 border-b border-neutral-200/80 bg-gradient-to-b from-white to-primary-50/60 px-5 py-4">
                <AgentAvatar agent={agent} size="md" showStatus />
                <div>
                  <p className="text-sm font-semibold leading-tight text-neutral-900">
                    {agent.name}
                  </p>
                  {/* Availability stays green — it reports a live state, so it
                      should not blend into the blue brand chrome. */}
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-700">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                      aria-hidden="true"
                    />
                    {sending ? "Typing…" : "Online now"}
                  </p>
                </div>
              </div>

              <div className="px-5 pb-4 pt-4">
                <div className="rounded-xl border border-primary-100 bg-primary-50 px-5 py-4">
                  <p className="font-serif text-lg text-primary-900">
                    {customerName ? `Hi ${customerName}!` : "Hi there!"}
                  </p>
                  <p className="mt-0.5 text-xs text-primary-700">
                    {productTitle
                      ? "We found your order. Here's a quick summary."
                      : "Tell me what's going on and I'll help you sort it out."}
                  </p>

                  <dl className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-xs">
                    {productTitle && (
                      <div className="w-full">
                        <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-primary-700/70">
                          Product
                        </dt>
                        <dd className="mt-0.5 text-sm font-medium text-neutral-800">
                          {productTitle}
                        </dd>
                      </div>
                    )}
                    <div className="min-w-0">
                      <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-primary-700/70">
                        Email
                      </dt>
                      <dd className="mt-0.5 truncate text-sm font-medium text-neutral-700">
                        {email}
                      </dd>
                    </div>
                    {/* Only shown when the address actually matched a purchase —
                        printing a blank "Order" line reads as an error. */}
                    {orderNumber && (
                      <div>
                        <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-primary-700/70">
                          Order
                        </dt>
                        <dd className="mt-0.5 font-mono text-sm font-medium text-neutral-700">
                          {orderNumber}
                        </dd>
                      </div>
                    )}

                    {/*
                      Order total — hidden on purpose.
                      Showing the amount puts a number in front of a customer who
                      is deciding whether to ask for it back, which works against
                      retention. It is also meaningless in handoff mode, where no
                      store is connected and the value is always 0.
                      To bring it back, uncomment this block.

                    {refundAmount > 0 && (
                      <div>
                        <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-primary-700/70">
                          Order total
                        </dt>
                        <dd className="mt-0.5 text-sm font-medium text-neutral-700">
                          {formatMoney(refundAmount, currency)}
                        </dd>
                      </div>
                    )}
                    */}
                  </dl>
                </div>
              </div>

              <div
                ref={scrollerRef}
                className="chat-scroller overflow-y-auto px-5 py-4"
                // Grows with the viewport instead of a fixed 380px, so a tall
                // window shows more history and a phone doesn't get a stub.
                style={{ height: "clamp(260px, 46vh, 460px)" }}
              >
                {messages.map((m, i) => {
                  const previous = messages[i - 1];
                  const grouped = previous?.role === m.role;
                  // One timestamp per turn, on the last bubble of the group.
                  const showTime = messages[i + 1]?.role !== m.role;
                  return (
                    <ChatBubble
                      key={i}
                      role={m.role}
                      timestamp={showTime ? m.timestamp : undefined}
                      avatar={<AgentAvatar agent={agent} />}
                      theme="light"
                      grouped={grouped}
                    >
                      {stripAction(m.content) || (
                        <span className="text-neutral-300">…</span>
                      )}
                    </ChatBubble>
                  );
                })}

                {streaming && (
                  <ChatBubble
                    role="assistant"
                    avatar={<AgentAvatar agent={agent} />}
                    typing
                    theme="light"
                    grouped={messages[messages.length - 1]?.role === "assistant"}
                  />
                )}

                {submittingRefund && (
                  <div className="mt-4 flex items-center gap-2.5 pl-[42px] text-xs text-primary-700">
                    <TypingIndicator
                      theme="light"
                      label="Handing over to the team"
                    />
                    <span>Passing you to a colleague…</span>
                  </div>
                )}
              </div>

              {offerClose && (
                <div className="border-t border-emerald-100 bg-emerald-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-emerald-800">
                      All set? This <b>closes your support ticket</b> — you can
                      rate the chat right after.
                    </p>
                    <button
                      type="button"
                      onClick={confirmCloseTicket}
                      disabled={closing}
                      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {closing ? (
                        "Closing…"
                      ) : (
                        <>
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          Close support ticket
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              <form
                onSubmit={sendMessage}
                className="flex items-center gap-2.5 border-t border-neutral-200/80 bg-gradient-to-b from-neutral-50/60 to-white px-4 py-3.5"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`Message ${agent.name}…`}
                  disabled={sending || submittingRefund || phase !== "chat"}
                  aria-label={`Message ${agent.name}`}
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
                  className="h-16 w-16 text-emerald-600"
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
                {endReason === "resolved"
                  ? "Support ticket closed"
                  : "Passed to our team"}
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                {endReason === "resolved"
                  ? "Your support ticket is now closed. Rate the conversation below — and if anything comes up, our email is right here."
                  : "A human colleague is taking over from here. Rate this chat below, and use the email button to reach them directly."}
              </p>

              {/* CSAT: cinco estrelas, opcional. A nota vai para o atendimento
                  recém-gravado no SendTrace e vira a média do dashboard. */}
              <div className="mt-5">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  How was your experience today?
                </p>
                <div
                  className="mt-2 flex items-center justify-center gap-1"
                  role="radiogroup"
                  aria-label="Rate your experience from 1 to 5 stars"
                >
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      role="radio"
                      aria-checked={csat === star}
                      aria-label={`${star} star${star === 1 ? "" : "s"}`}
                      onClick={() => void sendCsat(star)}
                      className={`text-3xl leading-none transition-transform hover:scale-110 ${
                        csat !== null && star <= csat
                          ? "text-amber-400"
                          : "text-neutral-300 hover:text-amber-300"
                      }`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                {csat !== null && (
                  <p className="mt-2 text-xs text-neutral-500">
                    Thanks for your feedback!
                  </p>
                )}
              </div>

              {/* Ticket fechado não é porta fechada: no caminho "resolvido"
                  o e-mail de suporte fica visível também. */}
              {endReason === "resolved" && supportContact && (
                <p className="mt-6 border-t border-neutral-200 pt-5 text-xs text-neutral-500">
                  Need anything else? Email us anytime at{" "}
                  <a
                    href={`mailto:${supportContact}`}
                    className="font-medium text-primary-700 underline underline-offset-2"
                  >
                    {supportContact}
                  </a>
                  .
                </p>
              )}

              {endReason !== "resolved" && caseReference && (
                <div className="mt-5 flex justify-center">
                  <span className="case-ref">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    >
                      <path d="M4 7h16M4 12h16M4 17h10" />
                    </svg>
                    Reference
                    <span className="font-mono font-semibold tracking-tight text-primary-900">
                      #{caseReference}
                    </span>
                  </span>
                </div>
              )}

              {/* Opens the customer's own mail app with the message already
                  written. Nothing is sent on their behalf, so there is no
                  delivery step that can fail quietly. */}
              {endReason !== "resolved" && handover && (
                <div className="mt-6">
                  <a
                    href={buildHandoverMailto(handover, email)}
                    className="btn-premium inline-flex h-[54px] w-full items-center justify-center gap-2 px-7 text-base"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5"
                      aria-hidden="true"
                    >
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m3 7 9 6 9-6" />
                    </svg>
                    Message our team
                  </a>
                  <p className="mt-2.5 text-xs text-neutral-500">
                    Opens your email app with everything already filled in — just
                    hit send. It goes to{" "}
                    <span className="font-medium text-neutral-700">
                      {handover.supportEmail}
                    </span>
                    .
                  </p>
                </div>
              )}

              <ol className="mx-auto mt-7 max-w-md space-y-3 text-left">
                {(endReason === "resolved"
                  ? [
                      "Your ticket has been closed. No further action is needed on your end.",
                      "If you need us again, just come back to this page anytime.",
                    ]
                  : [
                      "A member of our team now has your conversation and your details.",
                      "They'll review everything you told us and get back to you by email.",
                      "You don't need to do anything else — and you don't need to ship anything back.",
                    ]
                ).map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
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
