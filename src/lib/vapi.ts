const VAPI_API_KEY = process.env.VAPI_API_KEY!;
const VAPI_BASE_URL = "https://api.vapi.ai";

export async function vapiRequest(path: string, options?: RequestInit) {
  const res = await fetch(`${VAPI_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vapi API error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function listCalls(limit = 50) {
  return vapiRequest(`/call?limit=${limit}`);
}

export async function getCall(callId: string) {
  return vapiRequest(`/call/${callId}`);
}

export async function getAssistant(assistantId: string) {
  return vapiRequest(`/assistant/${assistantId}`);
}

export async function updateAssistant(assistantId: string, data: Record<string, unknown>) {
  return vapiRequest(`/assistant/${assistantId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export interface VapiToolSummary {
  id: string;
  type?: string;
  /** Derived name — see `vapiToolName`. */
  name: string;
}

/**
 * Work out which function a Vapi tool represents.
 *
 * "API Request" tools are all reported as `api_request_tool`, so the name is
 * useless for telling them apart. The last path segment of the server URL is
 * the function they call, which is the only thing that actually identifies
 * them.
 */
export function vapiToolName(tool: Record<string, unknown>): string {
  const server = tool.server as { url?: string } | undefined;
  const url = server?.url ?? (tool.url as string | undefined) ?? "";
  if (url) {
    const leaf = url.replace(/\/+$/, "").split("/").pop();
    if (leaf) return leaf;
  }
  const fn = tool.function as { name?: string } | undefined;
  return fn?.name ?? (tool.type as string) ?? "unknown";
}

export async function listTools(limit = 100): Promise<VapiToolSummary[]> {
  const res = (await vapiRequest(`/tool?limit=${limit}`)) as
    | Record<string, unknown>[]
    | { results?: Record<string, unknown>[] };
  const items = Array.isArray(res) ? res : (res.results ?? []);
  return items.map((t) => ({
    id: String(t.id),
    type: t.type as string | undefined,
    name: vapiToolName(t),
  }));
}
