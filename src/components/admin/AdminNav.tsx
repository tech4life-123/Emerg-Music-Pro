"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [["/admin", "Overview"], ["/admin/applications", "Applications"], ["/admin/reviews", "Review queue"], ["/admin/releases", "Releases"], ["/admin/reports", "Copyright reports"], ["/admin/audit", "Audit log"]] as const;

export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Admin sections" className="subnav">
      {LINKS.map(([href, label]) => {
        const active = href === "/admin" ? path === href : path.startsWith(href);
        return <Link key={href} href={href} aria-current={active ? "page" : undefined}>{label}</Link>;
      })}
    </nav>
  );
}
