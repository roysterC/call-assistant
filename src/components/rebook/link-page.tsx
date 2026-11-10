"use client";

/**
 * The pages a rebooking text links to (src/app/r): a client on their phone,
 * not logged in, so no CRM around them, just the salon and what to do.
 */

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LinkPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-sm space-y-3 rounded-2xl border bg-card p-6 text-sm leading-relaxed text-muted-foreground shadow-sm">
        <h1 className="font-heading text-xl font-semibold text-foreground">{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** Instagram's chat cannot be opened with a message written, so it is copied for them. */
export function InstagramBooking({
  businessName,
  username,
  link,
  message,
  contactPhone,
}: {
  businessName: string;
  username: string;
  link: string;
  message: string;
  contactPhone: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const copyAndOpen = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      // No clipboard (an old browser, or refused): the message is on screen to copy by hand.
    }
    window.location.href = link;
  };

  return (
    <LinkPage title={`Book with ${businessName}`}>
      <p>Send this to @{username} on Instagram and we will book it in:</p>
      <blockquote className="rounded-xl bg-muted px-4 py-3 text-base text-foreground select-all">{message}</blockquote>
      <Button type="button" className="w-full" onClick={copyAndOpen}>
        {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
        Copy message and open Instagram
      </Button>
      <p className="text-xs">Then paste it into the chat and send.</p>
      {contactPhone && (
        <p className="text-xs">
          Or ring us on <a className="font-medium underline" href={`tel:${contactPhone}`}>{contactPhone}</a>.
        </p>
      )}
    </LinkPage>
  );
}
