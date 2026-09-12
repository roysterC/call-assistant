/**
 * Count plus correctly pluralised noun.
 *
 * The dashboard rendered "1 callbacks pending". A stray "s" is the kind of
 * detail nobody compliments and everybody notices — it reads as software that
 * nobody proofread, on the screen a client sees first.
 */
export function plural(count: number, one: string, many?: string): string {
  return `${count} ${count === 1 ? one : many ?? `${one}s`}`;
}
