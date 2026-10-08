import { redirect } from "next/navigation";

/**
 * Appointments was a list of what the diary already shows, so it went from
 * the menu. Its address goes to the diary, for anyone with it bookmarked; a
 * client's bookings, and whether their confirmation text went, are on their
 * page under Clients.
 */
export default function AppointmentsPage() {
  redirect("/calendar");
}
