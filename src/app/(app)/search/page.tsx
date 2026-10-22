import type { Metadata } from "next";
import { EmptyState } from "@/components/states/States";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <>
      <h1>Search</h1>
      <EmptyState title="Search is not built yet">
        Search arrives with the catalog phase. There is no search box here on purpose, so nothing on this page pretends to work.
      </EmptyState>
    </>
  );
}
