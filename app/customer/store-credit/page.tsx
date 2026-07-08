import { Suspense } from "react";
import StoreCreditClient from "./StoreCreditClient";

export const dynamic = "force-dynamic";

export default function CustomerStoreCreditPage() {
  return (
    <Suspense fallback={<div>Loading store credit...</div>}>
      <StoreCreditClient />
    </Suspense>
  );
}
