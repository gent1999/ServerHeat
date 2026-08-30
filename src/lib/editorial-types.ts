// Single source of truth for the editorial-type enum values on the backend
// (Zod needs its own literal tuple; it can't derive one from the Prisma enum).
export const EDITORIAL_TYPES = [
  'INTERVIEW',
  'ARTIST_SPOTLIGHT',
  'MUSIC_REVIEW',
  'NEW_RELEASE',
  'MUSIC_NEWS',
  'FASHION',
  'STREETWEAR',
  'BRAND_SPOTLIGHT',
  'CULTURE',
  'OTHER',
] as const;

export type EditorialTypeValue = (typeof EDITORIAL_TYPES)[number];
