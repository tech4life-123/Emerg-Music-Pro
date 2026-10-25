import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { AccountIcon, HomeIcon, LibraryIcon, SearchIcon, StudioIcon } from "@/components/icons";
import { PlayerProvider } from "@/components/player/PlayerProvider";
import { NavLinks, type NavItem } from "./NavLinks";

const primary: NavItem[] = [
  { href: "/", label: "Home", icon: <HomeIcon /> },
  { href: "/search", label: "Search", icon: <SearchIcon /> },
  { href: "/library", label: "Library", icon: <LibraryIcon /> },
  { href: "/studio", label: "Studio", icon: <StudioIcon /> },
  { href: "/account", label: "Account", icon: <AccountIcon /> },
];

function Brand({ size = 36 }: { size?: number }) {
  return (
    <Link href="/" className="brand" aria-label="Emerg Music home">
      <Image src="/icons/icon-192.png" alt="" width={size} height={size} priority />
      <span>Emerg Music</span>
    </Link>
  );
}

/**
 * Responsive shell: sidebar on desktop, bottom navigation on mobile. The listener app never links to the admin area:
 * administrators open /admin directly (it answers 404 to everyone else). Access is enforced on the server and by
 * database policies, never by showing or hiding links.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <PlayerProvider>
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand size={40} />
        <div>
          <div className="nav-heading">Listen</div>
          <NavLinks items={primary.slice(0, 3)} label="Primary" />
        </div>
        <div>
          <div className="nav-heading">You</div>
          <NavLinks items={[primary[3]!, primary[4]!]} label="Secondary" />
        </div>
      </aside>
      <div>
        <div className="main" id="main" tabIndex={-1}>
          <div className="topbar topbar-brand">
            <Brand />
          </div>
          {children}
        </div>
      </div>
      <div className="bottom-nav">
        <NavLinks items={primary} label="Main" />
      </div>
    </div>
    </PlayerProvider>
  );
}
