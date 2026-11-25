/**
 * Whether a booking or block is this technician's: by id where both have one
 * (src/lib/technicians.ts), so a technician who took the name of someone who
 * left is not shown her bookings; by name otherwise. Safe in the browser.
 */
export function isTechnicians(
  row: { stylistName: string | null; technicianId?: string | null },
  who: { name: string; id?: string | null }
): boolean {
  if (row.technicianId && who.id) return row.technicianId === who.id;
  return (row.stylistName ?? "").toLowerCase() === who.name.toLowerCase();
}

/** A block keeping this technician out: one for the whole salon, or hers. */
export function blocksTechnician(
  block: { stylistName: string | null; technicianId?: string | null },
  who: { name: string; id?: string | null }
): boolean {
  return block.stylistName === null || isTechnicians(block, who);
}
