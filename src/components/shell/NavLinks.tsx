"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

export function NavLinks({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      {items.map((it) => {
        const active = it.href === "/" ? pathname === "/" : pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link key={it.href} href={it.href} className="nav-link" aria-current={active ? "page" : undefined}>
            {it.icon}
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
