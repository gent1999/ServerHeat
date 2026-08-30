import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';

export const settingsRouter = Router();

const SETTINGS_ID = 1;

// GET /api/settings -- public. The homepage needs this to render the
// Spotify playlist widget for anonymous visitors.
settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = await prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
    res.json({ settings: { homepageSpotifyPlaylistUrl: settings?.homepageSpotifyPlaylistUrl ?? null } });
  })
);

const updateSettingsSchema = z.object({
  homepageSpotifyPlaylistUrl: z
    .string()
    .regex(/^https:\/\/open\.spotify\.com\/(track|album|playlist|episode|show|artist)\/[A-Za-z0-9]+/, 'Not a Spotify link')
    .nullable()
    .optional(),
});

// PUT /api/settings -- any authenticated admin-panel account (admin or
// editor) can manage this. It's a brand/content decision like creating an
// article, not an account-security one, so it doesn't need requireAdminRole.
settingsRouter.put(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = updateSettingsSchema.parse(req.body);
    const settings = await prisma.siteSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, homepageSpotifyPlaylistUrl: data.homepageSpotifyPlaylistUrl ?? null },
      update: { homepageSpotifyPlaylistUrl: data.homepageSpotifyPlaylistUrl ?? null },
    });
    res.json({ settings: { homepageSpotifyPlaylistUrl: settings.homepageSpotifyPlaylistUrl } });
  })
);
