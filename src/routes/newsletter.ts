import { Router } from 'express';
import { z } from 'zod';
import nodemailer, { Transporter } from 'nodemailer';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';

export const newsletterRouter = Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Lazy init so a missing credential doesn't crash the server -- only POST
// /send actually needs it; /subscribe, /subscribers, /unsubscribe all work
// without this configured at all.
//
// Gmail SMTP (same EMAIL_USER/EMAIL_PASSWORD App Password this project's
// sibling, Server808, already uses for its own notification emails) --
// chosen over a dedicated transactional-email API on request. Worth noting
// for whoever reads this later: Gmail enforces fairly strict daily sending
// caps and its anti-spam systems can throttle or flag an account for
// bulk/marketing-style sends, which a purpose-built provider wouldn't hit.
// Fine for this site's current subscriber volume; revisit if that changes.
let _transporter: Transporter | null = null;
function getTransporter(): Transporter {
  if (!_transporter) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      throw new HttpError(500, 'EMAIL_USER/EMAIL_PASSWORD are not set');
    }
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
    });
  }
  return _transporter;
}

function unsubscribeUrl(email: string) {
  return `${FRONTEND_URL}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}`;
}

// -- Email templates --------------------------------------------------------
// Re-skinned for ArtistHeat's actual branding (white/black editorial look,
// red-600 accent, Arial/Helvetica -- see ArtistHeat/src/app/globals.css and
// SiteFooter.tsx) rather than Cry808's black/purple-gradient look.

function buildEmailHtml({
  subject,
  introText,
  imageUrl,
  recipientEmail,
}: {
  subject: string;
  introText: string;
  imageUrl: string;
  recipientEmail: string;
}) {
  const unsubUrl = unsubscribeUrl(recipientEmail);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">

          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;border-bottom:2px solid #171717;">
              <img src="${FRONTEND_URL}/logo.png" alt="ArtistHeat" height="36" style="display:block;border:0;height:36px;width:auto;" />
              <span style="display:block;color:#737373;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;margin-top:6px;">Music, Art, and Culture</span>
            </td>
          </tr>

          ${introText ? `
          <!-- Intro -->
          <tr>
            <td style="padding:28px 32px 0;color:#404040;font-size:15px;line-height:1.7;">
              ${introText.replace(/\n/g, '<br/>')}
            </td>
          </tr>` : ''}

          <!-- Cover image -->
          <tr>
            <td style="padding:${introText ? '24px' : '28px'} 0 0;">
              <img
                src="${imageUrl}"
                alt="${subject}"
                style="width:100%;max-width:600px;display:block;border:0;"
              />
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:36px 32px;">
              <a
                href="${FRONTEND_URL}"
                style="display:inline-block;padding:14px 36px;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:bold;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;"
              >
                Read More on ArtistHeat &rarr;
              </a>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="border-top:1px solid #e5e5e5;"></td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;text-align:center;">
              <p style="margin:0 0 10px;color:#737373;font-size:11px;line-height:1.6;">
                You're receiving this because you subscribed at artistheat.com.
              </p>
              <a href="${unsubUrl}" style="color:#737373;font-size:11px;text-decoration:underline;">
                Unsubscribe
              </a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailText({
  subject,
  introText,
  imageUrl,
  recipientEmail,
}: {
  subject: string;
  introText: string;
  imageUrl: string;
  recipientEmail: string;
}) {
  const unsubUrl = unsubscribeUrl(recipientEmail);
  return [
    'ARTISTHEAT — Music, Art, and Culture',
    '====================================',
    '',
    subject,
    '',
    introText ? introText + '\n' : '',
    'View the full issue online:',
    imageUrl,
    '',
    '------------------------------------',
    `Read more: ${FRONTEND_URL}`,
    '',
    "You're receiving this because you subscribed at artistheat.com.",
    `Unsubscribe: ${unsubUrl}`,
  ].join('\n');
}

// -- Subscribe ----------------------------------------------------------------

const subscribeSchema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  source: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || null),
});

// POST /api/newsletter/subscribe -- public. Reactivates an inactive
// subscriber (same email re-subscribing) instead of erroring on the
// unique-email constraint.
newsletterRouter.post(
  '/subscribe',
  asyncHandler(async (req, res) => {
    const { email, source } = subscribeSchema.parse(req.body);

    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } });
    if (existing) {
      if (!existing.isActive) {
        await prisma.newsletterSubscriber.update({
          where: { email },
          data: { isActive: true, subscribedAt: new Date(), source: source ?? existing.source },
        });
        return res.status(200).json({ message: 'Welcome back! Your subscription has been reactivated.' });
      }
      throw new HttpError(400, 'This email is already subscribed to our newsletter.');
    }

    const subscriber = await prisma.newsletterSubscriber.create({ data: { email, source } });
    res.status(201).json({
      message: 'Successfully subscribed to the newsletter!',
      subscriber: { email: subscriber.email, subscribedAt: subscriber.subscribedAt },
    });
  })
);

// GET /api/newsletter/subscribers -- admin.
newsletterRouter.get(
  '/subscribers',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const subscribers = await prisma.newsletterSubscriber.findMany({ orderBy: { subscribedAt: 'desc' } });
    res.json({
      subscribers,
      count: subscribers.length,
      activeCount: subscribers.filter((s) => s.isActive).length,
    });
  })
);

// -- Unsubscribe ----------------------------------------------------------------

// GET /api/newsletter/unsubscribe -- public, followed when a subscriber
// clicks the unsubscribe link in an email. Redirects back to the site
// rather than returning JSON, since a browser lands here directly.
newsletterRouter.get(
  '/unsubscribe',
  asyncHandler(async (req, res) => {
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    if (!email) throw new HttpError(400, 'Email required');

    await prisma.newsletterSubscriber.updateMany({ where: { email }, data: { isActive: false } });
    res.redirect(`${FRONTEND_URL}/?unsubscribed=1`);
  })
);

// POST /api/newsletter/unsubscribe -- public. RFC 8058 one-click
// unsubscribe (what Gmail/Outlook's native "Unsubscribe" button POSTs to,
// per the List-Unsubscribe-Post header sent with every campaign email).
newsletterRouter.post(
  '/unsubscribe',
  asyncHandler(async (req, res) => {
    const email = (typeof req.query.email === 'string' ? req.query.email : null) ?? req.body?.email ?? null;
    if (!email) throw new HttpError(400, 'Email required');

    await prisma.newsletterSubscriber.updateMany({ where: { email }, data: { isActive: false } });
    res.status(200).json({ message: 'Unsubscribed' });
  })
);

// -- Send ----------------------------------------------------------------------

const sendSchema = z.object({
  subject: z.string().trim().min(1),
  imageUrl: z.string().trim().min(1),
  introText: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null),
  isTest: z.boolean().default(false),
});

// POST /api/newsletter/send -- admin. Sends one SMTP send PER RECIPIENT,
// sequentially -- not a single email with everyone BCC'd. This is what
// lets each email carry a per-recipient unsubscribe link and lets one
// recipient's failure not affect the rest (collected into `errors` instead
// of throwing). ~100ms pacing between sends is self-imposed courtesy
// throttling, on top of whatever Gmail itself enforces.
newsletterRouter.post(
  '/send',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = sendSchema.parse(req.body);
    const testEmail = process.env.TEST_EMAIL || 'tamerbots@gmail.com';

    const recipients = data.isTest
      ? [{ email: testEmail }]
      : await prisma.newsletterSubscriber.findMany({
          where: { isActive: true },
          select: { email: true },
          orderBy: { subscribedAt: 'asc' },
        });

    if (recipients.length === 0) {
      throw new HttpError(400, 'No active subscribers to send to');
    }

    const fromAddress = process.env.EMAIL_USER as string;
    const fromName = `ArtistHeat Newsletter <${fromAddress}>`;
    const transporter = getTransporter();

    let sent = 0;
    const errors: { email: string; error: string }[] = [];

    for (const { email } of recipients) {
      try {
        const unsubUrl = unsubscribeUrl(email);
        const unsubMailto = `mailto:${fromAddress}?subject=Unsubscribe%20${encodeURIComponent(email)}`;

        await transporter.sendMail({
          from: fromName,
          to: email,
          subject: data.subject,
          text: buildEmailText({ subject: data.subject, introText: data.introText || '', imageUrl: data.imageUrl, recipientEmail: email }),
          html: buildEmailHtml({ subject: data.subject, introText: data.introText || '', imageUrl: data.imageUrl, recipientEmail: email }),
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>, <${unsubMailto}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            Precedence: 'bulk',
            'X-Auto-Response-Suppress': 'OOF, AutoReply',
          },
        });

        sent++;
        if (recipients.length > 1) await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        errors.push({ email, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    await prisma.newsletterSend.create({
      data: {
        subject: data.subject,
        imageUrl: data.imageUrl,
        introText: data.introText,
        recipientCount: sent,
        isTest: data.isTest,
      },
    });

    res.json({
      sent,
      total: recipients.length,
      errors,
      message: data.isTest ? `Test email sent to ${testEmail}` : `Sent to ${sent} of ${recipients.length} subscribers`,
    });
  })
);

// GET /api/newsletter/sends -- admin, send history.
newsletterRouter.get(
  '/sends',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const sends = await prisma.newsletterSend.findMany({ orderBy: { sentAt: 'desc' }, take: 50 });
    res.json({ sends });
  })
);
