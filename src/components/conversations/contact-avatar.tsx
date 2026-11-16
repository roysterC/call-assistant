"use client";

/**
 * A client's picture: their Instagram or Messenger profile photo when we have
 * one, else their initials on a colour. Used wherever a conversation's client
 * is shown (the list, the chat's header, the client panel) so all three agree.
 */

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

export function ContactAvatar({
  src,
  initials,
  colourClass,
  size,
  className,
}: {
  src?: string | null;
  initials: string;
  /** The initials' background and text colour (avatarColorFor). */
  colourClass: string;
  /** In pixels: the photo's width and height. */
  size: number;
  /** Size and text classes for the circle, e.g. "h-10 w-10 text-sm". */
  className: string;
}) {
  // Meta's profile photo links expire after about a day; a dead one shows
  // the initials instead of a broken image. Remembered per link, so a fresh
  // link for the same client is tried again.
  const [failed, setFailed] = useState<string | null>(null);

  if (src && failed !== src) {
    return (
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        className={cn("rounded-full object-cover", className)}
        unoptimized
        onError={() => setFailed(src)}
      />
    );
  }
  return (
    <span aria-hidden="true" className={cn("flex items-center justify-center rounded-full font-semibold", colourClass, className)}>
      {initials}
    </span>
  );
}
