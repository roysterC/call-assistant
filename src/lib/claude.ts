import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "child_process";
import { prisma } from "@/lib/prisma";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface LeadExtractionTarget {
  /** Lead row id to upsert extracted details onto. */
  leadId: string;
}

interface ChatOptions {
  organizationId?: string;
  allowCLI?: boolean;
  /**
   * Which messaging channel triggered this — used by the CLI path to
   * label the trailing instruction ("Be concise — this is a {channel}
   * message"). API path doesn't need it; the system prompt carries the
   * channel context already. Defaults to "whatsapp" for back-compat.
   */
  channel?: MessagingChannel;
  /**
   * When set, the Claude API call adds a `save_customer_details` tool.
   * If Claude decides to call it (the customer has shared name / email /
   * company / a description of what they need), we upsert those fields
   * onto the named lead. The CLI fallback ignores this — it has no
   * tool-use support.
   */
  extractToLead?: LeadExtractionTarget;
}

/**
 * Anthropic tool definition. Mirrors the shape of Vapi's existing
 * save_customer_details function so all channels populate Lead fields
 * consistently.
 *
 * Earlier (cautious) wording made the model under-call the tool. Current
 * description leans into "call it whenever..." with examples in the
 * system-prompt instruction below.
 */
const SAVE_CUSTOMER_DETAILS_TOOL = {
  name: "save_customer_details",
  description:
    "Record customer details to the CRM. Call this whenever the customer " +
    "mentions any of: their name, an email, a company name, or describes " +
    "what they're looking for / what they need. You can call this multiple " +
    "times in the same conversation as new pieces of info arrive — pass " +
    "only the fields you have. The CRM merges them into the lead record.",
  input_schema: {
    type: "object" as const,
    properties: {
      issue: {
        type: "string",
        description:
          "Short one-sentence summary of what the customer wants or needs.",
      },
      name: { type: "string", description: "Customer's name if mentioned." },
      email: { type: "string", description: "Email address if shared." },
      company: { type: "string", description: "Company name if mentioned." },
    },
  },
};

const TOOL_INSTRUCTION =
  "\n\n## Saving customer details\n" +
  "You have access to a `save_customer_details` tool that writes to our " +
  "CRM. **Call it whenever the customer mentions any of: their name, an " +
  "email, a company name, or what they're looking for.** Call it as soon " +
  "as you learn each piece — you can call it multiple times across the " +
  "conversation as new info arrives. Pass only the fields you have. The " +
  "team relies on these fields to follow up.\n\n" +
  "Examples that should trigger a call:\n" +
  '- User: "I\'m Sarah from Acme" → call save_customer_details({name: "Sarah", company: "Acme"})\n' +
  '- User: "my email is x@y.com" → call save_customer_details({email: "x@y.com"})\n' +
  '- User: "we need an AI bot for support" → call save_customer_details({issue: "AI bot for support"})\n' +
  "\n" +
  "Don't ask permission, don't announce it — just call the tool, then " +
  "reply naturally to the customer.";

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface TextBlock {
  type: "text";
  text: string;
}

type ContentBlock = ToolUseBlock | TextBlock | { type: string };

/**
 * Apply customer details extracted by Claude to the lead row. Truncates
 * each field to a sensible length. Failures are logged and swallowed —
 * never blocks the user reply.
 */
async function applyCustomerDetails(
  leadId: string,
  details: {
    issue?: string;
    name?: string;
    email?: string;
    company?: string;
  }
): Promise<void> {
  const data: Record<string, string> = {};
  if (typeof details.issue === "string" && details.issue.trim()) {
    data.issue = details.issue.trim().slice(0, 500);
  }
  if (typeof details.name === "string" && details.name.trim()) {
    data.name = details.name.trim().slice(0, 200);
  }
  if (typeof details.email === "string" && details.email.trim()) {
    data.email = details.email.trim().slice(0, 200);
  }
  if (typeof details.company === "string" && details.company.trim()) {
    data.company = details.company.trim().slice(0, 200);
  }
  if (Object.keys(data).length === 0) return;

  try {
    await prisma.lead.update({ where: { id: leadId }, data });
    console.log(
      `[CLAUDE] Lead ${leadId} updated via save_customer_details:`,
      Object.keys(data).join(", ")
    );
  } catch (err) {
    console.error("[CLAUDE] Lead update failed:", err);
  }
}

export type MessagingChannel = "whatsapp" | "instagram" | "facebook";

const CHANNEL_LABEL: Record<MessagingChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook Messenger",
};

/**
 * Build a system prompt for an org's messaging channel.
 *
 * Super-admins set per-channel prompts (`<channel>SystemPrompt`) on the
 * OrganizationSettings via the admin UI. If unset, we fall back to a
 * generic prompt that mentions the business name and the channel.
 *
 * Defaults to "whatsapp" for backwards-compat with existing callsites.
 */
export async function buildSystemPrompt(
  organizationId: string,
  channel: MessagingChannel = "whatsapp"
): Promise<string> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
  });

  const customPrompt =
    channel === "whatsapp"
      ? settings?.whatsappSystemPrompt
      : channel === "instagram"
      ? settings?.instagramSystemPrompt
      : settings?.facebookSystemPrompt;

  if (customPrompt) return customPrompt;

  const businessName = settings?.businessName || "Our Business";
  const label = CHANNEL_LABEL[channel];

  return `You are a helpful ${label} assistant for ${businessName}.

Guidelines:
- Be friendly, professional, and concise (${label} messages should be brief).
- Answer what you can. If you can't, say so honestly — don't make up information
  about pricing, availability, or services.
- If someone needs to speak to a person, let them know the team will follow up.
- Keep responses under 500 words.`;
}

// --- Claude Code CLI method (Max plan, local testing only) ---

function formatPromptForCLI(
  messages: ChatMessage[],
  channel: MessagingChannel = "whatsapp"
): string {
  const recentMessages = messages.slice(-30);
  const conversation = recentMessages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
  const label = CHANNEL_LABEL[channel];

  return `Conversation so far:
${conversation}

Respond to the last user message as the assistant. Be concise — this is a ${label} message.`;
}

async function getChatResponseCLI(
  messages: ChatMessage[],
  systemPrompt: string,
  channel: MessagingChannel = "whatsapp"
): Promise<string> {
  const prompt = formatPromptForCLI(messages, channel);

  // On Windows, execFile doesn't resolve .exe/.cmd via PATHEXT unless shell is used.
  // Pass the explicit extension so the binary is found on both platforms.
  const binary = process.platform === "win32" ? "claude.exe" : "claude";

  // The CLI's default system prompt is the agentic-coding one and it
  // walks up the cwd looking for CLAUDE.md / AGENTS.md to inject as
  // ambient context. On prod the Node service's cwd is
  // /home/kaia/doai/call-assistant, which means the parent
  // /home/kaia/doai/CLAUDE.md gets pulled in — and that file is full of
  // "KAIA bot interface" / "KAIA Discord bridge" references for the
  // separate doai brain repo. Even with --system-prompt fully replacing
  // our system prompt, that ambient context leaked through and Claude
  // started mixing personas ("I'm KAIA 🤖").
  //
  // Run the CLI from /tmp instead so the upward walk finds no CLAUDE.md
  // and the only persona instructions are the org's per-channel prompt.
  // (Can't use --bare — it disables OAuth/keychain and would require
  // ANTHROPIC_API_KEY which we don't set on prod.)
  const platformCwd = process.platform === "win32" ? undefined : "/tmp";

  return new Promise((resolve) => {
    execFile(
      binary,
      [
        "-p",
        "--output-format",
        "text",
        "--system-prompt",
        systemPrompt,
        prompt,
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024, cwd: platformCwd },
      (error, stdout, stderr) => {
        if (error) {
          console.error("[CLAUDE CLI] Error:", error.message);
          if (stderr) console.error("[CLAUDE CLI] Stderr:", stderr);
          resolve(
            "Sorry, I was unable to generate a response right now. Please try again."
          );
          return;
        }
        const response = stdout.trim();
        resolve(response || "Sorry, I was unable to generate a response.");
      }
    );
  });
}

// --- Anthropic API method (production) ---

async function getChatResponseAPI(
  messages: ChatMessage[],
  systemPrompt: string,
  apiKey: string,
  extractToLead?: LeadExtractionTarget
): Promise<string> {
  const anthropic = new Anthropic({ apiKey });
  const recentMessages = messages.slice(-30);
  const enableTools = Boolean(extractToLead);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseRequest: any = {
    // Sonnet 5, not Haiku. Measured over 3 runs on the same prompt and input,
    // Haiku 4.5 invented sales statistics in 2 of 3 responses ("an extra 5-10
    // calls a week", "3-4 warm leads") despite the prompt explicitly
    // forbidding invented stats. Sonnet 5 did it 0 times in 6. For a bot whose
    // job is selling to strangers, fabricated social proof is the one failure
    // mode we can't ship.
    //
    // It also wasn't a speed tradeoff: this config averaged 4.9s vs Haiku's
    // 5.4s — adaptive thinking at low effort is the fastest option measured.
    model: "claude-sonnet-5",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },

    // The system prompt is multi-thousand tokens and byte-identical on every
    // turn, so it's the obvious cache target. Caching here covers the whole
    // tools + system prefix (tools render before system); the conversation in
    // `messages` stays uncached and volatile, which is the correct split.
    //
    // Note this yields two cache entries, one per branch of the enableTools
    // ternary. That's expected — the tool list changes the prefix anyway.
    //
    // Cache reads run ~10% of base input price. Given input dominates each
    // request here, a warm cache roughly halves cost per message. The default
    // TTL is 5 minutes, so the benefit scales with sustained traffic; a quiet
    // widget will miss often and pay the ~1.25x write premium instead.
    system: [
      {
        type: "text",
        text: enableTools ? systemPrompt + TOOL_INSTRUCTION : systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: recentMessages,
  };
  if (enableTools) baseRequest.tools = [SAVE_CUSTOMER_DETAILS_TOOL];

  const first = await anthropic.messages.create(baseRequest);
  const firstContent = first.content as ContentBlock[];

  // Process any tool calls from this turn. Claude may emit text + tool_use
  // in one response, or stop_reason="tool_use" expecting tool_results.
  const toolUses = firstContent.filter(
    (b): b is ToolUseBlock => b.type === "tool_use"
  );
  const textBlocksCount = firstContent.filter((b) => b.type === "text").length;

  // Observability: log every Claude turn so we can see whether the tool
  // is being offered, accepted, or ignored. No message content is logged.
  //
  // cache_read is the number that matters for spend: if it stays 0 across
  // repeated turns then something is invalidating the prefix and we're paying
  // full input price on a multi-thousand-token prompt every message.
  const usage = first.usage as {
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    input_tokens: number;
    output_tokens: number;
  };
  console.log(
    `[CLAUDE] tools=${enableTools ? "on" : "off"} ` +
      `stop_reason=${first.stop_reason} ` +
      `tool_uses=${toolUses.length} ` +
      `text_blocks=${textBlocksCount} ` +
      `cache_read=${usage.cache_read_input_tokens ?? 0} ` +
      `cache_write=${usage.cache_creation_input_tokens ?? 0} ` +
      `in=${usage.input_tokens} out=${usage.output_tokens}`
  );

  if (extractToLead && toolUses.length > 0) {
    for (const block of toolUses) {
      if (block.name === "save_customer_details") {
        await applyCustomerDetails(
          extractToLead.leadId,
          block.input as {
            issue?: string;
            name?: string;
            email?: string;
            company?: string;
          }
        );
      }
    }
  }

  // If Claude stopped to use a tool, it hasn't produced final text yet.
  // Send the tool_results back so it can finish its reply.
  if (first.stop_reason === "tool_use" && extractToLead) {
    const toolResults = toolUses.map((b) => ({
      type: "tool_result" as const,
      tool_use_id: b.id,
      content: "Saved.",
    }));

    const followUp = await anthropic.messages.create({
      ...baseRequest,
      messages: [
        ...recentMessages,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: "assistant", content: first.content as any },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: "user", content: toolResults as any },
      ],
    });
    console.log(
      `[CLAUDE] follow-up stop_reason=${followUp.stop_reason}`
    );

    const followText = (followUp.content as ContentBlock[]).find(
      (b): b is TextBlock => b.type === "text"
    );
    return followText?.text || "Sorry, I was unable to generate a response.";
  }

  const textBlock = firstContent.find(
    (b): b is TextBlock => b.type === "text"
  );
  return textBlock?.text || "Sorry, I was unable to generate a response.";
}

// --- Public entry point: routes between API and CLI based on org config ---

export async function getChatResponse(
  messages: ChatMessage[],
  systemPrompt: string,
  options?: ChatOptions
): Promise<string> {
  // Per-org API key override (for enterprise clients)
  if (options?.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: options.organizationId },
      select: { anthropicApiKeyOverride: true, slug: true },
    });

    if (org?.anthropicApiKeyOverride) {
      return getChatResponseAPI(
        messages,
        systemPrompt,
        org.anthropicApiKeyOverride,
        options.extractToLead
      );
    }

    // Claude CLI fallback - only allowed for the DOAI org and only if no shared key is set
    if (
      options.allowCLI &&
      org?.slug === "doai" &&
      !process.env.ANTHROPIC_API_KEY
    ) {
      // CLI path doesn't support tool use; lead extraction is silently
      // skipped. Acceptable: CLI is dev-only / Max-plan local testing.
      return getChatResponseCLI(messages, systemPrompt, options.channel);
    }
  }

  // Default: use the shared Anthropic API key
  if (process.env.ANTHROPIC_API_KEY) {
    return getChatResponseAPI(
      messages,
      systemPrompt,
      process.env.ANTHROPIC_API_KEY,
      options?.extractToLead
    );
  }

  // Last-resort fallback
  if (options?.allowCLI) {
    return getChatResponseCLI(messages, systemPrompt, options.channel);
  }

  return "Sorry, the AI service isn't configured yet. Please contact support.";
}
