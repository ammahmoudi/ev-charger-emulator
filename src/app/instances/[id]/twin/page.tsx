"use client";

import { useParams } from "next/navigation";

import { TwinView } from "@/components/twin/TwinView";

export default function InstanceTwinPage() {
  const params = useParams<{ id: string }>();
  return <TwinView instanceId={params.id} />;
}
