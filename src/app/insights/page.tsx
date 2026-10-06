"use client";

/**
 * Insights: how the organisation's assistants are doing. The receptionist's
 * figures for a salon that has it, the chatbot's for one with a website, and a
 * switch between the two for one with both.
 */

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { TableTabs } from "@/components/ui/data-table";
import { ReceptionistInsights } from "@/components/insights/receptionist-insights";
import { ChatInsights } from "@/components/insights/chat-insights";
import { apiFetch } from "@/lib/api-fetch";

const RANGES = [7, 30, 90];

type View = "receptionist" | "chat";

export default function InsightsPage() {
  const [days, setDays] = useState(30);
  const [features, setFeatures] = useState<{ voice: boolean; chatbot: boolean } | null>(null);
  const [view, setView] = useState<View>("receptionist");

  useEffect(() => {
    apiFetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const f = { voice: !!d?.settings?.voiceEnabled, chatbot: !!d?.settings?.chatbotEnabled };
        setFeatures(f);
        setView(f.voice ? "receptionist" : "chat");
      })
      .catch(() => setFeatures({ voice: false, chatbot: true }));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Insights"
        actions={
          <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Period">
            {RANGES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={`h-9 px-3 text-sm transition-colors ${
                  days === d
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        }
      />

      {features?.voice && features.chatbot && (
        <div className="flex">
          <TableTabs
            label="Show"
            value={view}
            onChange={(v) => setView(v as View)}
            items={[
              { value: "receptionist", label: "Phone receptionist" },
              { value: "chat", label: "Website chat" },
            ]}
          />
        </div>
      )}

      {features && (view === "receptionist" ? <ReceptionistInsights days={days} /> : <ChatInsights days={days} />)}
    </div>
  );
}
