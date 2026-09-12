import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "child_process";
import { prisma } from "@/lib/prisma";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Marks turns a human operator typed, not the bot. See buildChatContext(). */
const AGENT_PREFIX = "[Human colleague]";

/**
 * Appended to the system prompt only when a human has actually replied.
 *
 * The transcript marker alone does not work. An assistant turn is the model's
 * own voice, and a marker claiming otherwise contradicts a system prompt that
 * casts it as the sole assistant — so it resolves the conflict by disowning the
 * message. Three marker wordings were tried against the live prompt and all
 * three failed, the worst actively undermining the operator: asked about a fee
 * waiver a colleague had just granted, the bot replied "that wasn't actually
 * from Roy, I think there's been a mix-up, so I wouldn't rely on that."
 *
 * Telling a customer to disregard a concession a real member of staff just made
 * is a commercial problem, not a cosmetic one — hence the fix lives at the
 * system-prompt level, which is authoritative enough to hold.
 */
const HANDOFF_NOTE = `

## A human colleague has joined this conversation

Turns prefixed with ${AGENT_PREFIX} were typed by a real person from the team who
stepped into this chat — not by you. They are genuine messages the visitor has
already seen, and anything the colleague stated or promised stands.

Treat them as part of the conversation: refer back to them when asked, attribute
them to the colleague rather than to yourself, and never tell the visitor the
message was a mistake, wasn't real, or should be disregarded. If you cannot add
to what the colleague said, offer to pass it back to them.`;

/**
 * Prepares stored message rows for the API, plus the system prompt that goes
 * with them.
 *
 * Both halves are returned together because using one without the other is a
 * silent failure: the roles alone get a reply that disowns the human, and the
 * note alone has nothing to attach to. Callers get a matched pair or nothing.
 *
 * On the role mapping — `role` is an unconstrained String column on all three
 * message tables, so what comes out of the database is wider than what the API
 * accepts. This maps rather than asserts: the original
 * `m.role as "user" | "assistant"` satisfied the compiler and converted nothing
 * at runtime, so "agent" reached the API and every message after a handback
 * failed the whole request with `Unexpected role "agent"`. Anything that isn't
 * "user" is treated as assistant-side — an unrecognised role is far better
 * rendered as context than used to reject the request.
 *
 * Only the website channel writes "agent" rows today. The others have no
 * operator path *yet*, which is exactly why this is shared: the next channel to
 * grow one should not have to rediscover any of the above.
 *
 * Caching: with no agent turns the returned prompt is byte-identical to the one
 * passed in, so the cached prefix still hits. Only handoff conversations pay a
 * cache write, and they are rare.
 */
export function buildChatContext(
  rows: { role: string; content: string }[],
  systemPrompt: string
): { messages: ChatMessage[]; systemPrompt: string } {
  let sawAgent = false;

  const messages = rows.map((m) => {
    if (m.role === "agent") sawAgent = true;
    return {
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content:
        m.role === "agent" ? `${AGENT_PREFIX} ${m.content}` : m.content,
    };
  });

  return {
    messages,
    systemPrompt: sawAgent ? systemPrompt + HANDOFF_NOTE : systemPrompt,
  };
}

interface LeadExtractionTarget {
  /** Lead row id to upsert extracted details onto. */
  leadId: string;
}

interface ChatOptions {
  organizationId?: string;
  allowCLI?: boolean;
  /**
   * Model for this request, already clamped to the caller's plan by
   * resolveModelForSite(). Overridden by CHAT_MODEL in the environment.
   */
  chatModel?: ChatModelName;
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

// --- Chat model selection ---

/**
 * Per-model request parameters for the chat path.
 *
 * These travel with the model on purpose: the two are not interchangeable.
 * Haiku 4.5 has no adaptive thinking and rejects `output_config.effort`
 * outright (400), while Sonnet 5 wants both. Swapping only the model string
 * would either error or silently run Sonnet at default effort, so the shape
 * is bound to the choice.
 *
 * Quality note, measured over 3 runs each on the same prompt and input:
 * Haiku invented sales statistics in 2 of 3 responses ("an extra 5-10 calls a
 * week", "3-4 warm leads") despite the prompt forbidding invented stats.
 * Sonnet did it 0 times in 6, and was fractionally faster (4.9s vs 5.4s).
 *
 * Haiku is the default while we're testing, because dev traffic is sporadic
 * enough that most requests cold-start and pay the cache-write premium, where
 * the cheaper base rate actually tells. Go to Sonnet before this faces
 * prospects — fabricated social proof is not something to ship.
 */
const CHAT_MODELS = {
  "claude-haiku-4-5": {
    model: "claude-haiku-4-5",
    // No `thinking` and no `output_config` — both are rejected on this model.
    //
    // Also expect cache_read/cache_write to stay 0 on this model: Haiku 4.5
    // requires a 4096-token minimum cacheable prefix and our system prompt
    // tokenizes to ~3970 here, so the cache_control marker below is silently
    // ignored. No error, just no caching. (The same prompt is ~5546 tokens
    // under Sonnet's tokenizer, comfortably over its 1024 minimum.)
    //
    // Don't pad the prompt to cross the threshold — for the sporadic traffic
    // this default exists to serve, a cold Sonnet request costs more than an
    // uncached Haiku one anyway.
  },
  "claude-sonnet-5": {
    model: "claude-sonnet-5",
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
  },
} as const;

export type ChatModelName = keyof typeof CHAT_MODELS;

export const CHAT_MODEL_NAMES = Object.keys(CHAT_MODELS) as ChatModelName[];

/** Change this one line to switch models (or set CHAT_MODEL in .env). */
const DEFAULT_CHAT_MODEL: ChatModelName = "claude-haiku-4-5";

/**
 * Which models each plan may use, cheapest first.
 *
 * This is the pricing lever: without it a starter customer simply selects the
 * expensive model in their own site settings. Unknown tiers deliberately fall
 * back to the most restrictive list rather than the most permissive — a typo
 * in a plan name should cost us nothing.
 */
export const PLAN_MODELS: Record<string, ChatModelName[]> = {
  starter: ["claude-haiku-4-5"],
  pro: ["claude-haiku-4-5", "claude-sonnet-5"],
  // Bespoke arrangements get the full set.
  custom: ["claude-haiku-4-5", "claude-sonnet-5"],
};

export function modelsForPlan(planTier: string | null | undefined) {
  return PLAN_MODELS[planTier ?? ""] ?? PLAN_MODELS.starter;
}

/**
 * Resolve the model for a request, clamped to the plan.
 *
 * Re-clamped on every request rather than validated only on save: a customer
 * who downgrades must degrade to their new plan's model immediately, without
 * anyone remembering to rewrite stored site rows.
 */
export function resolveModelForSite(
  planTier: string | null | undefined,
  requested: string | null | undefined
): ChatModelName {
  const allowed = modelsForPlan(planTier);
  if (requested && (allowed as string[]).includes(requested)) {
    return requested as ChatModelName;
  }
  // No explicit choice (or one the plan no longer permits) gets the best the
  // plan allows — a paying customer shouldn't be quietly left on the cheap
  // model because nobody ticked a box.
  return allowed[allowed.length - 1];
}

/**
 * Precedence: CHAT_MODEL in the environment, then the caller's plan-clamped
 * choice, then the built-in default.
 *
 * The env var deliberately wins. It is an operator switch set in .env on the
 * server — a level above any per-site setting — and it exists so the whole
 * deployment can be moved between models without a rebuild. It is logged
 * whenever it overrides a caller's choice so that never looks like a bug.
 */
function resolveChatModel(requested?: ChatModelName) {
  const fromEnv = process.env.CHAT_MODEL as ChatModelName | undefined;
  if (fromEnv && fromEnv in CHAT_MODELS) {
    if (requested && requested !== fromEnv) {
      console.log(
        `[CLAUDE] CHAT_MODEL=${fromEnv} overriding site model ${requested}`
      );
    }
    return CHAT_MODELS[fromEnv];
  }
  if (fromEnv) {
    console.warn(
      `[CLAUDE] Unknown CHAT_MODEL "${fromEnv}", falling back to ${DEFAULT_CHAT_MODEL}. ` +
        `Known: ${Object.keys(CHAT_MODELS).join(", ")}`
    );
  }
  if (requested && requested in CHAT_MODELS) return CHAT_MODELS[requested];
  return CHAT_MODELS[DEFAULT_CHAT_MODEL];
}

// --- Anthropic API method (production) ---

async function getChatResponseAPI(
  messages: ChatMessage[],
  systemPrompt: string,
  apiKey: string,
  extractToLead?: LeadExtractionTarget,
  chatModel?: ChatModelName
): Promise<string> {
  const anthropic = new Anthropic({ apiKey });
  const recentMessages = messages.slice(-30);
  const enableTools = Boolean(extractToLead);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseRequest: any = {
    // Model plus its required per-model params — see CHAT_MODELS above.
    ...resolveChatModel(chatModel),
    max_tokens: 4096,

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
    `[CLAUDE] model=${first.model} ` +
      `tools=${enableTools ? "on" : "off"} ` +
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
    const followText = (followUp.content as ContentBlock[]).find(
      (b): b is TextBlock => b.type === "text"
    );

    // Claude often writes its reply alongside the tool call in the first
    // response, then returns nothing but an end_turn after the tool result —
    // it has already said its piece. Falling straight through to the error
    // string there threw away a perfectly good reply and showed the visitor
    // "Sorry, I was unable to generate a response" on the exact turn we
    // captured their details, which is the worst possible moment for it.
    const firstText = firstContent.find(
      (b): b is TextBlock => b.type === "text"
    );
    const resolved = followText?.text || firstText?.text;

    console.log(
      `[CLAUDE] follow-up stop_reason=${followUp.stop_reason} ` +
        `follow_text=${followText ? "y" : "n"} ` +
        `used=${followText?.text ? "follow-up" : firstText?.text ? "first-turn" : "none"}`
    );

    return resolved || "Sorry, I was unable to generate a response.";
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
        options.extractToLead,
        options.chatModel
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
      options?.extractToLead,
      options?.chatModel
    );
  }

  // Last-resort fallback
  if (options?.allowCLI) {
    return getChatResponseCLI(messages, systemPrompt, options.channel);
  }

  return "Sorry, the AI service isn't configured yet. Please contact support.";
}
