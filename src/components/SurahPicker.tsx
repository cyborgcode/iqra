import { useMemo, useState } from "react";
import { SearchField } from "glisse";
import { SURAHS } from "../data/surahs";
import { formatNumber, searchKey } from "../lib/format";
import { useSettings } from "../state/settings";

interface Props {
  onSelect: (surah: number) => void;
}

const INDEX = SURAHS.map((s) => ({
  surah: s,
  keys: [searchKey(s.name), searchKey(s.transliteration), searchKey(s.translation)],
}));

export function SurahPicker({ onSelect }: Props) {
  const { t, settings } = useSettings();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = searchKey(query.trim());
    if (!q) return SURAHS;
    const digits = query.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    if (/^\d+$/.test(digits)) {
      const n = Number(digits);
      return SURAHS.filter((s) => String(s.number).startsWith(String(n)));
    }
    return INDEX.filter((e) => e.keys.some((k) => k.includes(q))).map((e) => e.surah);
  }, [query]);

  return (
    <div className="flex flex-col gap-3">
      <SearchField value={query} onValueChange={setQuery} placeholder={t.searchSurah} aria-label={t.searchSurah} />
      {results.length === 0 ? (
        <p className="text-muted px-1 py-6 text-center">{t.noSurahFound}</p>
      ) : (
        <ul className="surah-list" aria-label={t.stepSurah}>
          {results.map((s) => (
            <li key={s.number}>
              <button type="button" className="surah-row" onClick={() => onSelect(s.number)}>
                <span className="surah-no" aria-hidden="true">
                  {formatNumber(s.number, settings.lang)}
                </span>
                <span className="surah-names">
                  <span className="surah-ar" lang="ar">
                    {s.name}
                  </span>
                  <span className="surah-en" lang="en" dir="ltr">
                    {s.transliteration} · {s.translation}
                  </span>
                </span>
                <span className="surah-count">{t.ayahCount(s.ayahs)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
