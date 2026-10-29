// Simple, consistent line icons per instrument family (24x24 grid).
export function InstrumentIcon({ icon, className = "w-6 h-6" }: { icon: string; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (icon) {
    case "sax":
      return (
        <svg viewBox="0 0 24 24" className={className} {...common}>
          <path d="M16 3l2 2-7.5 7.5V17a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2v-1.5c0-1.5 1-2.5 2.5-2.5H9" />
          <circle cx="5.5" cy="17.5" r="1" /><path d="M11 9.5l1 1M12.5 8l1 1M14 6.5l1 1" />
        </svg>
      );
    case "clarinet":
    case "oboe":
      return (
        <svg viewBox="0 0 24 24" className={className} {...common}>
          <path d="M12 2v3M10 5h4l-1 14h-2L10 5zM10 19h4l1 2H9l1-2z" /><path d="M12 8v.5M12 10.5v.5M12 13v.5" />
        </svg>
      );
    case "flute":
      return (
        <svg viewBox="0 0 24 24" className={className} {...common}>
          <path d="M3 14l14-9 3 2-14 9-3-2z" /><path d="M8 13.5l.5.8M10.5 12l.5.8M13 10.5l.5.8M15.5 9l.5.8" />
        </svg>
      );
    case "recorder":
      return (
        <svg viewBox="0 0 24 24" className={className} {...common}>
          <path d="M12 2h-1l-1.5 4v13l1.5 3h2l1.5-3V6L13 2h-1z" /><path d="M12 9v.3M12 12v.3M12 15v.3" />
        </svg>
      );
    case "trumpet":
      return (
        <svg viewBox="0 0 24 24" className={className} {...common}>
          <path d="M3 12h11l5-4v8l-5-4" /><path d="M8 12v3M10.5 12v3M13 12v3M8 15h5" /><path d="M3 10.5v3" />
        </svg>
      );
    case "horn":
      return (
        <svg viewBox="0 0 24 24" className={className} {...common}>
          <circle cx="12" cy="13" r="6" /><path d="M12 7V3M9 3h6M12 13l5-2" />
        </svg>
      );
    case "violin":
      return (
        <svg viewBox="0 0 24 24" className={className} {...common}>
          <path d="M12 9c-2.5 0-3.5 1.5-3.5 3 0 1-1 1.5-1 3 0 2.5 2 4 4.5 4s4.5-1.5 4.5-4c0-1.5-1-2-1-3 0-1.5-1-3-3.5-3z" /><path d="M12 9V3M10.5 4h3" />
        </svg>
      );
    case "piano":
      return (
        <svg viewBox="0 0 24 24" className={className} {...common}>
          <rect x="3" y="6" width="18" height="12" rx="1.5" /><path d="M8 6v8M12 6v8M16 6v8M3 14h18" />
        </svg>
      );
    case "voice":
      return (
        <svg viewBox="0 0 24 24" className={className} {...common}>
          <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className={className} {...common}>
          <path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" />
        </svg>
      );
  }
}
