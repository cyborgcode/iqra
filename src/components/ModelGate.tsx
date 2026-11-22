import { Button } from "glisse";
import { downloadModel, prepareModel, useModelStatus } from "../state/model";
import { formatMegabytes, formatPercent } from "../lib/format";
import { useSettings } from "../state/settings";
import { DownloadIcon } from "./icons";

/** Shows the model's size before any download, the download progress, and load errors. */
export function ModelGate() {
  const { t, settings } = useSettings();
  const status = useModelStatus();

  if (status.phase === "ready") return null;

  if (status.phase === "needs-download") {
    return (
      <div className="model-gate">
        <p className="font-medium">{t.modelNeeded}</p>
        <p className="text-muted text-sm">{t.modelSizeNote}</p>
        <div>
          <Button variant="filled" icon={<DownloadIcon size={18} />} onClick={() => void downloadModel(settings.model, settings.engine)}>
            {t.modelSize(formatMegabytes(status.bytes, settings.lang))}
          </Button>
        </div>
      </div>
    );
  }

  if (status.phase === "downloading") {
    const fraction = status.total > 0 ? status.loaded / status.total : 0;
    return (
      <div className="model-gate">
        <p className="font-medium" id="model-progress-label">
          {t.modelDownloading}
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-labelledby="model-progress-label"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <div className="progress-fill" style={{ inlineSize: `${fraction * 100}%` }} />
        </div>
        <p className="text-muted text-sm tabular-nums">
          {formatPercent(fraction, settings.lang)} · {formatMegabytes(status.loaded, settings.lang)} / {formatMegabytes(status.total, settings.lang)}
        </p>
      </div>
    );
  }

  if (status.phase === "error") {
    return (
      <div className="model-gate" role="alert">
        <p className="font-medium">{t.modelFailed}</p>
        <p className="text-muted text-sm" dir="auto">
          {status.message}
        </p>
        <div>
          <Button onClick={() => void prepareModel(settings.model, settings.engine)}>{t.retry}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="model-gate" aria-busy="true">
      <p className="flex items-center gap-2 font-medium">
        <span className="spinner" aria-hidden="true" /> {t.modelLoading}
      </p>
    </div>
  );
}
