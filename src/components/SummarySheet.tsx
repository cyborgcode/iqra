import { Button } from "glisse";
import type { Corpus } from "../lib/quran/corpus";
import { formatNumber, formatPercent } from "../lib/format";
import { goToAyah } from "../state/route";
import { dismissSummary, useRecitation, type Summary } from "../state/recitation";
import { useSettings } from "../state/settings";
import { CheckIcon, CrossIcon, PlusIcon, RepeatIcon, SkipIcon, TargetIcon } from "./icons";
import { ayahLabel } from "./labels";
import { Sheet } from "./Sheet";

interface Props {
  corpus: Corpus | null;
  /** Recite again from the first ayah with a mistake (mistakesOnly) or from the start of this recitation. */
  onRetry: (summary: Summary, mistakesOnly: boolean) => void;
}

/** What was recited, how it went, and where to look again. Opens when a recitation ends. */
export function SummarySheet({ corpus, onRetry }: Props) {
  const { t, settings } = useSettings();
  const { summary } = useRecitation();
  const lang = settings.lang;
  const open = summary !== null && corpus !== null;

  return (
    <Sheet open={open} onClose={dismissSummary} title={t.summaryTitle} className="summary-sheet">
      {summary && corpus && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-5">
            <ScoreRing value={summary.accuracy} label={formatPercent(summary.accuracy, lang)} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {ayahLabel(corpus.ayahOfWord[summary.first]!, lang)} – {ayahLabel(corpus.ayahOfWord[summary.last]!, lang)}
              </p>
              <p className="text-muted text-sm">
                {t.summaryWords(formatNumber(summary.words, lang))} · {t.accuracy}
              </p>
              <ul className="counts" aria-label={t.results}>
                <li className="count count-correct">
                  <CheckIcon size={16} /> {t.countCorrect} <b>{formatNumber(summary.counts.correct, lang)}</b>
                </li>
                <li className="count count-wrong">
                  <CrossIcon size={16} /> {t.countWrong} <b>{formatNumber(summary.counts.wrong, lang)}</b>
                </li>
                <li className="count count-missed">
                  <SkipIcon size={16} /> {t.countMissed} <b>{formatNumber(summary.counts.missed, lang)}</b>
                </li>
                <li className="count count-extra">
                  <PlusIcon size={16} /> {t.countExtra} <b>{formatNumber(summary.counts.extra, lang)}</b>
                </li>
              </ul>
            </div>
          </div>

          {(summary.phrases.length > 0 || summary.hints > 0 || summary.unmatched > 0 || summary.limitReached) && (
            <div className="text-muted flex flex-col gap-1 text-sm">
              {summary.phrases.length > 0 && (
                <p>
                  {t.recitedOptional}: {summary.phrases.map((id) => t[id]).join(" · ")}
                </p>
              )}
              {summary.hints > 0 && <p>{t.hintsUsed(formatNumber(summary.hints, lang))}</p>}
              {summary.unmatched > 0 && <p>{t.unmatched(formatNumber(summary.unmatched, lang))}</p>}
              {summary.limitReached && <p className="field-error">{t.limitReached}</p>}
            </div>
          )}

          {summary.review.length === 0 ? (
            <p className="flex items-center gap-2 font-medium">
              <CheckIcon size={18} /> {t.noMistakes}
            </p>
          ) : (
            <section aria-labelledby="review-title">
              <h3 id="review-title" className="mb-2 font-semibold">
                {t.reviewTitle}
              </h3>
              <ul className="review-list">
                {summary.review.map((r) => (
                  <li key={r.ayah}>
                    <button
                      type="button"
                      className="review-row"
                      onClick={() => {
                        dismissSummary();
                        goToAyah(r.ayah);
                      }}
                    >
                      <span className="review-ayah">{ayahLabel(r.ayah, lang)}</span>
                      <span className="review-counts">
                        {r.wrong > 0 && (
                          <span className="count-wrong">
                            <CrossIcon size={14} /> {formatNumber(r.wrong, lang)}
                          </span>
                        )}
                        {r.missed > 0 && (
                          <span className="count-missed">
                            <SkipIcon size={14} /> {formatNumber(r.missed, lang)}
                          </span>
                        )}
                        {r.extra > 0 && (
                          <span className="count-extra">
                            <PlusIcon size={14} /> {formatNumber(r.extra, lang)}
                          </span>
                        )}
                      </span>
                      <span className="review-show">{t.show}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap gap-3">
            {summary.review.length > 0 && (
              <Button variant="filled" icon={<TargetIcon size={18} />} onClick={() => onRetry(summary, true)}>
                {t.practiceMistakes}
              </Button>
            )}
            <Button variant={summary.review.length > 0 ? "glass" : "filled"} icon={<RepeatIcon size={18} />} onClick={() => onRetry(summary, false)}>
              {t.reciteAgain}
            </Button>
            <Button onClick={dismissSummary}>{t.close}</Button>
          </div>

          {summary.transcript && (
            <details className="transcript">
              <summary>{t.transcript}</summary>
              <p lang="ar" dir="rtl" className="transcript-text">
                {summary.transcript}
              </p>
              <p className="text-muted text-sm">{t.transcriptNote}</p>
            </details>
          )}

          <details className="transcript">
            <summary>{t.legend}</summary>
            <Legend />
          </details>

          <p className="disclaimer text-start">{t.disclaimer}</p>
        </div>
      )}
    </Sheet>
  );
}

function ScoreRing({ value, label }: { value: number; label: string }) {
  const circumference = 2 * Math.PI * 42;
  return (
    <div className="score" aria-hidden="true">
      <svg viewBox="0 0 100 100" width="104" height="104">
        <circle cx="50" cy="50" r="42" className="score-track" />
        <circle
          cx="50"
          cy="50"
          r="42"
          className="score-fill"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value)}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className="score-value">{label}</span>
    </div>
  );
}

/** How each word status looks: colour plus a second cue (underline style, outline, icon). */
export function Legend() {
  const { t } = useSettings();
  return (
    <ul className="legend mt-3">
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
      <li>
        <span className="quran-sample w w-live" lang="ar">
          كلمة
        </span>
        <span>{t.legendLive}</span>
      </li>
    </ul>
  );
}
