"use client";

/**
 * A photo a client sent, full size, over whatever page it was tapped on:
 * the conversation, the quote panel, a booking. With several, arrows (and
 * the keyboard's left and right) step through them.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import type React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { withAsOrg } from "@/lib/api-fetch";
import { useT } from "@/components/providers/language-provider";

export function PhotoViewer({
  photoIds,
  index,
  onIndex,
  onClose,
  title,
}: {
  /** /api/chat-photos ids. */
  photoIds: string[];
  /** Which is open; null when none is. */
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** Read out for the photo, e.g. "Photo from Jane". */
  title: string;
}) {
  const { t } = useT();
  const open = index !== null && index >= 0 && index < photoIds.length;
  const many = photoIds.length > 1;

  const step = (by: number) => onIndex((index! + by + photoIds.length) % photoIds.length);
  // On the dialog itself: the dialog keeps key presses from reaching the page.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || !many) return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dimNested onKeyDown={onKeyDown} className="max-w-[min(92vw,44rem)] p-2 sm:max-w-[min(92vw,44rem)]">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {open && (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image */}
            <img
              key={photoIds[index!]}
              src={withAsOrg(`/api/chat-photos/${photoIds[index!]}`)}
              alt={many ? `${title} (${index! + 1}/${photoIds.length})` : title}
              className="max-h-[80vh] w-full rounded-lg object-contain"
            />
            {many && (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label={t("photo.previous")}
                  className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/60"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label={t("photo.next")}
                  className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/60"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-white">
                  {index! + 1} / {photoIds.length}
                </span>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
