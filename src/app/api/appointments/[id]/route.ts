/**
 * Change a booking at the desk: move it, change what it is for, or fix who it
 * is for. The booking keeps its number.
 *
 * What may change depends on where the booking is in its life:
 *   - upcoming and booked: everything;
 *   - done, no-show, or in the past: services, notes and client only. The
 *     takings may need correcting after the fact; when it happened may not;
 *   - cancelled: nothing. It is a record of a cancellation.
 *
 * A move goes through `moveAppointment`, the same step the phone agent moves
 * bookings with, with overlap allowed: the desk can see the diary, so a move
 * onto another booking or into blocked time is its call, as a new booking is.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { textRecipient } from "@/lib/client-link";
import type { Prisma } from "@/generated/prisma/client";
import {
  canWriteColumn,
  notYourColumn,
  requireTenant,
  isErrorResponse,
} from "@/lib/tenant";
import { getBookingProvider, getSalonConfig } from "@/lib/booking";
import { canCreateBooking } from "@/lib/booking/types";
import { moveAppointment } from "@/lib/booking/diary";
import { matchStylist, servicesPicked } from "@/lib/salon-config";
import { describeAppointmentWhen } from "@/lib/business-hours";
import { rescheduleBody, sendSms } from "@/lib/sms";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req, { stylists: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) ?? {};

    const appt = await prisma.appointment.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: { lead: true },
    });
    if (!appt) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canWriteColumn(ctx, appt.stylistName)) return notYourColumn();
    if (appt.status === "cancelled") {
      return NextResponse.json(
        { error: "A cancelled booking can't be changed. Book a new one instead." },
        { status: 409 }
      );
    }

    const cfg = await getSalonConfig(ctx.organizationId);
    const upcoming = appt.status === "booked" && appt.startsAt >= new Date();

    // --- Where and when ----------------------------------------------------
    let startsAt = appt.startsAt;
    if (body.startsAt !== undefined) {
      startsAt = new Date(body.startsAt);
      if (Number.isNaN(startsAt.getTime())) {
        return NextResponse.json({ error: "startsAt is not a date" }, { status: 400 });
      }
    }

    let stylistName = appt.stylistName;
    if (body.stylistName !== undefined) {
      const stylist = matchStylist(String(body.stylistName), cfg.stylists);
      if (!stylist) {
        return NextResponse.json(
          { error: `No stylist matching "${body.stylistName}"` },
          { status: 400 }
        );
      }
      stylistName = stylist.name;
      if (!canWriteColumn(ctx, stylistName)) return notYourColumn();
    }

    // --- What --------------------------------------------------------------
    const data: Prisma.AppointmentUncheckedUpdateInput = {};
    let durationMinutes = appt.durationMinutes;
    let serviceText = appt.serviceText;

    if (Array.isArray(body.serviceNames)) {
      const picked = servicesPicked(body.serviceNames.map(String), cfg.services);
      if (!picked.ok) {
        return NextResponse.json(
          {
            error: picked.missing
              ? `"${picked.missing}" is not on the service list.`
              : "Choose at least one service.",
          },
          { status: 400 }
        );
      }
      serviceText = picked.service.name;
      data.serviceText = serviceText;
      data.patchTestRequired =
        picked.service.requiresPatchTest && appt.clientType !== "returning";
      // A new set of services brings its own length, unless one is given.
      if (upcoming) durationMinutes = picked.service.durationMinutes;
    }
    if (body.durationMinutes !== undefined) {
      const n = Math.round(Number(body.durationMinutes));
      if (!(n > 0 && n <= 12 * 60)) {
        return NextResponse.json(
          { error: "The length must be between 1 minute and 12 hours." },
          { status: 400 }
        );
      }
      durationMinutes = n;
    }

    // --- Who ---------------------------------------------------------------
    let lead = appt.lead;
    if (body.leadId !== undefined && body.leadId !== appt.leadId) {
      const other = await prisma.lead.findFirst({
        where: { id: String(body.leadId), organizationId: ctx.organizationId },
      });
      if (!other) {
        return NextResponse.json({ error: "That client was not found." }, { status: 404 });
      }
      data.leadId = other.id;
      lead = other;
    }

    // --- Notes -------------------------------------------------------------
    let notes: string | null = appt.notes;
    if (body.notes !== undefined) {
      notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
      data.notes = notes;
    }

    const timeChanged = startsAt.getTime() !== appt.startsAt.getTime();
    const stylistChanged = stylistName !== appt.stylistName;
    const lengthChanged = durationMinutes !== appt.durationMinutes;
    const moved = timeChanged || stylistChanged || lengthChanged;

    if (moved && !upcoming) {
      return NextResponse.json(
        {
          error:
            "Only upcoming bookings can be moved. You can still change the services, notes and client.",
        },
        { status: 409 }
      );
    }

    let updatedStartsAt = appt.startsAt;
    if (moved) {
      const provider = await getBookingProvider(ctx.organizationId);
      if (!canCreateBooking(provider)) {
        return NextResponse.json(
          { error: "This organisation is not set up to take bookings yet." },
          { status: 409 }
        );
      }

      const previousWhenText = describeAppointmentWhen(appt.startsAt, cfg.timeZone);
      if (timeChanged || stylistChanged) {
        const line =
          `Moved from ${previousWhenText}` +
          (stylistChanged ? ` with ${appt.stylistName}` : "") +
          " at the desk";
        data.notes = [notes, line].filter(Boolean).join("\n");
      }
      if (timeChanged) {
        // A reminder for the old date must not go out for the new one.
        data.reminderSentAt = null;
        data.reminderError = null;
      }

      const result = await moveAppointment(
        provider,
        { ...appt, lead },
        {
          startsAt,
          durationMinutes,
          stylistName,
          serviceName: serviceText,
          allowOverlap: true,
        },
        data
      );
      if (!result.ok) {
        return NextResponse.json(
          { error: `Could not move it: ${result.reason}` },
          { status: result.conflict ? 409 : 502 }
        );
      }
      updatedStartsAt = result.appointment.startsAt;
    } else if (Object.keys(data).length > 0) {
      await prisma.appointment.update({ where: { id }, data });
    }

    // --- Tell the client ---------------------------------------------------
    let textSent = false;
    let textError: string | null = null;
    const notify = body.notifyClient === true && (timeChanged || stylistChanged);
    // Their own number, or the one they are reached through (a child on a
    // parent's phone), whose owner the text then greets.
    const recipient = notify
      ? textRecipient(
          (await prisma.lead.findUnique({
            where: { id: lead.id },
            include: { contactLead: { select: { name: true, phone: true } } },
          })) ?? lead
        )
      : null;
    if (recipient) {
      const settings = await prisma.organizationSettings.findUnique({
        where: { organizationId: ctx.organizationId },
        select: { businessName: true, contactPhone: true },
      });
      const sms = await sendSms(
        ctx.organizationId,
        recipient.to,
        rescheduleBody({
          clientName: recipient.greet,
          forName: recipient.forName,
          serviceName: serviceText,
          stylistName,
          whenText: describeAppointmentWhen(updatedStartsAt, cfg.timeZone),
          previousWhenText: describeAppointmentWhen(appt.startsAt, cfg.timeZone),
          businessName: settings?.businessName ?? "the salon",
          contactPhone: settings?.contactPhone ?? null,
          bookingNumber: appt.bookingNumber,
        })
      );
      textSent = sms.ok;
      textError = sms.ok ? null : sms.reason;
      await prisma.appointment.update({
        where: { id },
        data: sms.ok
          ? { confirmationSentAt: new Date(), confirmationError: null }
          : { confirmationError: sms.reason },
      });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: { lead: true },
    });
    return NextResponse.json({ appointment, textSent, textError });
  } catch (error) {
    console.error("[APPOINTMENTS API] PATCH [id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
