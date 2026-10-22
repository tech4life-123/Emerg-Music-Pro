"use client";

import { ErrorState } from "@/components/states/States";

export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // The error message is deliberately not rendered: it may contain internal detail.
  return <ErrorState onRetry={reset} />;
}
