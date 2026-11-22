/** One surah of Tanzil's Uthmani text, exactly as published (see scripts/build-quran-data.mjs). */
export interface SurahText {
  surah: number;
  bismillah: string | null;
  ayahs: string[];
}

const cache = new Map<number, Promise<SurahText>>();

/** Loads only the surah that is needed (one small static file per surah). */
export function loadSurah(n: number): Promise<SurahText> {
  let promise = cache.get(n);
  if (!promise) {
    promise = fetch(`/quran/${String(n).padStart(3, "0")}.json`).then(async (res) => {
      if (!res.ok) throw new Error(`Could not load surah ${n} (${res.status})`);
      const data = (await res.json()) as SurahText;
      return { surah: data.surah, bismillah: data.bismillah, ayahs: data.ayahs };
    });
    promise.catch(() => cache.delete(n));
    cache.set(n, promise);
  }
  return promise;
}
