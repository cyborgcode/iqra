import { Fragment, useMemo } from "react";
import { tokenizeAyah } from "../lib/quran/tokenize";
import type { Evaluation, ExtraWord, WordResult } from "../lib/recitation/evaluate";
import { ayahNumber } from "../lib/format";
import { useSettings } from "../state/settings";
import { CrossIcon, PlusIcon, RepeatIcon } from "./icons";

export interface AyahLine {
  number: number;
  text: string;
}

interface Props {
  ayahs: readonly AyahLine[];
  /** Shown above the ayahs when the range starts at ayah 1 (verbatim from Tanzil). */
  bismillah?: string | null;
  evaluation?: Evaluation | null;
  /** Id prefix for word elements, so the details list can link to them. */
  idPrefix?: string;
}

/**
 * Renders Tanzil's text exactly as published. Each ayah is split into tokens that join back to the
 * original string; results are attached to words by their index, never by searching the text.
 */
export function QuranText({ ayahs, bismillah, evaluation, idPrefix = "w" }: Props) {
  const { t } = useSettings();

  const extrasAfter = useMemo(() => {
    const map = new Map<number, ExtraWord[]>();
    for (const extra of evaluation?.extras ?? []) {
      const list = map.get(extra.after) ?? [];
      list.push(extra);
      map.set(extra.after, list);
    }
    return map;
  }, [evaluation]);

  let global = 0;
  return (
    <div className="quran-block" lang="ar" dir="rtl">
      {bismillah && <p className="quran bismillah">{bismillah}</p>}
      <p className="quran">
        {(extrasAfter.get(-1) ?? []).map((e, i) => (
          <Extra key={`x-start-${i}`} extra={e} labels={t} />
        ))}
        {ayahs.map((ayah) => (
          <span key={ayah.number} className="ayah">
            {tokenizeAyah(ayah.text).map((token, i) => {
              if (token.kind === "space") return <Fragment key={i}>{token.text}</Fragment>;
              if (token.kind === "mark") return <span key={i} className="mark">{token.text}</span>;
              const index = global++;
              const result = evaluation?.words[index];
              return (
                <Fragment key={i}>
                  <Word text={token.text} result={result} id={`${idPrefix}-${index}`} labels={t} />
                  {(extrasAfter.get(index) ?? []).map((e, j) => (
                    <Extra key={`x-${index}-${j}`} extra={e} labels={t} />
                  ))}
                </Fragment>
              );
            })}{" "}
            <span className="ayah-number" aria-label={`${ayah.number}`}>
              {ayahNumber(ayah.number)}
            </span>{" "}
          </span>
        ))}
      </p>
    </div>
  );
}

type Labels = ReturnType<typeof useSettings>["t"];

function Word({ text, result, id, labels }: { text: string; result?: WordResult; id: string; labels: Labels }) {
  if (!result) return <span className="w">{text}</span>;
  const status = result.status;
  const description =
    status === "wrong" ? `${labels.statusWrong}. ${labels.heard}: ${result.heard ?? ""}` : status === "missed" ? labels.statusMissed : labels.statusCorrect;
  return (
    <span
      id={id}
      className={`w w-${status}`}
      title={status === "correct" ? undefined : description}
      tabIndex={status === "correct" ? undefined : 0}
    >
      {text}
      {status === "wrong" && <CrossIcon className="w-badge" size={14} />}
      {status !== "correct" && <span className="sr-only"> ({description})</span>}
    </span>
  );
}

function Extra({ extra, labels }: { extra: ExtraWord; labels: Labels }) {
  const label = extra.repeated ? labels.repeatedLabel : labels.extraLabel;
  return (
    <span className={`extra ${extra.repeated ? "extra-repeated" : ""}`} title={label}>
      {extra.repeated ? <RepeatIcon size={13} /> : <PlusIcon size={13} />}
      <s>{extra.text}</s>
      <span className="sr-only"> ({label})</span>
    </span>
  );
}
