import { redirect } from "next/navigation";

/**
 * The CRM's front door is the login page, signed in or not. Signing in goes on
 * to /start, which opens the organisation's start page.
 */
export default function Home() {
  redirect("/login");
}
