"use client";

/**
 * How to open the personal assistant hands-free: a link for Siri or Google
 * Assistant to open, and the steps to set it up on each phone.
 */

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

const noSubscribe = () => () => {};

export function AssistantShortcut() {
  // The page's own address, read on the client only: the server can't know it.
  const link = useSyncExternalStore(
    noSubscribe,
    () => `${window.location.origin}/assistant`,
    () => ""
  );
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 text-xs">{link}</code>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="font-medium">iPhone: &ldquo;Hey Siri, salon assistant&rdquo;</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
            <li>Open this CRM in Safari and sign in, so Safari remembers you.</li>
            <li>In the Shortcuts app, tap + and add the action <em>Open URLs</em>.</li>
            <li>Paste the link above into it.</li>
            <li>Name the shortcut <em>Salon assistant</em>, and tap Done.</li>
          </ol>
          <p className="mt-1 text-xs text-muted-foreground">
            Then say &ldquo;Hey Siri, salon assistant&rdquo; and start talking. The first time, allow the microphone.
          </p>
        </div>
        <div>
          <p className="font-medium">Android</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
            <li>Add the CRM to your home screen from Chrome&apos;s menu, if you have not.</li>
            <li>Press and hold its icon, and choose <em>Ask the assistant</em>.</li>
            <li>Drag that onto the home screen for one tap, every time.</li>
          </ol>
          <p className="mt-1 text-xs text-muted-foreground">
            Google Assistant can also open the link: create a routine that opens it, named &ldquo;salon assistant&rdquo;.
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Some phones still ask for one tap before the microphone starts; the assistant shows a big &ldquo;Tap to talk&rdquo; when
        they do. Nothing is booked, changed or sent until you say yes.
      </p>
    </div>
  );
}
