import { useId, useState } from "react";
import { Button, Input } from "glisse";
import type { SurahInfo } from "../data/surahs";
import { useSettings } from "../state/settings";

interface Props {
  surah: SurahInfo;
  from: number;
  to: number;
  words: number;
  onChange: (from: number, to: number) => void;
}

function parse(value: string): number {
  const western = value.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  return /^\d+$/.test(western) ? Number(western) : NaN;
}

export function RangePicker({ surah, from, to, words, onChange }: Props) {
  const { t } = useSettings();
  const [fromText, setFromText] = useState(String(from));
  const [toText, setToText] = useState(String(to));
  const [synced, setSynced] = useState({ from, to, surah: surah.number });
  const errorId = useId();

  // When the range changes from outside (another surah, "whole surah"), show it in the fields.
  if (synced.from !== from || synced.to !== to || synced.surah !== surah.number) {
    setSynced({ from, to, surah: surah.number });
    if (parse(fromText) !== from || parse(toText) !== to) {
      setFromText(String(from));
      setToText(String(to));
    }
  }

  const a = parse(fromText);
  const b = parse(toText);
  const valid = a >= 1 && b >= a && b <= surah.ayahs;

  const commit = (nextFrom: string, nextTo: string) => {
    const x = parse(nextFrom);
    const y = parse(nextTo);
    if (x >= 1 && y >= x && y <= surah.ayahs) onChange(x, y);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="range-field">
          <span className="field-label">{t.fromAyah}</span>
          <Input
            value={fromText}
            onValueChange={(v) => {
              setFromText(v);
              commit(v, toText);
            }}
            inputMode="numeric"
            type="text"
            aria-invalid={!valid}
            aria-describedby={valid ? undefined : errorId}
          />
        </label>
        <label className="range-field">
          <span className="field-label">{t.toAyah}</span>
          <Input
            value={toText}
            onValueChange={(v) => {
              setToText(v);
              commit(fromText, v);
            }}
            inputMode="numeric"
            type="text"
            aria-invalid={!valid}
            aria-describedby={valid ? undefined : errorId}
          />
        </label>
        <Button onClick={() => onChange(1, surah.ayahs)} disabled={from === 1 && to === surah.ayahs}>
          {t.wholeSurah}
        </Button>
      </div>
      {valid ? (
        <p className="text-muted text-sm">{t.rangeHint(to - from + 1, words)}</p>
      ) : (
        <p id={errorId} className="field-error text-sm" role="alert">
          {t.rangeInvalid(surah.ayahs)}
        </p>
      )}
    </div>
  );
}
