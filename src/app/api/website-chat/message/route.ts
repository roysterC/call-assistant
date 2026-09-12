import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildChatContext,
  getChatResponse,
  resolveModelForSite,
} from "@/lib/claude";
import {
  checkCORS,
  corsHeaders,
  parseLeadMarker,
  isValidEmail,
} from "@/lib/website-chat";
import { rateLimit } from "@/lib/rate-limit";

export async function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const body = await req.json();
    const { siteId, sessionId, message, userAgent, referrer } = body;

    if (!siteId || !sessionId || !message) {
      return new Response(
        JSON.stringify({ error: "siteId, sessionId, message required" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    if (typeof message !== "string" || message.length > 4000) {
      return new Response(
        JSON.stringify({ error: "Invalid message" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // Load site config, plus the org's plan — the model choice is re-clamped
    // against it on every request rather than trusted from the stored row, so
    // a downgrade takes effect immediately.
    const site = await prisma.websiteConfig.findUnique({
      where: { siteId },
      include: { organization: { select: { planTier: true } } },
    });

    if (!site || !site.enabled) {
      return new Response(
        JSON.stringify({ error: "Site not found" }),
        { status: 404, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // Feature gate: org must have chatbot enabled
    const orgSettings = await prisma.organizationSettings.findUnique({
      where: { organizationId: site.organizationId },
      select: { chatbotEnabled: true },
    });
    if (!orgSettings?.chatbotEnabled) {
      return new Response(
        JSON.stringify({ error: "Chatbot is not enabled for this organization" }),
        { status: 403, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // Verify CORS
    const allowedOrigins = site.allowedOrigins as string[];
    if (!checkCORS(origin, allowedOrigins)) {
      return new Response(
        JSON.stringify({ error: "Origin not allowed" }),
        { status: 403, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // Rate limit by sessionId
    const rl = rateLimit("website-chat-message", sessionId);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ error: "rate_limited", retryAfterMs: rl.retryAfterMs }),
        {
          status: 429,
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)),
          },
        }
      );
    }

    // Find or create conversation
    let conversation = await prisma.websiteConversation.findUnique({
      where: { sessionId },
    });

    if (!conversation) {
      conversation = await prisma.websiteConversation.create({
        data: {
          organizationId: site.organizationId,
          siteId,
          sessionId,
          userAgent: userAgent || null,
          referrer: referrer || null,
        },
      });
    }

    // Store user message
    await prisma.websiteMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: message,
      },
    });

    // Once a person is involved the bot stays quiet. The visitor's message is
    // still stored and still surfaces in the inbox — they can keep typing
    // while they wait — but generating a reply over a waiting human is the
    // most irritating thing a widget can do, and it also spends tokens on a
    // conversation nobody wants the model in.
    if (conversation.handoffState !== "bot") {
      await prisma.websiteConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(), isRead: false },
      });
      return new Response(
        JSON.stringify({ handoffState: conversation.handoffState }),
        {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        }
      );
    }

    // Load conversation history. Honour per-conversation persona reset
    // (see WhatsApp handler for rationale): if the admin set
    // personaResetAt after changing the site's system prompt, only feed
    // messages from that point onward.
    const history = await prisma.websiteMessage.findMany({
      where: {
        conversationId: conversation.id,
        ...(conversation.personaResetAt
          ? { createdAt: { gte: conversation.personaResetAt } }
          : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });

    // Maps operator ("agent") rows onto the roles the API accepts, and returns
    // the system prompt that makes sense of them. Shared with the WhatsApp and
    // Meta handlers — see buildChatContext() for why both halves travel
    // together.
    const { messages: chatMessages, systemPrompt } = buildChatContext(
      history,
      site.systemPrompt
    );

    // Get AI response. If a lead is already attached to this conversation
    // (set on a previous turn via the [LEAD:...] marker or an explicit
    // form submission), let Claude also extract details into the lead row
    // through the save_customer_details tool. First-turn messages without
    // a lead yet still rely on the marker flow below.
    const rawResponse = await getChatResponse(chatMessages, systemPrompt, {
      organizationId: site.organizationId,
      chatModel: resolveModelForSite(
        site.organization?.planTier,
        site.chatModel
      ),
      allowCLI: true,
      extractToLead: conversation.leadId
        ? { leadId: conversation.leadId }
        : undefined,
    });

    // Parse for lead marker
    const { cleanText, lead } = parseLeadMarker(rawResponse);

    // Handle lead if captured
    if (lead && lead.email && isValidEmail(lead.email)) {
      const phone = lead.phone || "";
      const updateData: {
        visitorName?: string;
        visitorEmail?: string;
        visitorPhone?: string;
        leadId?: string;
      } = {
        visitorName: lead.name || undefined,
        visitorEmail: lead.email,
        visitorPhone: lead.phone || undefined,
      };

      if (phone) {
        // Atomic upsert. The earlier findUnique-then-create branch would
        // race when two messages from the same visitor arrived back-to-
        // back. We still want the "fill in null fields" behaviour from
        // the old update branch, so we read the row back first to compute
        // the merged update — but the create-vs-update arbitration itself
        // is atomic at DB level.
        const existing = await prisma.lead.findUnique({
          where: {
            organizationId_phone: { organizationId: site.organizationId, phone },
          },
        });
        const upserted = await prisma.lead.upsert({
          where: {
            organizationId_phone: { organizationId: site.organizationId, phone },
          },
          create: {
            organizationId: site.organizationId,
            name: lead.name || null,
            email: lead.email,
            phone,
            source: "website",
            // The marker's summary is "what this lead wants", which is `issue`
            // — the column the leads table renders. It used to go to `notes`,
            // an internal field nothing displays, so every website lead showed
            // a blank issue while phone leads showed theirs. Capped at 500 to
            // match applyCustomerDetails() in lib/claude.ts.
            issue: lead.summary?.trim().slice(0, 500) || null,
          },
          update: {
            name: existing?.name || lead.name || null,
            email: existing?.email || lead.email || null,
            // Same fill-in-null-fields behaviour as name/email above: a lead
            // first created by another channel (a phone call, say) with no
            // issue recorded picks one up from the chat summary.
            issue:
              existing?.issue || lead.summary?.trim().slice(0, 500) || null,
          },
        });
        updateData.leadId = upserted.id;
      }

      await prisma.websiteConversation.update({
        where: { id: conversation.id },
        data: updateData,
      });
    }

    // Store assistant message (clean text without marker)
    await prisma.websiteMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: cleanText,
      },
    });

    // Update conversation timestamp + mark unread for dashboard
    await prisma.websiteConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), isRead: false },
    });

    // Stream the response as SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Chunk the text into small pieces for a "streaming" feel
        const chunkSize = 20;
        for (let i = 0; i < cleanText.length; i += chunkSize) {
          const chunk = cleanText.slice(i, i + chunkSize);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`)
          );
          await new Promise((r) => setTimeout(r, 20));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...headers,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[WEBSITE CHAT MESSAGE] error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
}
