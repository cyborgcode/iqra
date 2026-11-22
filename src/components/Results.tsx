import { Button, Glass } from "glisse";
import type { Evaluation } from "../lib/recitation/evaluate";
import { formatNumber, formatPercent, ayahNumber } from "../lib/format";
import { useSettings } from "../state/settings";
import { ArrowIcon, CheckIcon, CrossIcon, PlusIcon, RepeatIcon, SkipIcon } from "./icons";

interface Props {
  evaluation: Evaluation;
  onTryAgain: () => void;
  onOtherAyahs: () => void;
  idPrefix: string;
}

export function ResultsSummary({ evaluation, onTryAgain, onOtherAyahs }: Omit<Props, "idPrefix">) {
  const { t, settings } = useSettings();
  const { counts, accuracy } = evaluation;
  const circumference = 2 * Math.PI * 42;
  const optional = evaluation.recitedOptional.map((id) => (id === "istiadha" ? t.istiadha : id === "basmala" ? t.basmala : t.sadaqa));

  return (
    <Glass className="card results-summary" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-5">
        <div className="score" aria-hidden="true">
          <svg viewBox="0 0 100 100" width="104" height="104">
            <circle cx="50" cy="50" r="42" className="score-track" />
            <circle
              cx="50"
              cy="50"
              r="42"
              className="score-fill"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - accuracy)}
              transform="rotate(-90 50 50)"
            />
          </svg>
          <span className="score-value">{formatPercent(accuracy, settings.lang)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{t.results}</h2>
          <p className="text-muted">
            <span className="sr-only">{formatPercent(accuracy, settings.lang)} </span>
            {t.accuracy}
          </p>
          <ul className="counts" aria-label={t.results}>
            <li className="count count-correct">
              <CheckIcon size={16} /> {t.countCorrect} <b>{formatNumber(counts.correct, settings.lang)}</b>
            </li>
            <li className="count count-wrong">
              <CrossIcon size={16} /> {t.countWrong} <b>{formatNumber(counts.wrong, settings.lang)}</b>
            </li>
            <li className="count count-missed">
              <SkipIcon size={16} /> {t.countMissed} <b>{formatNumber(counts.missed, settings.lang)}</b>
            </li>
            <li className="count count-extra">
              <PlusIcon size={16} /> {t.countExtra} <b>{formatNumber(counts.extra, settings.lang)}</b>
            </li>
          </ul>
          {optional.length > 0 && (
            <p className="mt-2 text-sm text-muted">
              {t.recitedOptional}: {optional.join(" · ")}
            </p>
          )}
        </div>
      </div>
      <p className="disclaimer mt-3 text-start">{t.disclaimer}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="filled" onClick={onTryAgain}>
          {t.tryAgain}
        </Button>
        <Button onClick={onOtherAyahs}>{t.otherAyahs}</Button>
      </div>
    </Glass>
  );
}

export function Legend() {
  const { t } = useSettings();
  return (
    <Glass className="card">
      <h3 className="mb-3 font-semibold">{t.legend}</h3>
      <ul className="legend">
        <li>
          <span className="quran-sample w w-correct" lang="ar">
            كلمة
          </span>
          <span>
            <span className="legend-cue">{t.countCorrect}</span> — {t.legendCorrect}
          </span>
        </li>
        <li>
          <span className="quran-sample w w-wrong" lang="ar">
            كلمة
            <CrossIcon className="w-badge" size={14} />
          </span>
          <span>
            <span className="legend-cue">{t.countWrong}</span> — {t.legendWrong}
          </span>
        </li>
        <li>
          <span className="quran-sample w w-missed" lang="ar">
            كلمة
          </span>
          <span>
            <span className="legend-cue">{t.countMissed}</span> — {t.legendMissed}
          </span>
        </li>
        <li>
          <span className="extra" lang="ar">
            <PlusIcon size={13} />
            <s>كلمة</s>
          </span>
          <span>
            <span className="legend-cue">{t.countExtra}</span> — {t.legendExtra}
          </span>
        </li>
        <li>
          <span className="extra extra-repeated" lang="ar">
            <RepeatIcon size={13} />
            <s>كلمة</s>
          </span>
          <span>
            <span className="legend-cue">{t.countRepeated}</span> — {t.legendRepeated}
          </span>
        </li>
      </ul>
    </Glass>
  );
}

function Transcript({ text }: { text: string }) {
  const { t } = useSettings();
  return (
    <details className="transcript">
      <summary>{t.transcript}</summary>
      <p lang="ar" dir="rtl" className="transcript-text">
        {text || "—"}
      </p>
      <p className="text-muted text-sm">{t.transcriptNote}</p>
    </details>
  );
}

export function Details({ evaluation, idPrefix, transcript }: { evaluation: Evaluation; idPrefix: string; transcript: string }) {
  const { t } = useSettings();
  const issues = evaluation.words
    .map((w, index) => ({ ...w, index }))
    .filter((w) => w.status !== "correct");
  const extras = evaluation.extras;

  if (issues.length === 0 && extras.length === 0) {
    return (
      <Glass className="card">
        <p className="flex items-center gap-2 font-medium">
          <CheckIcon size={18} /> {t.noMistakes}
        </p>
        <Transcript text={transcript} />
      </Glass>
    );
  }

  const focusWord = (index: number) => {
    const el = document.getElementById(`${idPrefix}-${index}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  };

  return (
    <Glass className="card">
      <h3 className="mb-3 font-semibold">{t.mistakes}</h3>
      <ul className="details">
        {issues.map((w) => (
          <li key={`w-${w.index}`} className={`detail detail-${w.status}`}>
            <button type="button" className="detail-link" onClick={() => focusWord(w.index)}>
              {w.status === "wrong" ? <CrossIcon size={16} /> : <SkipIcon size={16} />}
              <span className="detail-ayah">{ayahNumber(w.ayah)}</span>
              <span className="detail-word" lang="ar">
                {w.text}
              </span>
              <span className="detail-what">
                {w.status === "wrong" ? (
                  <>
                    <ArrowIcon size={14} className="flip-rtl" /> {t.heard}:{" "}
                    <span lang="ar" className="detail-heard">
                      {w.heard}
                    </span>
                  </>
                ) : (
                  t.statusMissed
                )}
              </span>
            </button>
          </li>
        ))}
        {extras.map((e, i) => (
          <li key={`x-${i}`} className="detail detail-extra">
            <span className="detail-link">
              {e.repeated ? <RepeatIcon size={16} /> : <PlusIcon size={16} />}
              <span className="detail-word" lang="ar">
                {e.text}
              </span>
              <span className="detail-what">{e.repeated ? t.repeatedLabel : t.extraLabel}</span>
            </span>
          </li>
        ))}
      </ul>
      <Transcript text={transcript} />
    </Glass>
  );
}
