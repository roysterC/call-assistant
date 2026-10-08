/**
 * Models that have been replaced, and what they now mean.
 *
 * Saved site choices and CHAT_MODEL values written before a change still name
 * the old model. Without this a site that picked Haiku 4.5 would be moved up
 * to the most expensive model its plan allows, rather than across to Haiku
 * 5.5. No server imports: the website settings page uses it too.
 */
const REPLACED_MODELS: Record<string, string> = {
  "claude-haiku-4-5": "claude-haiku-5-5",
};

/** A model name with any replaced model swapped for its successor. */
export function currentModelName<T extends string | null | undefined>(name: T): T | string {
  return name ? (REPLACED_MODELS[name] ?? name) : name;
}
