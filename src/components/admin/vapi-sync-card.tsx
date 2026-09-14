"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, TriangleAlert, Check, Eye } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

/**
 * Push the generated system prompt to the organisation's Vapi assistant.
 *
 * Manual on purpose. Syncing on every settings save means a stray edit
 * rewrites a live assistant mid-evening with nobody watching; a button means
 * somebody chose to.
 *
 * Prompt only — Vapi holds tools as separate objects with their own URLs and
 * credentials, so this reports whether the right number are attached rather
 * than trying to manage them. That mismatch is the thing nobody notices: the
 * agent gets told it can cancel appointments and then has no tool to call.
 */

interface SyncResult {
  synced: boolean;
  dryRun: boolean;
  assistantId: string | null;
  providerId: string;
  expectedTools: string[];
  attachedToolCount: number | null;
  payload?: { model?: { messages?: Array<{ content?: string }> } };
  warnings: string[];
  error?: string;
}

export function VapiSyncCard({ organizationId }: { organizationId: string }) {
  const [result, setResult] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState<"sync" | "preview" | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  async function run(dryRun: boolean) {
    setBusy(dryRun ? "preview" : "sync");
    setShowPrompt(false);
    try {
      const res = await apiFetch(
        `/api/admin/organizations/${organizationId}/vapi-sync${dryRun ? "?dryRun=1" : ""}`,
        { method: "POST" }
      );
      setResult(await res.json());
    } catch (error) {
      console.error("Vapi sync failed:", error);
      setResult({
        synced: false,
        dryRun,
        assistantId: null,
        providerId: "unknown",
        expectedTools: [],
        attachedToolCount: null,
        warnings: [],
        error: "Request failed — see the console.",
      });
    } finally {
      setBusy(null);
    }
  }

  const prompt = result?.payload?.model?.messages?.[0]?.content;
  const toolMismatch =
    result &&
    result.attachedToolCount !== null &&
    result.attachedToolCount !== result.expectedTools.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Voice agent prompt</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          The prompt is generated from this organisation&apos;s opening hours,
          services and diary provider. Editing those changes what the agent
          will <em>do</em> immediately, but not what it <em>says</em> — push it
          here so the two agree.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => run(true)}
            disabled={busy !== null}
          >
            <Eye className="h-4 w-4 mr-1.5" />
            {busy === "preview" ? "Checking…" : "Preview"}
          </Button>
          <Button size="sm" onClick={() => run(false)} disabled={busy !== null}>
            <RefreshCw
              className={cn("h-4 w-4 mr-1.5", busy === "sync" && "animate-spin")}
            />
            {busy === "sync" ? "Pushing…" : "Push to Vapi"}
          </Button>
        </div>

        {result?.error && (
          <p className="text-xs text-red-400">{result.error}</p>
        )}

        {result && !result.error && (
          <div className="space-y-2 text-xs">
            {result.synced && (
              <p className="flex items-center gap-1.5 text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                Pushed to assistant {result.assistantId}
              </p>
            )}
            {result.dryRun && (
              <p className="text-muted-foreground">
                Preview only — nothing was sent.
              </p>
            )}

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>
                Diary provider:{" "}
                <span className="text-foreground">{result.providerId}</span>
              </span>
              {result.attachedToolCount !== null && (
                <span>
                  Tools attached:{" "}
                  <span
                    className={cn(
                      toolMismatch ? "text-amber-400" : "text-foreground"
                    )}
                  >
                    {result.attachedToolCount} of {result.expectedTools.length}
                  </span>
                </span>
              )}
            </div>

            {toolMismatch && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-400">
                <TriangleAlert className="h-4 w-4 shrink-0 mt-px" />
                <div>
                  <p>
                    The prompt tells the agent it can do things it has no tool
                    for. Tools are managed in the Vapi console and are not
                    touched by this sync.
                  </p>
                  <p className="mt-1 font-mono text-[10px] break-all">
                    {result.expectedTools.join(", ")}
                  </p>
                </div>
              </div>
            )}

            {result.warnings
              .filter((w) => !w.startsWith("Vapi has "))
              .map((w, i) => (
                <p key={i} className="text-amber-400">
                  {w}
                </p>
              ))}

            {prompt && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowPrompt((v) => !v)}
                  className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  {showPrompt ? "Hide" : "Show"} the prompt ({prompt.length}{" "}
                  characters)
                </button>
                {showPrompt && (
                  <pre className="mt-2 max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[10px] whitespace-pre-wrap">
                    {prompt}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
