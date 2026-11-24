import { memo, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SURAHS } from "../data/surahs";
import { STRINGS } from "../i18n";
import { PAGE_COUNT, ayahRef, juzOfAyah, pageAyahs, quarterOfAyah, quarterStartingAt, surahsOnPage } from "../lib/quran/book";
import type { Corpus } from "../lib/quran/corpus";
import { loadSurah } from "../lib/quran/load";
import { tokenizeAyah } from "../lib/quran/tokenize";
import { ayahNumber, currentDigits } from "../lib/format";
import type { ExtraMark, WordMark } from "../lib/recitation/tracker";
import { marks } from "../state/recitation";
import { useSettings } from "../state/settings";
import { openSheet } from "../state/ui";
import { ChevronIcon, CrossIcon, PlusIcon, RepeatIcon } from "./icons";
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
  /** Words being recited, heard provisionally (lit, and revealed in "recite from memory"). */
  live: ReadonlySet<number>;
  /** Words the reciter's voice has gone on to, not heard yet: lit too, and revealed in "recite from memory". */
  ahead: ReadonlySet<number>;
  /** Words of the phrase being recited already checked, provisionally: shown before the book's marks. */
  checked: ReadonlyMap<number, WordMark>;
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
  /** Called once the page's text is laid out, so the book can size it to the screen. */
  onLaidOut: () => void;
  /** Page-turn buttons for this page's footer (the next page lies to the left, as in a Mushaf). */
  onPrevious?: () => void;
  onNext?: () => void;
  /** Show Tanzil's credit in this page's footer. */
  credit?: boolean;
}

/**
 * A page of the Madani Mushaf (its ayah range from Tanzil's metadata), with surah headings, the basmala,
 * ayah markers and, once recited, the status of every word. The text is never altered: it is split
 * into tokens that join back to the original ayah, and marks are attached to words by position.
 * Nothing a mark adds changes the layout, so a page sized to the screen stays that size.
 */
function MushafPageView(props: Props) {
  const { page, corpus, view, selected, onSelect, focus, onFocused, onLaidOut, onPrevious, onNext, credit } = props;
  const { t, settings } = useSettings();
  const text = usePageText(page, corpus);
  const [peek, setPeek] = useState<number | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLElement>(null);

  const [first, last] = pageAyahs(page);
  const surahs = surahsOnPage(page);
  const juz = juzOfAyah(first);
  const hizb = Math.ceil(quarterOfAyah(first) / 4);
  const lang = settings.lang;

  useLayoutEffect(() => {
    if (text) onLaidOut();
  }, [text, onLaidOut]);

  useEffect(() => {
    if (focus === null || !text || focus < first || focus >= last) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-ayah="${focus}"]`);
    if (!el) return;
    // Only needed when large text makes the page scroll; a fitted page is all in view.
    el.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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
  const headSurahs = surahs.length === 1 ? t.surahTitle(surahName(surahs[0]!, lang)) : surahs.map((s) => surahName(s, lang)).join(" · ");

  return (
    <article ref={root} className="mushaf-page" dir={lang === "ar" ? "rtl" : "ltr"} aria-label={t.pageN(num(page, lang))}>
      <header className="page-head">
        <button type="button" className="page-surah" onClick={() => openSheet("index")} aria-label={`${headSurahs} · ${t.contents}`}>
          <span className="page-surah-name">{headSurahs}</span>
          <ChevronIcon size={14} className="page-surah-chevron" />
        </button>
        <span className="page-juz">
          {t.juzN(num(juz, lang))} · {t.hizbN(num(hizb, lang))}
        </span>
      </header>

      {/* Pages 1 and 2 are set larger, in fewer lines, as in the printed Mushaf. */}
      <div className="page-body" data-page={page} data-lines={page <= 2 ? 9 : 15}>
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
                    <QuarterMark ayah={a.index} />
                    <AyahWords ayah={a} view={view} peek={isPeek} labels={t} />
                    {/* An inline element with no space before it, so the ornament never starts a line on its own. */}
                    <span
                      role="button"
                      tabIndex={0}
                      className="ayah-end"
                      aria-pressed={selected === a.index}
                      aria-label={`${t.ayahN(num(a.ayah, lang))} · ${surahName(a.surah, lang)}`}
                      onClick={() => onSelect(selected === a.index ? null : a.index)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        onSelect(selected === a.index ? null : a.index);
                      }}
                    >
                      <AyahOrnament n={a.ayah} />
                    </span>{" "}
                  </span>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      <footer className="page-foot">
        {credit && (
          <a className="page-credit" href="https://tanzil.net" target="_blank" rel="noopener noreferrer">
            {t.creditShort}
          </a>
        )}
        {/* Mushaf order in every interface language: the previous page on the right, the next on the left. */}
        <span className="page-turns" dir="rtl">
          {onPrevious && (
            <button type="button" className="page-turn-btn" aria-label={t.previousPage} disabled={page <= 1} onClick={onPrevious}>
              <ChevronIcon size={18} className="mirror" />
            </button>
          )}
          <span className="page-number">{ayahNumber(page)}</span>
          {onNext && (
            <button type="button" className="page-turn-btn" aria-label={t.nextPage} disabled={page >= PAGE_COUNT} onClick={onNext}>
              <ChevronIcon size={18} />
            </button>
          )}
        </span>
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

/**
 * The end-of-ayah sign with the ayah's number. Given Arabic-Indic digits, the Mushaf font draws sign and
 * number as one ornament; it does not enclose 1 2 3, so for those its empty sign (always 1.28 em wide)
 * is drawn and the number is centred on it.
 */
function AyahOrnament({ n }: { n: number }) {
  const number = ayahNumber(n);
  if (currentDigits() === "indic") return <>{`\u06DD${number}`}</>;
  return (
    <>
      {"\u06DD"}
      <span className={`ayah-num${number.length > 2 ? " ayah-num-long" : ""}`}>
        <span>{number}</span>
      </span>
    </>
  );
}

/**
 * The rub al-hizb sign before an ayah that starts a hizb quarter, as printed Mushafs mark them. It is
 * page decoration from Tanzil's quarter data, not part of the ayah's text.
 */
function QuarterMark({ ayah }: { ayah: number }) {
  const { t, settings } = useSettings();
  const quarter = quarterStartingAt(ayah);
  if (quarter === null || quarter === 1) return null;
  const label = t.quarterLabel((quarter - 1) % 4, num(Math.ceil(quarter / 4), settings.lang));
  return (
    <>
      <span className="hizb-mark" role="img" aria-label={label} title={label}>
        {"\u06DE"}
      </span>{" "}
    </>
  );
}

type Labels = ReturnType<typeof useSettings>["t"];

function AyahWords({ ayah, view, peek, labels }: { ayah: PageAyah; view: PageView; peek: boolean; labels: Labels }) {
  const out: ReactNode[] = [];
  const tokens = tokenizeAyah(ayah.text);
  if (ayah.firstWord === 0) pushExtras(out, marks.extras.get(-1), "start", labels);
  for (const [i, token] of tokens.entries()) {
    const next = tokens[i + 1];
    if (token.kind === "space" && next?.kind === "mark") {
      // A pause mark belongs with the word before it: no line break between them (layout only; the
      // characters are exactly Tanzil's).
      out.push(
        <span key={i} className="mark-glue">
          {token.text}
          <span className="mark">{next.text}</span>
        </span>,
      );
      continue;
    }
    if (token.kind === "mark" && tokens[i - 1]?.kind === "space") continue;
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
    const checked = w === null ? undefined : view.checked.get(w);
    // Being recited now, not checked yet: heard by the model, or the voice has gone on to it.
    const current = w !== null && !checked && (view.live.has(w) || view.ahead.has(w));
    // With the text shown it lights up; hidden ("recite from memory"), it is revealed as it is said, in
    // the text's own colour until it is checked.
    const live = current && !view.memorize;
    const mark = checked ?? (current || w === null ? undefined : marks.words.get(w));
    const masked = view.memorize && !peek && (w === null || !view.revealed.has(w)) && !current && !checked;
    out.push(
      <Word
        key={i}
        text={token.text}
        mark={mark}
        live={live}
        next={w !== null && w === view.next}
        masked={masked}
        hinted={w !== null && view.hinted.has(w)}
        labels={labels}
      />,
    );
    if (w !== null && !masked) pushExtras(out, marks.extras.get(w), String(w), labels);
  }
  return <>{out}</>;
}

/**
 * Words said but not in the text, shown as a small pin between words (tap or hover for the words),
 * so they never push the page's lines around.
 */
function pushExtras(out: ReactNode[], extras: readonly ExtraMark[] | undefined, key: string, labels: Labels) {
  if (!extras?.length) return;
  const repeated = extras.every((e) => e.repeated);
  const label = repeated ? labels.repeatedLabel : labels.extraLabel;
  const words = extras.map((e) => e.text).join(" ");
  out.push(
    <span key={`x-${key}`} className="extra-anchor">
      <button type="button" className={`extra-pin${repeated ? " extra-repeated" : ""}`} aria-label={`${label}: ${words}`}>
        {repeated ? <RepeatIcon /> : <PlusIcon />}
      </button>
      <span className="extra-bubble" role="tooltip">
        <span className="extra-bubble-label">{label}</span> <s lang="ar">{words}</s>
      </span>
    </span>,
  );
}

function Word(props: { text: string; mark?: WordMark; live: boolean; next: boolean; masked: boolean; hinted: boolean; labels: Labels }) {
  const { text, mark, live, next, masked, hinted, labels } = props;
  const classes = ["w"];
  if (mark) classes.push(`w-${mark.status}`);
  if (live) classes.push("w-live");
  if (next) classes.push("w-next");
  if (masked) classes.push("w-masked");
  if (hinted) classes.push("w-hint");
  if (masked) {
    return (
      <span className={classes.join(" ")} aria-label={labels.wordHidden}>
        <span aria-hidden="true">{text}</span>
      </span>
    );
  }
  if (!mark || mark.status === "correct") return <span className={classes.join(" ")}>{text}</span>;
  const description = mark.status === "wrong" ? `${labels.statusWrong}. ${labels.heard}: ${mark.heard ?? ""}` : labels.statusMissed;
  return (
    <span className={classes.join(" ")} title={description} tabIndex={0}>
      {text}
      {mark.status === "wrong" && <CrossIcon className="w-badge" />}
      <span className="sr-only"> ({description})</span>
    </span>
  );
}

/**
 * Renders again only when something it shows changes (not when a sheet opens or the dock changes): a
 * page is hundreds of words.
 */
export const MushafPage = memo(MushafPageView);
