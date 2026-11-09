"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@animate-ui/react/primitives/base-ui/dialog"

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
 * Marks the card `data-settled` once its opening animation has finished, so
 * globals.css can take off what the animation leaves behind: a 3D transform
 * ("perspective(500px) rotateX(0deg) scale(1)") and "blur(0px)". Left on,
 * they had the browser draw the open card as an image, at half a pixel when
 * its size was odd, and every word in it came out soft. The card is checked
 * each frame until it is upright, fully shown and unblurred, or for two
 * seconds at most.
 */
function useSettled(): (el: HTMLDivElement | null) => void {
  // A callback ref, not useRef: the card only exists once the dialog opens,
  // well after this component first renders.
  return React.useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const started = performance.now()
    const check = () => {
      if (!el.isConnected) return
      const s = el.style
      const upright = !s.transform || /rotate[XY]\(0deg\) scale\(1\)/.test(s.transform)
      const shown = !s.opacity || s.opacity === "1"
      const sharp = !s.filter || s.filter === "blur(0px)" || s.filter === "none"
      if ((upright && shown && sharp) || performance.now() - started > 2000) {
        el.setAttribute("data-settled", "")
      } else {
        requestAnimationFrame(check)
      }
    }
    requestAnimationFrame(check)
  }, [])
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const settledRef = useSettled()
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        ref={settledRef}
        data-slot="dialog-content"
        className={cn(
          // Centred by margins, not by moving it back half its own size,
          // which put the card on half a pixel. See useSettled for the rest.
          "fixed inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)] overflow-y-auto z-50 grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-2xl bg-popover p-5 text-sm text-popover-foreground shadow-raised ring-1 ring-border outline-none sm:max-w-sm",
          className
        )}
        {...props}
      >
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
      </DialogPrimitive.Popup>
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
