/**
 * How statuses look, in one place.
 *
 * These colours carry meaning, so they cannot come from the generic Badge
 * variants — those describe emphasis (default / secondary / outline), not
 * whether something went well. Mapping meaning onto emphasis is how the leads
 * table ended up rendering "new" and "resolved" with the same variant: the two
 * states a salesperson most needs to tell apart looked identical.
 *
 * Sentiment lives here too because the dashboard draws it green/grey/red while
 * the call log drew "positive" in the near-white primary — the same fact shown
 * two ways in one product.
 */

interface StatusStyle {
  label: string;
  className: string;
}

/**
 * Every entry is the same shape — a 15% fill, a 400-weight text colour, a 30%
 * ring — and each is written out in full rather than assembled from a hue.
 * Tailwind scans source for literal class names, so `bg-${hue}-500/15` would
 * compile to nothing and the badges would render bare.
 */
export const LEAD_STATUS: Record<string, StatusStyle> = {
  new: {
    label: "New",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  contacted: {
    label: "Contacted",
    className: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  },
  callback_booked: {
    label: "Callback booked",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  resolved: {
    label: "Resolved",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  lost: {
    label: "Lost",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
  },
};

export function leadStatus(status: string): StatusStyle {
  return (
    LEAD_STATUS[status] ?? {
      // An unrecognised value is shown as-is rather than hidden or guessed at:
      // the column is an unconstrained string and a new state added server-side
      // should still be legible here.
      label: status.replace(/_/g, " "),
      className: "bg-muted text-muted-foreground border-border",
    }
  );
}

export const SENTIMENT: Record<string, StatusStyle> = {
  positive: {
    label: "Positive",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  neutral: {
    label: "Neutral",
    className: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  },
  negative: {
    label: "Negative",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
  },
};

export function sentimentStyle(value: string): StatusStyle {
  return (
    SENTIMENT[value] ?? {
      label: value,
      className: "bg-muted text-muted-foreground border-border",
    }
  );
}

export const CALLBACK_STATUS: Record<string, StatusStyle> = {
  pending: {
    label: "Pending",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  missed: {
    label: "Missed",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
  },
};

export function callbackStatus(status: string): StatusStyle {
  return (
    CALLBACK_STATUS[status] ?? {
      label: status.replace(/_/g, " "),
      className: "bg-muted text-muted-foreground border-border",
    }
  );
}

/**
 * One badge shape for all of the above.
 *
 * Kept next to the palettes because the three tables that use them were
 * otherwise each repeating the same `inline-flex items-center rounded-md
 * border px-1.5 …` string, which is how two of them ended up a pixel apart.
 */
export const STATUS_BADGE =
  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap";

export const APPOINTMENT_STATUS: Record<string, StatusStyle> = {
  booked: {
    label: "Booked",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground border-border",
  },
  no_show: {
    label: "No show",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
  },
};

export function appointmentStatus(status: string): StatusStyle {
  return (
    APPOINTMENT_STATUS[status] ?? {
      label: status.replace(/_/g, " "),
      className: "bg-muted text-muted-foreground border-border",
    }
  );
}

/**
 * Amber, and never truncated in the table.
 *
 * A patch test is a 48-hour lead time and a skin-reaction liability. Buried in
 * a notes column it gets missed, and the consequence lands on the client — so
 * it gets its own colour, distinct from every status above.
 */
export const PATCH_TEST_BADGE =
  "bg-amber-500/15 text-amber-400 border-amber-500/30";

/** Whether the confirmation text actually went out. */
export const SMS_STATUS: Record<"sent" | "failed" | "pending", StatusStyle> = {
  sent: {
    label: "Sent",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  pending: {
    label: "Not sent",
    className: "bg-muted text-muted-foreground border-border",
  },
};
