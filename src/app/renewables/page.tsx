import type { Metadata } from "next";
import { RenewableGuide } from "@/components/renewables/RenewableGuide";

export const metadata: Metadata = { title: "Renewable resources · Monifactory Expert" };

export default async function RenewablesPage({
  searchParams,
}: {
  searchParams: Promise<{ resource?: string; microverse?: string }>;
}) {
  const params = await searchParams;
  return (
    <RenewableGuide
      initialIncludeMicroverse={params.microverse !== "false"}
      initialResource={
        typeof params.resource === "string" ? params.resource : "fluid:minecraft:water"
      }
    />
  );
}
