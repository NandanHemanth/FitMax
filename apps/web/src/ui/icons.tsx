/** Minimal stroke icon set (24px grid), drawn for FitMax. */
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const I = (children: ReactNode) =>
  function Icon({ size = 20, ...rest }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
        {children}
      </svg>
    );
  };

export const IconHome = I(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>);
export const IconDumbbell = I(<><path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" /></>);
export const IconApple = I(<><path d="M12 7c-1-2-3-3-5-2-3 1-3 6-1 10 1 2 2.5 4 4 4 1 0 1.3-.6 2-.6s1 .6 2 .6c1.5 0 3-2 4-4 2-4 2-9-1-10-2-1-4 0-5 2z" /><path d="M12 7c0-2 1-4 3-4" /></>);
export const IconMap = I(<><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></>);
export const IconUser = I(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>);
export const IconSun = I(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = I(<path d="M20 15A8 8 0 019 4a8 8 0 1011 11z" />);
export const IconFlame = I(<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7z" />);
export const IconHeart = I(<path d="M12 20s-7-4.5-9-9c-1.3-3 .6-7 4.5-7 2 0 3.5 1.2 4.5 2.7C13 5.2 14.5 4 16.5 4 20.4 4 22.3 8 21 11c-2 4.5-9 9-9 9z" />);
export const IconSteps = I(<><path d="M8 3c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM6 17h4v2a2 2 0 01-4 0zM16 8c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5z" /></>);
export const IconMoonSleep = IconMoon;
export const IconTarget = I(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>);
export const IconBook = I(<><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z" /><path d="M4 19V5" /></>);
export const IconPlay = I(<path d="M8 5l11 7-11 7z" fill="currentColor" />);
export const IconCamera = I(<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>);
export const IconBarcode = I(<path d="M4 6v12M7 6v12M10 6v12M14 6v12M16 6v12M20 6v12" />);
export const IconFridge = I(<><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M6 10h12M9 6v2M9 13v3" /></>);
export const IconCart = I(<><path d="M3 4h2l2.5 11h11L21 7H6" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></>);
export const IconSearch = I(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>);
export const IconPlus = I(<path d="M12 5v14M5 12h14" />);
export const IconX = I(<path d="M6 6l12 12M18 6L6 18" />);
export const IconCheck = I(<path d="M5 12l5 5 9-10" />);
export const IconTrophy = I(<><path d="M8 4h8v5a4 4 0 01-8 0z" /><path d="M8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 21h8M9 17h6v4H9z" /></>);
export const IconBolt = I(<path d="M13 2L4 14h7l-1 8 9-12h-7z" />);
export const IconTrend = I(<><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>);
export const IconBike = I(<><circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16l4-8h5l3 8M9 8h3M12 16l3-8" /></>);
export const IconRun = I(<><circle cx="14" cy="4" r="2" /><path d="M6 20l3-6 3 2v5M9 14l2-6 4 2 3 3M11 8l-4 1-2 3" /></>);
export const IconLeaf = I(<><path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15" /><path d="M5 19l8-8" /></>);
export const IconLogout = I(<><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></>);
export const IconSparkle = I(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />);
export const IconShield = I(<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />);
export const IconCube = I(<><path d="M12 2l9 5v10l-9 5-9-5V7z" /><path d="M12 12l9-5M12 12v10M12 12L3 7" /></>);
export const IconPulse = I(<path d="M3 12h4l2-5 4 10 2-5h6" />);
export const IconAlert = I(<><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5v.5" /></>);
export const IconWifi = I(<><path d="M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0" /><circle cx="12" cy="19" r="1" /></>);
