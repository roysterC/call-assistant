"use client";

/**
 * The phrases, without the rest of the CRM around them: for the booking
 * address (src/lib/booking-host.ts), whose public pages are English and need
 * no sign-in, but share parts (a dialog's close button) that ask for a phrase.
 */

import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { Messages } from "@/lib/i18n";

export function IntlOnly({ messages, children }: { messages: Messages; children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages as unknown as AbstractIntlMessages} timeZone="Europe/London">
      {children}
    </NextIntlClientProvider>
  );
}
