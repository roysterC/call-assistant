"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@animate-ui/react/primitives/base-ui/dialog"
import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { motion, useIsPresent, type Transition } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-tea-green-100/25 supports-backdrop-filter:backdrop-blur-[2px]",
        className
      )}
      {...props}
    />
  )
}

/**
 * On a phone, a form fills the screen instead of floating in a small box with
 * the diary showing round its edges. Pass as `className` to DialogContent.
 */
const PHONE_FULL_SCREEN =
  "max-md:inset-0 max-md:m-0 max-md:top-0 max-md:left-0 max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:max-w-none max-md:h-[100dvh] max-md:rounded-none max-md:content-start max-md:overflow-y-auto max-md:pb-[max(1rem,env(safe-area-inset-bottom))]"

/**
 * On a phone, something to look at and act on (a booking) comes up from the
 * bottom of the screen, where a thumb can reach its buttons.
 */
const PHONE_SHEET =
  "max-md:m-0 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:max-w-none max-md:max-h-[88dvh] max-md:overflow-y-auto max-md:rounded-b-none max-md:pb-[max(1rem,env(safe-area-inset-bottom))]"

/**
 * How the card comes and goes: a quick fade while it grows from just under
 * full size, flat and never blurred, so its text is sharp from the first
 * frame it can be read in.
 *
 * Animate UI's own dialog tips the card back in 3D, blurs it, and eases it in
 * on a slow spring. The browser draws a card like that as an image, so its
 * words stayed soft until the spring came to rest, most of a second after the
 * card looked open. Hence Base UI's popup here, animated by us. Someone who
 * asks for less motion gets the fade alone (MotionProvider in the root
 * layout).
 */
const SHOWN = { opacity: 1, scale: 1 }
const HIDDEN = { opacity: 0, scale: 0.96 }
const ENTER: Transition = { duration: 0.2, ease: [0.16, 1, 0.3, 1] }
const LEAVE: Transition = { duration: 0.15, ease: [0.4, 0, 1, 1] }

function DialogCard({ className, ...props }: BaseDialog.Popup.Props) {
  // Still on screen while it plays its way out: Base UI would otherwise hide
  // it at once, and it must not catch clicks meant for the page.
  const leaving = !useIsPresent()
  return (
    <BaseDialog.Popup
      data-slot="dialog-content"
      className={cn(
        // Centred by margins, not by moving it back half its own size,
        // which put the card on half a pixel.
        "fixed inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)] overflow-y-auto z-50 grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-2xl bg-popover p-5 text-sm text-popover-foreground shadow-raised ring-1 ring-border outline-none sm:max-w-sm",
        className
      )}
      render={
        <motion.div
          initial={HIDDEN}
          animate={SHOWN}
          exit={{ ...HIDDEN, transition: LEAVE }}
          transition={ENTER}
          {...(leaving && { hidden: false, style: { pointerEvents: "none" } })}
        />
      }
      {...props}
    />
  )
}

function DialogContent({
  children,
  showCloseButton = true,
  ...props
}: BaseDialog.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogCard {...props}>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogCard>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-5 -mb-5 flex flex-col-reverse gap-2 rounded-b-2xl border-t bg-muted/60 px-5 py-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  PHONE_FULL_SCREEN,
  PHONE_SHEET,
}
