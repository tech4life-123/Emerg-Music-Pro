"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id?: string) => void } }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Cloudflare Turnstile. The widget adds a hidden `cf-turnstile-response` field to the enclosing form; the server action
 * forwards it to Supabase as the captcha token. With no site key configured (local dev) nothing is rendered.
 * `resetKey` changes after each submission because a token is single-use.
 */
export function Turnstile({ resetKey }: { resetKey: unknown }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!SITE_KEY) return;
    const mount = () => {
      if (!box.current || !window.turnstile || id.current) return;
      id.current = window.turnstile.render(box.current, { sitekey: SITE_KEY, theme: "dark" });
    };
    mount();
    window.addEventListener("turnstile-ready", mount);
    return () => {
      window.removeEventListener("turnstile-ready", mount);
      if (id.current) window.turnstile?.remove(id.current);
      id.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (id.current) window.turnstile?.reset(id.current);
  }, [resetKey]);

  if (!SITE_KEY) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => { window.dispatchEvent(new Event("turnstile-ready")); }} />
      <div ref={box} />
    </>
  );
}
