import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SURAHS } from "../data/surahs";
import { STRINGS } from "../i18n";
import { ayahRef, juzOfAyah, pageAyahs, surahsOnPage } from "../lib/quran/book";
import type { Corpus } from "../lib/quran/corpus";
import { loadSurah } from "../lib/quran/load";
import { tokenizeAyah } from "../lib/quran/tokenize";
import { ayahNumber } from "../lib/format";
import type { ExtraMark, WordMark } from "../lib/recitation/tracker";
import { marks } from "../state/recitation";
import { useSettings } from "../state/settings";
import { CrossIcon, PlusIcon, RepeatIcon } from "./icons";
import { num, surahName } from "./labels";

/** One ayah on a page, with Tanzil's text exactly as published. */
interface PageAyah {
  index: number;
  surah: number;
  ayah: number;
  text: string;
  /** Corpus index of its first word, once the whole text is loaded (needed for marks). */
  firstWord: number | null;
}

interface PageText {
  page: number;
  ayahs: PageAyah[];
  /** Basmala shown above each surah that starts on the page, verbatim (null for 1 and 9). */
  bismillah: Map<number, string | null>;
}

function fromCorpus(page: number, corpus: Corpus): PageText {
  const [from, to] = pageAyahs(page);
  const ayahs: PageAyah[] = [];
  const bismillah = new Map<number, string | null>();
  for (let i = from; i < to; i++) {
    const { surah, ayah } = ayahRef(i);
    if (ayah === 1) bismillah.set(surah, corpus.bismillah[surah - 1] ?? null);
    ayahs.push({ index: i, surah, ayah, text: corpus.ayahText[i]!, firstWord: corpus.ayahStart[i]! });
  }
  return { page, ayahs, bismillah };
}

/** The page's ayahs: from the whole text when it is loaded, otherwise from just the page's surahs. */
function usePageText(page: number, corpus: Corpus | null): PageText | null {
  const [loaded, setLoaded] = useState<PageText | null>(null);
  useEffect(() => {
    if (corpus) return;
    let alive = true;
    void Promise.all(surahsOnPage(page).map(loadSurah)).then((surahs) => {
      if (!alive) return;
      const [from, to] = pageAyahs(page);
      const ayahs: PageAyah[] = [];
      const bismillah = new Map<number, string | null>();
      for (let i = from; i < to; i++) {
        const { surah, ayah } = ayahRef(i);
        const text = surahs.find((s) => s.surah === surah)!;
        if (ayah === 1) bismillah.set(surah, text.bismillah);
        ayahs.push({ index: i, surah, ayah, text: text.ayahs[ayah - 1]!, firstWord: null });
      }
      setLoaded({ page, ayahs, bismillah });
    });
    return () => {
      alive = false;
    };
  }, [page, corpus]);
  return useMemo(() => (corpus ? fromCorpus(page, corpus) : loaded?.page === page ? loaded : null), [corpus, page, loaded]);
}

export interface PageView {
  /** Words heard provisionally in the phrase being recited. */
  live: ReadonlySet<number>;
  /** The next word expected from the reciter, if known. */
  next: number | null;
  /** "Recite from memory": words not in `revealed` are hidden. */
  memorize: boolean;
  revealed: ReadonlySet<number>;
  hinted: ReadonlySet<number>;
  /** Marks change without the maps changing identity; this changes with them. */
  version: number;
}

interface Props {
  page: number;
  corpus: Corpus | null;
  view: PageView;
  selected: number | null;
  onSelect: (ayah: number | null) => void;
  /** An ayah to bring into view and highlight briefly. */
  focus: number | null;
  onFocused: () => void;
}

/**
 * A page of the Madani Mushaf (its ayah range from Tanzil's metadata), with surah headings, the basmala,
 * ayah numbers and, once recited, the status of every word. The text is never altered: it is split
 * into tokens that join back to the original ayah, and marks are attached to words by position.
 */
export function MushafPage({ page, corpus, view, selected, onSelect, focus, onFocused }: Props) {
  const { t, settings } = useSettings();
  const text = usePageText(page, corpus);
  const [peek, setPeek] = useState<number | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLElement>(null);

  const [first, last] = pageAyahs(page);
  const surahs = surahsOnPage(page);
  const juz = juzOfAyah(first);

  useEffect(() => {
    if (focus === null || !text || focus < first || focus >= last) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-ayah="${focus}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.classList.add("ayah-flash");
    const id = setTimeout(() => el.classList.remove("ayah-flash"), 1600);
    onFocused();
    return () => clearTimeout(id);
  }, [focus, text, first, last, onFocused]);

  const endPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    setPeek(null);
  };

  // "Surah Al-Baqara" on a page of one surah; just the names when several surahs share the page.
  const headSurahs = surahs.length === 1 ? t.surahTitle(surahName(surahs[0]!, settings.lang)) : surahs.map((s) => surahName(s, settings.lang)).join(" · ");

  return (
    <article ref={root} className="mushaf-page" aria-label={t.pageN(num(page, settings.lang))}>
      <header className="page-head">
        <span className="page-head-surah">{headSurahs}</span>
        <span className="page-head-juz">{t.juzN(num(juz, settings.lang))}</span>
      </header>

      {!text ? (
        <div className="page-loading" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
        </div>
      ) : (
        <div className="quran page-text" lang="ar" dir="rtl">
          {text.ayahs.map((a) => {
            const isPeek = peek === a.index || (view.memorize && selected === a.index);
            return (
              <Fragment key={a.index}>
                {a.ayah === 1 && <SurahHeading surah={a.surah} bismillah={text.bismillah.get(a.surah) ?? null} />}
                <span
                  data-ayah={a.index}
                  className={`ayah${selected === a.index ? " ayah-selected" : ""}`}
                  onPointerDown={
                    view.memorize
                      ? () => {
                          if (pressTimer.current) clearTimeout(pressTimer.current);
                          pressTimer.current = setTimeout(() => setPeek(a.index), 320);
                        }
                      : undefined
                  }
                  onPointerUp={view.memorize ? endPress : undefined}
                  onPointerLeave={view.memorize ? endPress : undefined}
                  onPointerCancel={view.memorize ? endPress : undefined}
                  onContextMenu={view.memorize ? (e) => e.preventDefault() : undefined}
                >
                  <AyahWords ayah={a} view={view} peek={isPeek} hiddenLabel={t.wordHidden} labels={t} />
                  <button
                    type="button"
                    className="ayah-end"
                    aria-pressed={selected === a.index}
                    aria-label={`${t.ayahN(num(a.ayah, settings.lang))} · ${surahName(a.surah, settings.lang)}`}
                    onClick={() => onSelect(selected === a.index ? null : a.index)}
                  >
                    {ayahNumber(a.ayah)}
                  </button>{" "}
                </span>
              </Fragment>
            );
          })}
        </div>
      )}

      <footer className="page-foot">
        <span className="page-number">{ayahNumber(page)}</span>
      </footer>
    </article>
  );
}

function SurahHeading({ surah, bismillah }: { surah: number; bismillah: string | null }) {
  const { settings } = useSettings();
  const info = SURAHS[surah - 1]!;
  return (
    <span className="surah-heading" role="heading" aria-level={2}>
      <span className="surah-frame">
        <span className="surah-frame-name" lang="ar">
          {STRINGS.ar.surahTitle(info.name)}
        </span>
        {settings.lang !== "ar" && (
          <span className="surah-frame-en" lang="en" dir="ltr">
            {info.transliteration} · {info.translation}
          </span>
        )}
      </span>
      {bismillah && <span className="basmala">{bismillah}</span>}
    </span>
  );
}

type Labels = ReturnType<typeof useSettings>["t"];

function AyahWords({ ayah, view, peek, hiddenLabel, labels }: { ayah: PageAyah; view: PageView; peek: boolean; hiddenLabel: string; labels: Labels }) {
  const out: ReactNode[] = [];
  const tokens = tokenizeAyah(ayah.text);
  if (ayah.firstWord === 0) pushExtras(out, marks.extras.get(-1), "start", labels);
  for (const [i, token] of tokens.entries()) {
    if (token.kind === "space") {
      out.push(token.text);
      continue;
    }
    if (token.kind === "mark") {
      out.push(
        <span key={i} className="mark">
          {token.text}
        </span>,
      );
      continue;
    }
    const w = ayah.firstWord === null ? null : ayah.firstWord + token.index;
    const mark = w === null ? undefined : marks.words.get(w);
    const live = w !== null && view.live.has(w);
    const masked = view.memorize && !peek && (w === null || !view.revealed.has(w)) && !live;
    out.push(
      <Word
        key={i}
        text={token.text}
        mark={live ? undefined : mark}
        live={live}
        next={w !== null && w === view.next}
        masked={masked}
        hinted={w !== null && view.hinted.has(w)}
        hiddenLabel={hiddenLabel}
        labels={labels}
      />,
    );
    if (w !== null && !masked) pushExtras(out, marks.extras.get(w), String(w), labels);
  }
  return <>{out}</>;
}

function pushExtras(out: ReactNode[], extras: readonly ExtraMark[] | undefined, key: string, labels: Labels) {
  extras?.forEach((e, j) => {
    const label = e.repeated ? labels.repeatedLabel : labels.extraLabel;
    out.push(
      " ",
      <span key={`x-${key}-${j}`} className={`extra${e.repeated ? " extra-repeated" : ""}`} title={label}>
        {e.repeated ? <RepeatIcon size={13} /> : <PlusIcon size={13} />}
        <s>{e.text}</s>
        <span className="sr-only"> ({label})</span>
      </span>,
    );
  });
}

function Word(props: { text: string; mark?: WordMark; live: boolean; next: boolean; masked: boolean; hinted: boolean; hiddenLabel: string; labels: Labels }) {
  const { text, mark, live, next, masked, hinted, hiddenLabel, labels } = props;
  const classes = ["w"];
  if (mark) classes.push(`w-${mark.status}`);
  if (live) classes.push("w-live");
  if (next) classes.push("w-next");
  if (masked) classes.push("w-masked");
  if (hinted) classes.push("w-hint");
  if (masked) {
    return (
      <span className={classes.join(" ")} aria-label={hiddenLabel}>
        <span aria-hidden="true">{text}</span>
      </span>
    );
  }
  if (!mark || mark.status === "correct") return <span className={classes.join(" ")}>{text}</span>;
  const description = mark.status === "wrong" ? `${labels.statusWrong}. ${labels.heard}: ${mark.heard ?? ""}` : labels.statusMissed;
  return (
    <span className={classes.join(" ")} title={description} tabIndex={0}>
      {text}
      {mark.status === "wrong" && <CrossIcon className="w-badge" size={14} />}
      <span className="sr-only"> ({description})</span>
    </span>
  );
}
