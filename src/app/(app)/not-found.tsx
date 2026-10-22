import Link from "next/link";
import { EmptyState } from "@/components/states/States";

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      action={
        <Link className="btn" href="/">
          Back to Home
        </Link>
      }
    >
      That page does not exist, or you do not have access to it.
    </EmptyState>
  );
}
