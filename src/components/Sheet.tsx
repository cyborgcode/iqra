import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "glisse";
import { useSettings } from "../state/settings";
import { CrossIcon } from "./icons";
import { Surface } from "./Surface";

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A little longer than the sheet's exit transition. */
const CLOSE_MS = 300;

/**
 * A modal sheet built on <dialog>: focus moves into it and back, Escape closes it, and the rest of
 * the page is inert while it is open. It rises from the bottom on phones and is centred on wide screens.
 */
export function Sheet({ open, onClose, title, children, className = "" }: Props) {
  const { t } = useSettings();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The contents stay while the sheet slides away (index.css), then go.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setShown(false), CLOSE_MS);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`sheet ${className}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === ref.current) onClose();
      }}
    >
      {shown && (
        <Surface className="sheet-panel">
          <div className="sheet-head">
            <h2 id={titleId} className="sheet-title">
              {title}
            </h2>
            <Button aria-label={t.close} icon={<CrossIcon size={18} />} onClick={onClose} />
          </div>
          <div className="sheet-body">{children}</div>
        </Surface>
      )}
    </dialog>
  );
}
