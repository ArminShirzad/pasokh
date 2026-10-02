import { redirect } from "next/navigation";

// A Pasokh instance is an app, not a marketing site: the root goes straight to
// the dashboard, and the auth proxy sends signed-out visitors on to /login.
export default function Home() {
  redirect("/dashboard");
}
