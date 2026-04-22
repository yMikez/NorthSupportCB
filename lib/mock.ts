import type { ClickBankTicket, RefundAmountResponse } from "./clickbank";
import type { ChatMessage } from "./claude";

export function isMockMode(): boolean {
  const v = process.env.MOCK_MODE;
  return v === "true" || v === "1";
}

export const MOCK_EXISTING_KEYWORDS = ["OPEN", "EXISTING"];
export const MOCK_INVALID_KEYWORDS = ["INVALID", "NOTFOUND", "REJECT"];

function receiptHas(receipt: string, keywords: string[]): boolean {
  const up = receipt.toUpperCase();
  return keywords.some((k) => up.includes(k));
}

export function mockTicketsByReceipt(receipt: string): ClickBankTicket[] {
  if (receiptHas(receipt, MOCK_EXISTING_KEYWORDS)) {
    return [
      {
        ticketId: "9912",
        receipt,
        type: "REFUND",
        status: "open",
        openedDate: new Date().toISOString().slice(0, 10),
        customerFirstName: "Ana",
        customerLastName: "Silva",
        customerEmail: "ana@example.com",
      },
    ];
  }
  return [];
}

export function mockRefundAmount(
  receipt: string,
): RefundAmountResponse | { notFound: true } {
  if (receiptHas(receipt, MOCK_INVALID_KEYWORDS)) {
    return { notFound: true };
  }
  return { receipt, refundAmount: 49.99, currency: "USD" };
}

export function mockOpenTickets(): ClickBankTicket[] {
  const today = new Date();
  const d = (daysAgo: number) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() - daysAgo);
    return dt.toISOString().slice(0, 10);
  };
  return [
    {
      ticketId: "1001",
      receipt: "ABC12345",
      type: "REFUND",
      status: "open",
      openedDate: d(0),
      customerFirstName: "Ana",
      customerLastName: "Silva",
      customerEmail: "ana@example.com",
    },
    {
      ticketId: "1002",
      receipt: "XYZ78901",
      type: "TECH_SUPPORT",
      status: "open",
      openedDate: d(1),
      customerFirstName: "Bruno",
      customerLastName: "Costa",
      customerEmail: "bruno@example.com",
    },
    {
      ticketId: "1003",
      receipt: "DEF45678",
      type: "REFUND",
      status: "reopened",
      openedDate: d(2),
      customerFirstName: "Clara",
      customerLastName: "Mendes",
      customerEmail: "clara@example.com",
    },
    {
      ticketId: "1004",
      receipt: "GHI90123",
      type: "CANCEL",
      status: "open",
      openedDate: d(3),
      customerFirstName: "Diego",
      customerLastName: "Rocha",
      customerEmail: "diego@example.com",
    },
  ];
}

function mockScript(
  messages: ChatMessage[],
  receipt: string,
  refundAmount: number,
): string {
  const userMessages = messages.filter((m) => m.role === "user");
  const last = userMessages[userMessages.length - 1]?.content?.toLowerCase() ?? "";

  const confirmRegex = /\b(yes|yeah|yep|sure|sim|confirm|confirmo|proceed|prosseguir|ok|okay|go ahead|please do)\b/i;
  const amount = `$${refundAmount.toFixed(2)}`;

  if (userMessages.length === 1) {
    return `I'm really sorry to hear that. I want to help you get this sorted out. Could you tell me a little more about what happened? Was the product damaged in shipping, did it arrive late, or was it not what you were expecting?`;
  }

  if (confirmRegex.test(last)) {
    return `Understood — I'll process a full refund of ${amount} for you right now. Since this is a physical product, please keep an eye on your inbox for the return shipping instructions. Thanks for your patience.\n{"action":"create_refund","receipt":"${receipt}"}`;
  }

  if (userMessages.length === 2) {
    return `Thank you for explaining. Based on what you've described, a full refund of ${amount} sounds like the right outcome. Since this is a physical product, you'll need to return the item — we'll send return instructions by email once I kick this off. Would you like me to process the refund now? Reply "yes" to confirm.`;
  }

  return `Just to make sure we're aligned — would you like me to go ahead and process the full refund of ${amount}? Reply "yes" to confirm, or let me know if you'd like to try something else first.`;
}

export function mockChatStream(
  messages: ChatMessage[],
  receipt: string,
  refundAmount: number,
): ReadableStream<Uint8Array> {
  const text = mockScript(messages, receipt, refundAmount);
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const chunks = text.match(/.{1,18}/gs) ?? [text];
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        await new Promise((r) => setTimeout(r, 45));
      }
      controller.close();
    },
  });
}

export async function mockDelay(ms = 600): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
