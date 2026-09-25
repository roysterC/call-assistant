import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Kikai",
  description:
    "How Kikai collects, uses, and protects data when you interact with our AI-powered customer messaging platform.",
};

const LAST_UPDATED = "24 April 2026";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground px-6 py-12">
      <article className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2 border-b border-border pb-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Kikai
          </p>
          <h1 className="text-3xl font-semibold">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">1. Who we are</h2>
          <p>
            Kikai (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates an
            AI-powered customer messaging platform (the &ldquo;Service&rdquo;)
            that businesses use to handle inbound messages across WhatsApp,
            Instagram, Facebook Messenger, website chat, and voice calls. We
            act as a data processor on behalf of the businesses that use the
            Service, and as data controller in respect of our own operational
            logs and account records.
          </p>
          <p className="mt-2">
            For the purposes of UK GDPR and the EU GDPR, the Data Controller
            is:
          </p>
          <address className="mt-2 not-italic text-sm text-foreground/80">
            Kikai
            <br />
            United Kingdom
            <br />
            Contact:{" "}
            <a
              className="text-blue-600 hover:underline"
              href="mailto:roy962002@hotmail.com"
            >
              roy962002@hotmail.com
            </a>
          </address>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            2. What we collect
          </h2>
          <p>
            When you send a message to a business that uses our Service, or
            place a phone call to a business&rsquo;s AI voice agent, we
            process the following categories of data:
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              <strong>Message content</strong> — text of messages you send or
              receive via WhatsApp, Instagram, Facebook Messenger, or website
              chat.
            </li>
            <li>
              <strong>Contact identifiers</strong> — your phone number (for
              WhatsApp and voice), Instagram scoped user id, Messenger PSID,
              website session id, and where voluntarily provided: name, email,
              company.
            </li>
            <li>
              <strong>Voice call data</strong> — call transcripts, duration,
              phone number, and recording URL where available.
            </li>
            <li>
              <strong>Technical metadata</strong> — timestamps, delivery
              status, message ids issued by the underlying platform.
            </li>
          </ul>
          <p className="mt-2">
            We do not intentionally collect special category data (health,
            biometric, political opinion, etc.). If you voluntarily share
            special category data in a message, please be aware it is stored
            alongside the rest of the conversation.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            3. Why we process it
          </h2>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              To deliver the Service: route your message to the correct
              business tenant, store conversation history, and generate an
              AI-assisted reply where the business has enabled auto-response.
            </li>
            <li>
              To maintain a record of prior interactions so future replies are
              contextual and consistent.
            </li>
            <li>
              To provide analytics and operational metrics to the business you
              are communicating with.
            </li>
          </ul>
          <p className="mt-2">
            <strong>Lawful basis (UK/EU GDPR):</strong> contract performance
            with the business (Art. 6(1)(b)) and the business&rsquo;s
            legitimate interest in operating a messaging channel
            (Art. 6(1)(f)). Where legally required, consent (Art. 6(1)(a)) is
            obtained by the business before you contact them.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            4. Third parties who process data on our behalf
          </h2>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              <strong>Anthropic, PBC</strong> (USA) — generates AI replies
              from conversation history. Data is transmitted to the
              Anthropic Claude API; Anthropic acts as a sub-processor.
            </li>
            <li>
              <strong>Meta Platforms Ireland Ltd</strong> — delivers WhatsApp,
              Instagram, and Facebook Messenger messages to/from our platform.
            </li>
            <li>
              <strong>Vapi Labs, Inc.</strong> (USA) — powers the AI voice
              agent (phone calls), including speech-to-text, LLM routing, and
              text-to-speech.
            </li>
            <li>
              <strong>Hetzner Online GmbH</strong> (Germany) — hosts our
              application and PostgreSQL database. Data is stored at rest in
              the EU.
            </li>
            <li>
              <strong>Cal.com, Inc.</strong> (USA) — optional calendar booking
              integration, used only when a business enables it.
            </li>
          </ul>
          <p className="mt-2">
            International transfers to the USA are covered by Standard
            Contractual Clauses (SCCs) with each sub-processor or, where
            available, the EU-US Data Privacy Framework.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">5. Retention</h2>
          <p>
            We retain conversation data for as long as the business tenant you
            are communicating with remains an active customer of the Service,
            plus up to 30 days after their account is closed for operational
            backup purposes. Individual records are deleted earlier on
            request &mdash; see section 7.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            6. How we protect it
          </h2>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Transport: all traffic is HTTPS / TLS 1.2+.</li>
            <li>
              At rest: data is stored in a PostgreSQL database on a private
              network.
            </li>
            <li>
              Access: limited to a named list of administrators; super-admin
              actions are tenant-gated.
            </li>
            <li>
              Authentication: credential-based with bcrypt-hashed passwords;
              no plaintext storage.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">7. Your rights</h2>
          <p>Under UK and EU GDPR you have the right to:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Request access to a copy of your personal data</li>
            <li>Request rectification of inaccurate data</li>
            <li>
              Request erasure of your data (&ldquo;right to be
              forgotten&rdquo;) &mdash; see{" "}
              <Link
                className="text-blue-600 hover:underline"
                href="/data-deletion"
              >
                our data-deletion procedure
              </Link>
            </li>
            <li>Restrict or object to processing</li>
            <li>Data portability (receive your data in a portable format)</li>
            <li>
              Lodge a complaint with the Information Commissioner&rsquo;s
              Office (ICO) at{" "}
              <a
                className="text-blue-600 hover:underline"
                href="https://ico.org.uk"
              >
                ico.org.uk
              </a>{" "}
              or your local EU supervisory authority
            </li>
          </ul>
          <p className="mt-2">
            To exercise any of these rights, email{" "}
            <a
              className="text-blue-600 hover:underline"
              href="mailto:roy962002@hotmail.com"
            >
              roy962002@hotmail.com
            </a>
            . We respond within 30 days as required by law.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">
            8. Changes to this policy
          </h2>
          <p>
            We may update this policy from time to time. Material changes will
            be flagged at the top of this page with the new &ldquo;Last
            updated&rdquo; date. Your continued use of the Service after an
            update signals acceptance.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mt-6 mb-2">9. Contact</h2>
          <p>
            Questions about this policy or about how your data is handled:{" "}
            <a
              className="text-blue-600 hover:underline"
              href="mailto:roy962002@hotmail.com"
            >
              roy962002@hotmail.com
            </a>
          </p>
        </section>

        <footer className="border-t border-border pt-6 mt-10 text-sm text-muted-foreground">
          <Link className="hover:underline" href="/terms-of-service">
            Terms of Service
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
