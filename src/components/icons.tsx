// Simple line icons drawn for iqra (24×24, currentColor). Decorative unless given a label.
import { useId, type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </Icon>
);

export const StopIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
  </Icon>
);

export const BookIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5Z" />
    <path d="M12 6.5v13" />
  </Icon>
);

/** A cog with eight teeth (outer radius 9.4, roots 7.1) around its hub. */
export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.28 5.11L10.37 2.74A9.4 9.4 0 0 1 13.63 2.74L13.72 5.11A7.1 7.1 0 0 1 15.66 5.91L17.39 4.3A9.4 9.4 0 0 1 19.7 6.61L18.09 8.34A7.1 7.1 0 0 1 18.89 10.28L21.26 10.37A9.4 9.4 0 0 1 21.26 13.63L18.89 13.72A7.1 7.1 0 0 1 18.09 15.66L19.7 17.39A9.4 9.4 0 0 1 17.39 19.7L15.66 18.09A7.1 7.1 0 0 1 13.72 18.89L13.63 21.26A9.4 9.4 0 0 1 10.37 21.26L10.28 18.89A7.1 7.1 0 0 1 8.34 18.09L6.61 19.7A9.4 9.4 0 0 1 4.3 17.39L5.91 15.66A7.1 7.1 0 0 1 5.11 13.72L2.74 13.63A9.4 9.4 0 0 1 2.74 10.37L5.11 10.28A7.1 7.1 0 0 1 5.91 8.34L4.3 6.61A9.4 9.4 0 0 1 6.61 4.3L8.34 5.91A7.1 7.1 0 0 1 10.28 5.11Z" />
    <circle cx="12" cy="12" r="2.9" />
  </Icon>
);

export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.1" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const CrossIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Icon>
);

export const RepeatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" />
  </Icon>
);

export const SkipIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" strokeDasharray="3 2.6" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
  </Icon>
);

/** A phone receiving the app. */
export const InstallIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6.5" y="2.8" width="11" height="18.4" rx="2.6" />
    <path d="M12 6.8v7M9 10.9l3 3 3-3M10.6 17.9h2.8" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />
  </Icon>
);

export const DeviceIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16.5V20" />
  </Icon>
);

export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
  </Icon>
);

export const ArrowIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

/**
 * iqra's mark: a white open Mushaf on a rounded tile in the theme's colour (bleu ciel by default), in
 * every theme. Drawn for iqra; src/lib/logo.ts draws the same mark as a string for the favicon.
 */
export function AppMark({ size = 32, ...rest }: IconProps) {
  const id = useId();
  const gradient = `url(#${CSS.escape(id)})`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" {...rest}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--logo-a)" />
          <stop offset="1" stopColor="var(--logo-b)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={gradient} />
      <g transform="translate(32 32) scale(1.2) translate(-32 -40.1)">
        <path d="M32 31.5c-5.6-4.4-13.6-5.2-20-3.6v22.2c6.4-1.6 14.4-.8 20 3.6 5.6-4.4 13.6-5.2 20-3.6V27.9c-6.4-1.6-14.4-.8-20 3.6Z" fill="#fff" />
      </g>
    </svg>
  );
}

/** Points to the reading-start side of a left-to-right line; mirror it for the other direction. */
export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
  </Icon>
);

export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.75" cy="6.5" r="0.9" fill="currentColor" />
    <circle cx="4.75" cy="12" r="0.9" fill="currentColor" />
    <circle cx="4.75" cy="17.5" r="0.9" fill="currentColor" />
  </Icon>
);

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.5 7.2C3.9 8.9 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.6 4.6-1.4" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M4 4l16 16" />
  </Icon>
);

/** A light bulb: a hint (in reciting from memory, the next word shown). */
export const HintIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.5 14.5A6.1 6.1 0 1 1 15.5 14.5C14.7 15.2 14.3 16.1 14.3 17.3H9.7C9.7 16.1 9.3 15.2 8.5 14.5Z" />
    <path d="M9.9 20.1h4.2" />
  </Icon>
);

export const TargetIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </Icon>
);

export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </Icon>
);
