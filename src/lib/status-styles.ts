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
 * the call log drew "positive" in the primary colour — the same fact shown
 * two ways in one product.
 */

interface StatusStyle {
  label: string;
  className: string;
}

/**
 * Every entry is the same shape — a 50 fill, a 700-weight text colour, a 200
 * border — and each is written out in full rather than assembled from a hue.
 * Tailwind scans source for literal class names, so `bg-${hue}-500/15` would
 * compile to nothing and the badges would render bare.
 */
export const LEAD_STATUS: Record<string, StatusStyle> = {
  new: {
    label: "New",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  contacted: {
    label: "Contacted",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
  callback_booked: {
    label: "Callback booked",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
  resolved: {
    label: "Resolved",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  lost: {
    label: "Lost",
    className: "bg-red-50 text-red-700 border-red-200",
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
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  neutral: {
    label: "Neutral",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
  negative: {
    label: "Negative",
    className: "bg-red-50 text-red-700 border-red-200",
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
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  missed: {
    label: "Missed",
    className: "bg-red-50 text-red-700 border-red-200",
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
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground border-border",
  },
  no_show: {
    label: "No show",
    className: "bg-red-50 text-red-700 border-red-200",
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
  "bg-amber-50 text-amber-800 border-amber-200";

/** Whether the confirmation text actually went out. */
export const SMS_STATUS: Record<"sent" | "failed" | "pending", StatusStyle> = {
  sent: {
    label: "Sent",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  failed: {
    label: "Failed",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  pending: {
    label: "Not sent",
    className: "bg-muted text-muted-foreground border-border",
  },
};
