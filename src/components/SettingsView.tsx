import { useEffect, useState } from "react";
import { Button, Glass } from "glisse";
import { RangeSlider, Segmented, Toggle } from "./Directional";
import { MODELS, RUNTIME, modelBytes } from "../config/models";
import { deleteDownloads, engineFor } from "../lib/asr/client";
import { formatMegabytes, formatPercent } from "../lib/format";
import { resetModel, useModelStatus } from "../state/model";
import { DEFAULT_THRESHOLD, useSettings } from "../state/settings";
import { TrashIcon } from "./icons";

export function SettingsView() {
  const { t, settings, update } = useSettings();
  const model = useModelStatus();
  const [engineBytes, setEngineBytes] = useState({ standard: RUNTIME.wasm.bytes, accurate: RUNTIME.wasm.bytes });
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    void Promise.all([engineFor(settings.engine, "standard"), engineFor(settings.engine, "accurate")]).then(([a, b]) =>
      setEngineBytes({ standard: RUNTIME[a].bytes, accurate: RUNTIME[b].bytes }),
    );
  }, [settings.engine]);

  const size = (id: "standard" | "accurate") => formatMegabytes(modelBytes(MODELS[id]) + engineBytes[id], settings.lang);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="page-title">{t.settingsTitle}</h1>

      <Glass className="card setting">
        <h2 className="setting-title" id="set-lang">
          {t.setLanguage}
        </h2>
        <Segmented
          aria-labelledby="set-lang"
          items={[
            { value: "ar", label: "العربية" },
            { value: "en", label: "English" },
          ]}
          value={settings.lang}
          onValueChange={(v) => update({ lang: v === "ar" ? "ar" : "en" })}
        />
      </Glass>

      <Glass className="card setting">
        <h2 className="setting-title" id="set-theme">
          {t.setTheme}
        </h2>
        <Segmented
          aria-labelledby="set-theme"
          items={[
            { value: "system", label: t.themeSystem },
            { value: "light", label: t.themeLight },
            { value: "dark", label: t.themeDark },
          ]}
          value={settings.theme}
          onValueChange={(v) => update({ theme: v === "light" || v === "dark" ? v : "system" })}
        />
      </Glass>

      <Glass className="card setting">
        <h2 className="setting-title" id="set-model">
          {t.setModel}
        </h2>
        <Segmented
          aria-labelledby="set-model"
          items={[
            { value: "standard", label: t.modelStandard },
            { value: "accurate", label: t.modelAccurate },
          ]}
          value={settings.model}
          onValueChange={(v) => update({ model: v === "accurate" ? "accurate" : "standard" })}
        />
        <p className="text-muted text-sm">
          {settings.model === "accurate" ? t.modelAccurateNote(size("accurate")) : t.modelStandardNote(size("standard"))}
        </p>
      </Glass>

      <Glass className="card setting">
        <h2 className="setting-title" id="set-strict">
          {t.setStrictness}
        </h2>
        <RangeSlider
          minLabel={t.lenient}
          maxLabel={t.strict}
          aria-labelledby="set-strict"
          aria-valuetext={formatPercent(settings.threshold, settings.lang)}
          min={0.5}
          max={0.95}
          step={0.05}
          value={settings.threshold}
          onValueChange={(v) => update({ threshold: Math.round(v * 100) / 100 })}
        />
        <p className="text-muted text-sm">
          {t.strictnessNote} <span className="tabular-nums">({formatPercent(settings.threshold, settings.lang)})</span>
        </p>
        {settings.threshold !== DEFAULT_THRESHOLD && (
          <div>
            <Button onClick={() => update({ threshold: DEFAULT_THRESHOLD })}>{t.resetDefault(formatPercent(DEFAULT_THRESHOLD, settings.lang))}</Button>
          </div>
        )}
      </Glass>

      <Glass className="card setting">
        <label className="switch-row justify-between">
          <span className="setting-title">{t.fromMemory}</span>
          <Toggle checked={settings.memorize} onCheckedChange={(memorize) => update({ memorize })} aria-label={t.fromMemory} />
        </label>
        <p className="text-muted text-sm">{t.fromMemoryHint}</p>
      </Glass>

      <Glass className="card setting">
        <h2 className="setting-title" id="set-engine">
          {t.setEngine}
        </h2>
        <Segmented
          aria-labelledby="set-engine"
          items={[
            { value: "auto", label: t.engineAuto },
            { value: "wasm", label: t.engineWasm },
          ]}
          value={settings.engine}
          onValueChange={(v) => update({ engine: v === "wasm" ? "wasm" : "auto" })}
        />
        <p className="text-muted text-sm">{t.engineNote}</p>
        {model.phase === "ready" && (
          <p className="text-sm">{t.engineInUse(model.backend === "webgpu" ? "WebGPU" : "WebAssembly", model.threads)}</p>
        )}
      </Glass>

      <Glass className="card setting">
        <h2 className="setting-title">{t.setStorage}</h2>
        <p className="text-muted text-sm">{t.storageNote}</p>
        <div className="flex items-center gap-3">
          <Button
            destructive
            icon={<TrashIcon size={18} />}
            onClick={async () => {
              resetModel();
              await deleteDownloads();
              setDeleted(true);
            }}
          >
            {t.deleteDownloads}
          </Button>
          {deleted && (
            <span className="text-sm" role="status">
              {t.deleted}
            </span>
          )}
        </div>
      </Glass>
    </div>
  );
}
