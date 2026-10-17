import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildChatContext,
  getChatResponse,
  resolveModelForSite,
  withSalonFacts,
} from "@/lib/claude";
import {
  checkCORS,
  corsHeaders,
  parseLeadMarker,
  isValidEmail,
  isValidSessionId,
  dailyReplyCap,
  OVER_CAP_REPLY,
} from "@/lib/website-chat";
import { rateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { upsertWebsiteLead } from "@/lib/website-lead";

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

    if (!isValidSessionId(sessionId)) {
      return new Response(
        JSON.stringify({ error: "Invalid sessionId" }),
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

    // Rate limit by sessionId, and by address: the session id is the
    // visitor's own to choose, so a fresh one per message would otherwise
    // never be limited. About one message every ten seconds from one
    // address, after a burst of fifteen; a person typing never gets near it.
    const bySession = rateLimit("website-chat-message", sessionId);
    const byAddress = rateLimit("website-chat-message-ip", clientIpFromHeaders(req.headers), {
      tokens: 15,
      refillPerSecond: 0.1,
    });
    const rl = bySession.allowed ? byAddress : bySession;
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

    // A session belongs to the site it started on. Without this, someone
    // holding another site's session id could post into that salon's
    // conversation, and the bot would read its history back to them.
    if (conversation && conversation.siteId !== siteId) {
      return new Response(
        JSON.stringify({ error: "Conversation not found" }),
        { status: 404, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

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

    // The day's ceiling on the model for this website. The visitor's message
    // is already stored and the inbox shows it; past the cap only the model
    // is skipped, and the visitor is told someone will reply.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const repliesToday = await prisma.websiteMessage.count({
      where: {
        role: "assistant",
        createdAt: { gte: since },
        conversation: { siteId, lastMessageAt: { gte: since } },
      },
    });
    if (repliesToday >= dailyReplyCap()) {
      console.warn(`[WEBSITE CHAT] ${siteId} reached its daily cap of ${dailyReplyCap()} bot replies`);
      await prisma.websiteConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(), isRead: false },
      });
      return streamReply(OVER_CAP_REPLY, headers);
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
      await withSalonFacts(site.organizationId, site.systemPrompt)
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

      // Keyed on email, not the phone number. The marker cannot fire without
      // an email, and two visitors sharing a phone used to merge into one
      // lead and overwrite each other's details. See upsertWebsiteLead().
      //
      // The marker's summary is "what this lead wants", which is `issue` — the
      // column the leads table renders. It used to go to `notes`, an internal
      // field nothing displays, so every website lead showed a blank issue
      // while phone leads showed theirs.
      const upserted = await upsertWebsiteLead({
        organizationId: site.organizationId,
        email: lead.email,
        name: lead.name,
        phone,
        issue: lead.summary,
      });
      updateData.leadId = upserted.id;

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

    return streamReply(cleanText, headers);
  } catch (error) {
    console.error("[WEBSITE CHAT MESSAGE] error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
}

/** The reply as server-sent events, in small pieces for a typing feel. */
function streamReply(text: string, headers: Record<string, string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const chunkSize = 20;
      for (let i = 0; i < text.length; i += chunkSize) {
        const chunk = text.slice(i, i + chunkSize);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
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
}
