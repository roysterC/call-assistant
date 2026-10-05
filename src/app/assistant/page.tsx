"use client";

/**
 * A link that opens the CRM with the personal assistant already listening,
 * for Siri ("Hey Siri, salon assistant") or Google Assistant to open, or an
 * app-icon shortcut. It goes to the organisation's start page with
 * ?assistant=listen, which the assistant (on every page) picks up.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AssistantLink() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/start?assistant=listen");
  }, [router]);
  return null;
}
