import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { getBookingProvider, getSalonConfig } from "@/lib/booking";
import { canCreateBooking } from "@/lib/booking/types";
import {
  combineServices,
  matchService,
  matchStylist,
  type SalonService,
} from "@/lib/salon-config";
import { createNumberedAppointment } from "@/lib/booking-number";
import { normalisePhone } from "@/lib/phone";

const VALID_STATUSES = ["booked", "cancelled", "completed", "no_show"];

/**
 * Appointments the agent has booked.
 *
 * The diary itself lives in the provider (Google Calendar). This is our own
 * record of what was booked, so the dashboard can show overnight bookings
 * without calling Google on every page load, and so the salon still has a
 * record if an event is later edited or deleted there.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "booked";
    const scope = searchParams.get("scope") || "upcoming";

    const where: Record<string, unknown> = {
      organizationId: ctx.organizationId,
    };
    if (status !== "all") where.status = status;

    // An explicit window wins over the scope shortcut: the day view asks for
    // one day and wants everything in it, including what has already been and
    // gone this morning.
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) {
        const d = new Date(from);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: "from is not a date" }, { status: 400 });
        }
        range.gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: "to is not a date" }, { status: 400 });
        }
        range.lt = d;
      }
      where.startsAt = range;
    } else if (scope === "upcoming") {
      // Default to what still matters: appointments yet to happen. A salon
      // opening at nine wants this morning's bookings, not last month's.
      where.startsAt = { gte: new Date() };
    } else if (scope === "past") {
      where.startsAt = { lt: new Date() };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: { lead: true },
      orderBy: { startsAt: scope === "past" ? "desc" : "asc" },
      take: 200,
    });

    return NextResponse.json({ appointments });
  } catch (error) {
    console.error("[APPOINTMENTS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const body = await req.json();
    const { id, status, notes, amountMinor } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    // Verify ownership before touching anything.
    const existing = await prisma.appointment.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!existing || existing.organizationId !== ctx.organizationId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (notes !== undefined) data.notes = notes;

    // What was taken, in pence. Explicit null clears it — someone correcting
    // a mistyped figure has to be able to empty the field, and an empty
    // field is not the same fact as zero pounds.
    if (amountMinor !== undefined) {
      if (amountMinor === null) {
        data.amountMinor = null;
      } else {
        const n = Number(amountMinor);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json(
            { error: "amountMinor must be a non-negative number of pence" },
            { status: 400 }
          );
        }
        data.amountMinor = Math.round(n);
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "at least one of status, notes, amountMinor is required" },
        { status: 400 }
      );
    }

    const appointment = await prisma.appointment.update({ where: { id }, data });

    // Deliberately does NOT remove the event from the stylist's calendar.
    // Google is the diary and staff work in it directly; a dashboard status
    // change silently deleting an event out from under them would be worse
    // than the two records disagreeing. Cancelling in Google is the real
    // cancellation — this flag is our record of it.
    return NextResponse.json({ appointment });
  } catch (error) {
    console.error("[APPOINTMENTS API] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Create a booking from the diary screen.
 *
 * Writes to the stylist's Google Calendar first, then records it here — the
 * same order and the same provider the voice agent uses. That order is not
 * incidental: availability is read from Google's freebusy, so a booking that
 * existed only in this database would be invisible to `check_availability`
 * and the agent would cheerfully offer the slot to the next caller. A desk
 * booking has to occupy the diary exactly as a phone booking does.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const body = await req.json();
    const {
      startsAt,
      stylistName,
      serviceText,
      serviceNames,
      leadId,
      clientName,
      clientPhone,
      durationMinutes: durationOverride,
      clientType = "unknown",
      notes,
    } = body ?? {};

    const pickedNames: string[] = Array.isArray(serviceNames)
      ? serviceNames.filter(
          (n: unknown): n is string => typeof n === "string" && n.trim() !== ""
        )
      : [];

    if (!startsAt || !stylistName || (!serviceText && pickedNames.length === 0)) {
      return NextResponse.json(
        { error: "startsAt, stylistName and a service are required" },
        { status: 400 }
      );
    }

    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) {
      return NextResponse.json({ error: "startsAt is not a date" }, { status: 400 });
    }

    const cfg = await getSalonConfig(ctx.organizationId);

    const stylist = matchStylist(stylistName, cfg.stylists);
    if (!stylist) {
      return NextResponse.json(
        { error: `No stylist matching "${stylistName}"` },
        { status: 400 }
      );
    }

    // Duration comes from the service catalogue, as it does on the phone, so
    // a desk booking blocks the same amount of chair time. An override is
    // allowed because the person at the desk can see the client's hair and
    // the catalogue cannot.
    //
    // The desk picks services from the catalogue by name, so each one must be
    // there exactly: fuzzy matching is for what a caller says, not for a value
    // chosen from a list, where a near miss means the list and the catalogue
    // have drifted and guessing would book the wrong length.
    let service: SalonService | null;
    if (pickedNames.length > 0) {
      const parts: SalonService[] = [];
      for (const name of pickedNames) {
        const found = cfg.services.find(
          (s) => s.name.toLowerCase() === name.trim().toLowerCase()
        );
        if (!found) {
          return NextResponse.json(
            { error: `"${name}" is not on the service list.` },
            { status: 400 }
          );
        }
        parts.push(found);
      }
      service = combineServices(parts);
    } else {
      service = matchService(serviceText, cfg.services);
    }
    const durationMinutes =
      Number(durationOverride) > 0
        ? Math.round(Number(durationOverride))
        : service?.durationMinutes;

    if (!durationMinutes) {
      return NextResponse.json(
        { error: `Unknown service "${serviceText}" and no durationMinutes given` },
        { status: 400 }
      );
    }

    // A client picked from the client list arrives by id. The legacy fields
    // below (name and number typed into the booking form) are kept for the
    // walk-in with no details and for any older caller of this endpoint.
    let lead;
    let phone: string | null = null;
    if (leadId) {
      lead = await prisma.lead.findFirst({
        where: { id: String(leadId), organizationId: ctx.organizationId },
      });
      if (!lead) {
        return NextResponse.json(
          { error: "That client was not found." },
          { status: 404 }
        );
      }
      phone = lead.phone;
    } else {
      // A number that will not parse is sent back rather than quietly dropped:
      // the desk can retype it, and a booking with a mangled number is worse
      // than one with none, because nobody can ring the client about it.
      if (clientPhone) {
        const parsed = normalisePhone(String(clientPhone));
        if (!parsed.ok) {
          return NextResponse.json(
            { error: `That number does not look right: ${parsed.reason}` },
            { status: 400 }
          );
        }
        phone = parsed.e164;
      }

      // A walk-in may give no number at all, and `Lead.phone` is nullable for
      // exactly that reason. Only the keyed upsert needs a number.
      lead = phone
        ? await prisma.lead.upsert({
            where: {
              organizationId_phone: { organizationId: ctx.organizationId, phone },
            },
            update: { ...(clientName && { name: clientName }) },
            create: {
              organizationId: ctx.organizationId,
              phone,
              name: clientName || null,
              source: "manual",
            },
          })
        : await prisma.lead.create({
            data: {
              organizationId: ctx.organizationId,
              name: clientName || null,
              source: "manual",
            },
          });
    }

    const provider = await getBookingProvider(ctx.organizationId);
    if (!canCreateBooking(provider)) {
      // Half-configured salon: no Google credentials, no stylist calendars,
      // or no service durations. Saying so beats writing a record of a
      // booking that no diary anywhere is holding.
      return NextResponse.json(
        { error: "This organisation is not set up to take bookings yet." },
        { status: 409 }
      );
    }

    const written = await provider.createBooking({
      organizationId: ctx.organizationId,
      startsAt: start.toISOString(),
      durationMinutes,
      serviceName: service?.name ?? String(serviceText),
      stylistName: stylist.name,
      clientName: lead.name || "Walk-in",
      clientPhone: phone ?? "",
      clientEmail: lead.email,
      notes,
      leadId: lead.id,
      // A booking taken at the desk is never refused for clashing. The salon
      // can see the diary in front of them; overbooking is their call to make.
      allowOverlap: true,
    });

    if (!written.ok) {
      // Say so rather than recording a booking the diary does not have.
      // Clashes no longer reach here (allowOverlap), so anything left is a
      // real failure to write — say so rather than recording a booking the
      // diary is not holding.
      return NextResponse.json(
        { error: `Could not write to the diary: ${written.reason}` },
        { status: 502 }
      );
    }

    const appointment = await createNumberedAppointment({
      organizationId: ctx.organizationId,
      leadId: lead.id,
      serviceText: service?.name ?? String(serviceText),
      durationMinutes,
      stylistName: stylist.name,
      startsAt: new Date(written.startsAt),
      endsAt: new Date(written.endsAt),
      googleEventId: written.ref,
      googleCalendarId: written.calendarId ?? null,
      clientType: String(clientType),
      patchTestRequired:
        Boolean(service?.requiresPatchTest) && clientType !== "returning",
      notes: notes || null,
      source: "manual",
    });

    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    console.error("[APPOINTMENTS API] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
