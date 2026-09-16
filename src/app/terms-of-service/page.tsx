import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Kikai",
  description:
    "Terms governing use of the Kikai AI-powered customer messaging platform.",
};

const LAST_UPDATED = "24 April 2026";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-background text-slate-100 px-6 py-12">
      <article className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2 border-b border-border pb-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Kikai
          </p>
          <h1 className="text-3xl font-semibold">Terms of Service</h1>
          <p className="text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">1. Introduction</h2>
          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) govern your use of
            the Kikai AI-powered customer messaging platform (the
            &ldquo;Service&rdquo;). By using the Service, you agree to these
            Terms. If you do not agree, please do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            2. What the Service does
          </h2>
          <p>
            The Service aggregates inbound customer messages from WhatsApp,
            Instagram, Facebook Messenger, website chat widgets, and voice
            phone calls into a single CRM. It optionally generates
            AI-assisted replies on behalf of a business tenant, using the
            Anthropic Claude large language model.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">3. Who may use it</h2>
          <p>
            The Service is intended for business users who have been granted
            an account by Kikai or by an authorised super-administrator
            of their organisation. End customers messaging those businesses do
            not hold accounts; their interaction is governed by our{" "}
            <Link
              className="text-blue-400 hover:underline"
              href="/privacy-policy"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            4. Acceptable use
          </h2>
          <p>You agree not to use the Service to:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              Send unlawful, harassing, defamatory, or infringing content
            </li>
            <li>Impersonate any person or entity</li>
            <li>
              Circumvent rate limits, signature verification, or other
              technical controls
            </li>
            <li>
              Send bulk unsolicited messages (&ldquo;spam&rdquo;) via any
              connected channel
            </li>
            <li>
              Violate the terms of the underlying platforms (WhatsApp
              Business Terms, Meta Platform Terms, etc.)
            </li>
            <li>Transmit malware, exploit security vulnerabilities</li>
          </ul>
          <p className="mt-2">
            We may suspend or terminate accounts that breach this section
            without prior notice where the breach is severe or ongoing.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            5. AI-generated content
          </h2>
          <p>
            Where enabled by a business tenant, the Service generates replies
            using the Anthropic Claude API. AI-generated replies are produced
            automatically and may contain inaccuracies, omissions, or
            inappropriate content despite reasonable safeguards. The business
            tenant is responsible for the messages sent on their behalf. Kikai
            does not warrant the accuracy, completeness, or fitness for any
            particular purpose of AI-generated replies.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            6. Intellectual property
          </h2>
          <p>
            Kikai owns the Service, its codebase, design, and brand.
            Business tenants retain ownership of the content they upload,
            configure, or receive. End-customer content (e.g. inbound
            messages) is processed on the tenant&rsquo;s behalf under the
            Privacy Policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            7. No warranty
          </h2>
          <p>
            The Service is provided &ldquo;as is&rdquo; and &ldquo;as
            available&rdquo;, without warranties of any kind whether express
            or implied, including merchantability, fitness for a particular
            purpose, and non-infringement. We do not guarantee uninterrupted
            access, error-free operation, or delivery of every message.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            8. Limitation of liability
          </h2>
          <p>
            To the maximum extent permitted by law, Kikai shall not be
            liable for any indirect, incidental, special, consequential, or
            punitive damages arising out of or related to use of the Service.
            Our total aggregate liability in any twelve-month period shall
            not exceed the fees paid by the affected tenant for that period,
            or &pound;100 where no fees have been paid.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            9. Third-party platforms
          </h2>
          <p>
            The Service interoperates with WhatsApp, Instagram, Facebook
            Messenger, Vapi, Cal.com, and Anthropic. Those platforms have
            their own terms which you must also comply with. Kikai is
            not responsible for the availability, behaviour, or policy
            changes of those third parties.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            10. Changes to these terms
          </h2>
          <p>
            We may update these Terms from time to time. Material changes
            will be notified via the account holder&rsquo;s registered email
            at least 14 days before taking effect. Continued use of the
            Service after that period constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            11. Governing law
          </h2>
          <p>
            These Terms are governed by the laws of England and Wales.
            Disputes shall be resolved in the courts of England and Wales,
            subject to any mandatory consumer-protection rights that you have
            under your local law.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">12. Contact</h2>
          <p>
            Questions about these Terms:{" "}
            <a
              className="text-blue-400 hover:underline"
              href="mailto:roy962002@hotmail.com"
            >
              roy962002@hotmail.com
            </a>
          </p>
        </section>

        <footer className="border-t border-border pt-6 mt-10 text-sm text-muted-foreground">
          <Link className="hover:underline" href="/privacy-policy">
            Privacy Policy
          </Link>{" "}
          &middot;{" "}
          <Link className="hover:underline" href="/data-deletion">
            Data deletion
          </Link>
        </footer>
      </article>
    </div>
  );
}
