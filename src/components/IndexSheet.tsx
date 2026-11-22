import { useMemo, useState, type FormEvent } from "react";
import { Button, Input, SearchField } from "glisse";
import { SURAHS } from "../data/surahs";
import { HIZB_COUNT, JUZ_COUNT, PAGE_COUNT, ayahIndex, juzStart, pageOf, quarterStart } from "../lib/quran/book";
import { formatNumber, searchKey } from "../lib/format";
import { asciiDigits, parseAyahRef } from "../lib/quran/ref";
import { goToAyah, goToPage } from "../state/route";
import { useSettings } from "../state/settings";
import { openSheet, useSheet } from "../state/ui";
import { Segmented } from "./Directional";
import { num, surahName } from "./labels";
import { Sheet } from "./Sheet";

type Tab = "surah" | "juz" | "hizb" | "page";

const SEARCH = SURAHS.map((s) => ({
  surah: s,
  keys: [searchKey(s.name), searchKey(s.transliteration), searchKey(s.translation)],
}));

export function IndexSheet({ page }: { page: number }) {
  const { t } = useSettings();
  const open = useSheet() === "index";
  const [tab, setTab] = useState<Tab>("surah");
  const close = () => openSheet(null);

  return (
    <Sheet open={open} onClose={close} title={t.indexTitle} className="index-sheet">
      <Segmented
        aria-label={t.contents}
        items={[
          { value: "surah", label: t.indexSurahs },
          { value: "juz", label: t.indexJuz },
          { value: "hizb", label: t.indexHizb },
          { value: "page", label: t.indexPage },
        ]}
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
      />
      <div className="index-body">
        {tab === "surah" && <SurahList onDone={close} />}
        {tab === "juz" && <JuzList onDone={close} />}
        {tab === "hizb" && <HizbList onDone={close} />}
        {tab === "page" && <GoTo page={page} onDone={close} />}
      </div>
    </Sheet>
  );
}

function SurahList({ onDone }: { onDone: () => void }) {
  const { t, settings } = useSettings();
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const raw = query.trim();
    if (!raw) return SURAHS;
    const digits = asciiDigits(raw);
    if (/^\d+$/.test(digits)) return SURAHS.filter((s) => String(s.number).startsWith(String(Number(digits))));
    const q = searchKey(raw);
    return SEARCH.filter((e) => e.keys.some((k) => k.includes(q))).map((e) => e.surah);
  }, [query]);

  return (
    <div className="flex flex-col gap-3">
      <SearchField value={query} onValueChange={setQuery} placeholder={t.searchSurah} aria-label={t.searchSurah} />
      {results.length === 0 ? (
        <p className="text-muted px-1 py-6 text-center">{t.noSurahFound}</p>
      ) : (
        <ul className="surah-list" aria-label={t.indexSurahs}>
          {results.map((s) => (
            <li key={s.number}>
              <button
                type="button"
                className="surah-row"
                onClick={() => {
                  goToAyah(ayahIndex(s.number, 1));
                  onDone();
                }}
              >
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
                <span className="surah-count">
                  {t.ayahCount(s.ayahs)}
                  <br />
                  {t.onPage(num(pageOf(s.number, 1), settings.lang))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JuzList({ onDone }: { onDone: () => void }) {
  const { t, settings } = useSettings();
  return (
    <ul className="tile-grid" aria-label={t.indexJuz}>
      {Array.from({ length: JUZ_COUNT }, (_, i) => {
        const start = juzStart(i + 1);
        return (
          <li key={i}>
            <button
              type="button"
              className="tile"
              onClick={() => {
                goToAyah(ayahIndex(start.surah, start.ayah));
                onDone();
              }}
            >
              <span className="tile-title">{t.juzN(num(i + 1, settings.lang))}</span>
              <span className="tile-sub">
                {surahName(start.surah, settings.lang)} {num(start.ayah, settings.lang)} · {t.onPage(num(pageOf(start.surah, start.ayah), settings.lang))}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function HizbList({ onDone }: { onDone: () => void }) {
  const { t, settings } = useSettings();
  const marks = ["\u06DE", "\u00BC", "\u00BD", "\u00BE"]; // ۞ ¼ ½ ¾
  return (
    <ul className="hizb-list" aria-label={t.indexHizb}>
      {Array.from({ length: HIZB_COUNT }, (_, h) => {
        const start = quarterStart(h * 4 + 1);
        return (
          <li key={h} className="hizb-row">
            <span className="hizb-name">
              <span className="font-semibold">{t.hizbN(num(h + 1, settings.lang))}</span>
              <span className="tile-sub">
                {surahName(start.surah, settings.lang)} {num(start.ayah, settings.lang)}
              </span>
            </span>
            <span className="hizb-quarters">
              {[0, 1, 2, 3].map((part) => {
                const q = quarterStart(h * 4 + part + 1);
                return (
                  <button
                    key={part}
                    type="button"
                    className="quarter"
                    aria-label={`${t.quarterLabel(part, num(h + 1, settings.lang))} · ${surahName(q.surah, settings.lang)} ${num(q.ayah, settings.lang)}`}
                    title={`${surahName(q.surah, settings.lang)} ${num(q.ayah, settings.lang)} · ${t.onPage(num(pageOf(q.surah, q.ayah), settings.lang))}`}
                    onClick={() => {
                      goToAyah(ayahIndex(q.surah, q.ayah));
                      onDone();
                    }}
                  >
                    {marks[part]}
                  </button>
                );
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function GoTo({ page, onDone }: { page: number; onDone: () => void }) {
  const { t, settings } = useSettings();
  const [pageInput, setPageInput] = useState(String(page));
  const [refInput, setRefInput] = useState("");
  const [pageError, setPageError] = useState(false);
  const [refError, setRefError] = useState(false);

  const submitPage = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(asciiDigits(pageInput.trim()));
    if (!Number.isInteger(n) || n < 1 || n > PAGE_COUNT) return setPageError(true);
    goToPage(n);
    onDone();
  };
  const submitRef = (e: FormEvent) => {
    e.preventDefault();
    const ref = parseAyahRef(refInput);
    if (!ref) return setRefError(true);
    goToAyah(ayahIndex(ref.surah, ref.ayah));
    onDone();
  };

  return (
    <div className="flex flex-col gap-6">
      <form className="goto-form" onSubmit={submitPage} noValidate>
        <label className="field-label" htmlFor="goto-page">
          {t.goToPageLabel}
        </label>
        <div className="goto-row">
          <Input
            id="goto-page"
            inputMode="numeric"
            autoComplete="off"
            value={pageInput}
            onValueChange={(v) => {
              setPageInput(v);
              setPageError(false);
            }}
            aria-invalid={pageError}
            aria-describedby={pageError ? "goto-page-error" : undefined}
            placeholder={`1–${formatNumber(PAGE_COUNT, settings.lang)}`}
          />
          <Button type="submit" variant="filled">
            {t.go}
          </Button>
        </div>
        {pageError && (
          <p id="goto-page-error" className="field-error text-sm" role="alert">
            {t.pageInvalid}
          </p>
        )}
      </form>

      <form className="goto-form" onSubmit={submitRef} noValidate>
        <label className="field-label" htmlFor="goto-ref">
          {t.goToAyahLabel}
        </label>
        <div className="goto-row">
          <Input
            id="goto-ref"
            dir="ltr"
            autoComplete="off"
            value={refInput}
            onValueChange={(v) => {
              setRefInput(v);
              setRefError(false);
            }}
            aria-invalid={refError}
            aria-describedby="goto-ref-hint"
            placeholder="2:255"
          />
          <Button type="submit" variant="filled">
            {t.go}
          </Button>
        </div>
        <p id="goto-ref-hint" className={refError ? "field-error text-sm" : "text-muted text-sm"} role={refError ? "alert" : undefined}>
          {refError ? t.refInvalid : t.goToAyahHint}
        </p>
      </form>
    </div>
  );
}
