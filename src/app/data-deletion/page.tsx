import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Data Deletion Instructions — Kikai",
  description:
    "How to request deletion of your personal data from the Kikai AI messaging platform.",
};

const LAST_UPDATED = "24 April 2026";

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-background text-foreground px-6 py-12">
      <article className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2 border-b border-border pb-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Kikai
          </p>
          <h1 className="text-3xl font-semibold">
            Data deletion instructions
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            What this page covers
          </h2>
          <p>
            This page explains how to request deletion of personal data that
            Kikai holds about you as a result of your interaction with
            a business that uses our AI messaging platform. This applies
            whether you messaged a business via WhatsApp, Instagram, Facebook
            Messenger, website chat, or by placing a voice call to its AI
            phone agent.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            How to request deletion
          </h2>
          <ol className="list-decimal pl-6 mt-2 space-y-1">
            <li>
              Send an email to{" "}
              <a
                className="text-blue-600 hover:underline"
                href="mailto:roy962002@hotmail.com?subject=Data%20deletion%20request"
              >
                roy962002@hotmail.com
              </a>{" "}
              with the subject line{" "}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                Data deletion request
              </code>
              .
            </li>
            <li>
              Include enough identifying information for us to locate your
              records. At minimum, one of:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>The phone number you used on WhatsApp or voice calls</li>
                <li>Your Instagram handle or account id</li>
                <li>Your Facebook Messenger sender id</li>
                <li>
                  The website session id (shown at the bottom of the chat
                  widget, if applicable)
                </li>
                <li>The email address you provided on a lead form</li>
              </ul>
            </li>
            <li>
              Name the business you were contacting so we can route the
              request to the correct tenant.
            </li>
            <li>
              We will confirm receipt within 3 working days and complete the
              deletion within 30 calendar days, as required by UK and EU
              GDPR.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            What gets deleted
          </h2>
          <p>
            Upon a valid request, we remove the following from our production
            database:
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Lead records containing your name, email, phone, company</li>
            <li>Conversation records across all channels</li>
            <li>Message contents (both inbound and AI-generated replies)</li>
            <li>Voice call transcripts and metadata</li>
            <li>Scheduled callbacks tied to your lead</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            What may be retained
          </h2>
          <p>
            A limited amount of information may be retained where required by
            law or for legitimate operational purposes:
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              Aggregate, anonymised metrics (e.g. total message counts) that
              no longer identify you
            </li>
            <li>
              Records required for anti-fraud, legal, tax, or audit purposes
              for the statutory retention period
            </li>
            <li>
              Encrypted database backups for up to 30 days, after which the
              data expires automatically
            </li>
          </ul>
          <p className="mt-2">
            Once retained records are no longer needed, they are permanently
            deleted as part of our routine retention cycle.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            Third-party platforms
          </h2>
          <p>
            Deleting your data from Kikai does not delete any
            information held by the underlying platforms themselves
            (WhatsApp, Instagram, Facebook, Anthropic, Vapi, Cal.com). To
            remove data from those services, you must contact them directly
            or use their in-product settings:
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              WhatsApp / Instagram / Facebook:{" "}
              <a
                className="text-blue-600 hover:underline"
                href="https://www.facebook.com/help"
              >
                Meta Help Centre
              </a>
            </li>
            <li>
              Anthropic:{" "}
              <a
                className="text-blue-600 hover:underline"
                href="https://support.anthropic.com/"
              >
                support.anthropic.com
              </a>
            </li>
            <li>
              Vapi:{" "}
              <a className="text-blue-600 hover:underline" href="https://vapi.ai">
                vapi.ai
              </a>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            Your other rights
          </h2>
          <p>
            Data deletion is one of several rights you have under UK/EU
            GDPR. For the full list, see our{" "}
            <Link
              className="text-blue-600 hover:underline"
              href="/privacy-policy"
            >
              Privacy Policy
            </Link>
            . You may also lodge a complaint with the UK Information
            Commissioner&rsquo;s Office at{" "}
            <a
              className="text-blue-600 hover:underline"
              href="https://ico.org.uk"
            >
              ico.org.uk
            </a>{" "}
            if you are not satisfied with our response.
          </p>
        </section>

        <footer className="border-t border-border pt-6 mt-10 text-sm text-muted-foreground">
          <Link className="hover:underline" href="/privacy-policy">
            Privacy Policy
          </Link>{" "}
          &middot;{" "}
          <Link className="hover:underline" href="/terms-of-service">
            Terms of Service
          </Link>
        </footer>
      </article>
    </div>
  );
}
