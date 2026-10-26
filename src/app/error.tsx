"use client";

/**
 * What a page shows when it fails to render, in place of Next's bare error
 * screen. The menu stays put, so the rest of the CRM is a tap away, and
 * "Try again" re-renders just this page.
 */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/components/providers/language-provider";

export default function PageError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const { t } = useT();
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={TriangleAlert}
            title={t("error.title")}
            hint={t("error.hint")}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => unstable_retry()}>{t("common.tryAgain")}</Button>
                <Link href="/start" className={buttonVariants({ variant: "outline" })}>
                  {t("error.startPage")}
                </Link>
              </div>
            }
          />
          {error.digest && (
            <p className="pb-5 text-center text-xs text-muted-foreground">{t("error.reference", { code: error.digest })}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
