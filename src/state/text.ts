import { useSyncExternalStore } from "react";
import { loadCorpus, yieldToPage, type Corpus } from "../lib/quran/corpus";
import { SearchIndex } from "../lib/recitation/locate";

/** The whole Quran text, and the index used to find a recitation anywhere in it. */
export interface QuranText {
  corpus: Corpus;
  index: SearchIndex;
}

let text: QuranText | null = null;
let loading: Promise<QuranText> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Loads all 114 surah files (static, cached) and builds the search index, once. */
export function loadText(): Promise<QuranText> {
  loading ??= loadCorpus().then(async (corpus) => {
    const index = await SearchIndex.build(corpus, yieldToPage);
    text = { corpus, index };
    listeners.forEach((l) => l());
    return text;
  });
  loading.catch(() => (loading = null));
  return loading;
}

/** The loaded text, or null until `loadText` has finished. */
export function useText(): QuranText | null {
  return useSyncExternalStore(subscribe, () => text);
}
