import { redirect } from "next/navigation";

/** The instance list now lives at the app's root as the multi-device dashboard; keep this path working for existing links. */
export default function InstancesRedirect() {
  redirect("/");
}
