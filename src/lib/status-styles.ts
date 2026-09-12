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
