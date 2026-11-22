import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button, Glass } from "glisse";
import { useSettings } from "../state/settings";
import { CrossIcon } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A modal sheet built on <dialog>: focus moves into it and back, Escape closes it, and the rest of
 * the page is inert while it is open. It rises from the bottom on phones and is centred on wide screens.
 */
export function Sheet({ open, onClose, title, children, className = "" }: Props) {
  const { t } = useSettings();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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
      {open && (
        <Glass className="sheet-panel">
          <div className="sheet-head">
            <h2 id={titleId} className="sheet-title">
              {title}
            </h2>
            <Button aria-label={t.close} icon={<CrossIcon size={18} />} onClick={onClose} />
          </div>
          <div className="sheet-body">{children}</div>
        </Glass>
      )}
    </dialog>
  );
}
