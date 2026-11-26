import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
});

export const CheckIcon = ({ size = 16, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
  </svg>
);

export const CopyIcon = ({ size = 16, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="3" />
    <path d="M15.5 8.5V7a2.5 2.5 0 0 0-2.5-2.5H7A2.5 2.5 0 0 0 4.5 7v6A2.5 2.5 0 0 0 7 15.5h1.5" />
  </svg>
);

export const ExternalIcon = ({ size = 16, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M14 5h5v5M19 5l-8 8M17 14v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 17.5v-9A1.5 1.5 0 0 1 6.5 7H10" />
  </svg>
);

export const ChevronIcon = ({ size = 16, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M6 9.5l6 5 6-5" vectorEffect="non-scaling-stroke" />
  </svg>
);

export const ShieldCheckIcon = ({ size = 16, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 3.5l7 3v5c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9v-5l7-3z" />
    <path d="M8.8 12.2l2.2 2.2 4.2-4.6" />
  </svg>
);

export const SunIcon = ({ size = 18, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </svg>
);

export const MoonIcon = ({ size = 18, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />
  </svg>
);

export const ArrowUpIcon = ({ size = 16, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

/** The user's turn: a ring that pulses outward from a dot. */
export const RingGlyph = () => (
  <svg className="kb-glyph-ring" width="20" height="20" viewBox="0 0 20 20" aria-hidden focusable={false}>
    <circle className="pulse" cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="10" cy="10" r="3.5" fill="currentColor" />
  </svg>
);

/** The chain's turn: an arc turning calmly. */
export const ArcGlyph = () => (
  <svg className="kb-glyph-arc" width="20" height="20" viewBox="0 0 20 20" aria-hidden focusable={false}>
    <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
    <path d="M10 2a8 8 0 0 1 8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** The Kickback mark: a coin going out and coming back. */
export const KickbackMark = () => (
  <span className="kb-mark" aria-hidden>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 12.5V3.5M4 8.5l5-5M6.5 6.5l5 6" />
    </svg>
  </span>
);

export const LockIcon = ({ size = 14, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);

export const FileIcon = ({ size = 20, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M14 3.5H8A2.5 2.5 0 0 0 5.5 6v12A2.5 2.5 0 0 0 8 20.5h8a2.5 2.5 0 0 0 2.5-2.5V8L14 3.5z" />
    <path d="M14 3.5V8h4.5" />
  </svg>
);

export const DownloadIcon = ({ size = 16, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 4.5v11M7 11l5 5 5-5M5 19.5h14" />
  </svg>
);

const mark = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true,
  focusable: false,
});

/** The X (Twitter) mark. */
export const XIcon = ({ size = 15, ...props }: IconProps) => (
  <svg {...mark(size)} {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

/** The LinkedIn mark. */
export const LinkedInIcon = ({ size = 15, ...props }: IconProps) => (
  <svg {...mark(size)} {...props}>
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);

/** The Telegram mark. */
export const TelegramIcon = ({ size = 16, ...props }: IconProps) => (
  <svg {...mark(size)} {...props}>
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);
