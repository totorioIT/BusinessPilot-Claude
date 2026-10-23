import { accessToken, type GoogleClient } from './google-calendar.js';

// Google Business Profile: the business connects its Google account (the one that manages its
// profile), picks the location, and BusinessPilot reads and answers its reviews.
// Accounts and locations come from the v1 APIs, reviews still from the v4 API.

export const BUSINESS_SCOPES = ['https://www.googleapis.com/auth/business.manage'];

const ACCOUNTS = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const V4 = 'https://mybusiness.googleapis.com/v4';

async function call<T>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // The two setup mistakes everyone makes get a sentence that says what to do.
    if (/has not been used in project|is disabled/i.test(text)) {
      const api = /mybusinessaccountmanagement/.test(url)
        ? 'My Business Account Management API'
        : /mybusinessbusinessinformation/.test(url)
          ? 'My Business Business Information API'
          : 'Google My Business API';
      throw new Error(`Die Schnittstelle „${api}“ ist im Google-Cloud-Projekt noch nicht aktiviert.`);
    }
    if (res.status === 429) throw new Error('Google hat für dieses Projekt noch keinen Zugriff auf Unternehmensprofile freigegeben (Kontingent 0) oder das Limit ist erreicht.');
    if (res.status === 403) throw new Error('Dieses Google-Konto darf das Unternehmensprofil nicht verwalten.');
    throw new Error(`Google Unternehmensprofil antwortet mit ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
  return (res.status === 204 ? {} : await res.json()) as T;
}

export type BusinessLocation = { id: string; title: string; address: string | null };

/** Every location the connected account manages; id is "accounts/…/locations/…". */
export async function listBusinessLocations(client: GoogleClient, refreshToken: string): Promise<BusinessLocation[]> {
  const token = await accessToken(client, refreshToken);
  const { accounts = [] } = await call<{ accounts?: { name: string }[] }>(token, 'GET', `${ACCOUNTS}/accounts`);
  const out: BusinessLocation[] = [];
  for (const account of accounts) {
    let pageToken = '';
    do {
      const q = new URLSearchParams({ readMask: 'name,title,storefrontAddress', pageSize: '100', ...(pageToken ? { pageToken } : {}) });
      const page = await call<{
        locations?: { name: string; title?: string; storefrontAddress?: { addressLines?: string[]; locality?: string } }[];
        nextPageToken?: string;
      }>(token, 'GET', `${INFO}/${account.name}/locations?${q}`);
      for (const l of page.locations ?? []) {
        const a = l.storefrontAddress;
        out.push({
          id: `${account.name}/${l.name}`,
          title: l.title ?? l.name,
          address: a ? [...(a.addressLines ?? []), a.locality].filter(Boolean).join(', ') || null : null,
        });
      }
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
  }
  return out;
}

/**
 * Google mixes machine translations into the comment, either "original\n\n(Translated by Google)\n…"
 * or "(Translated by Google) …\n\n(Original)\noriginal". The business wants to read what was written.
 */
export function originalText(comment: string): string {
  const marker = '\n\n(Original)\n';
  if (comment.includes(marker)) return comment.slice(comment.indexOf(marker) + marker.length).trim();
  return comment.split('\n\n(Translated by Google)')[0].trim();
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export type GoogleReview = {
  id: string;
  author: string;
  rating: number;
  text: string;
  createdAt: string;
  reply: { text: string; updatedAt: string | null } | null;
};

export async function listGoogleReviews(client: GoogleClient, refreshToken: string, locationId: string, pageToken?: string) {
  const token = await accessToken(client, refreshToken);
  const q = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc', ...(pageToken ? { pageToken } : {}) });
  const body = await call<{
    reviews?: {
      reviewId: string;
      reviewer?: { displayName?: string; isAnonymous?: boolean };
      starRating?: string;
      comment?: string;
      createTime: string;
      reviewReply?: { comment: string; updateTime?: string };
    }[];
    averageRating?: number;
    totalReviewCount?: number;
    nextPageToken?: string;
  }>(token, 'GET', `${V4}/${locationId}/reviews?${q}`);
  const reviews: GoogleReview[] = (body.reviews ?? []).map((r) => ({
    id: r.reviewId,
    author: r.reviewer?.isAnonymous ? 'Anonym' : (r.reviewer?.displayName ?? 'Google-Nutzer'),
    rating: STARS[r.starRating ?? ''] ?? 0,
    text: originalText(r.comment ?? ''),
    createdAt: r.createTime,
    reply: r.reviewReply ? { text: r.reviewReply.comment, updatedAt: r.reviewReply.updateTime ?? null } : null,
  }));
  return { reviews, averageRating: body.averageRating ?? null, total: body.totalReviewCount ?? reviews.length, nextPageToken: body.nextPageToken ?? null };
}

export async function replyToGoogleReview(client: GoogleClient, refreshToken: string, locationId: string, reviewId: string, comment: string) {
  const token = await accessToken(client, refreshToken);
  await call(token, 'PUT', `${V4}/${locationId}/reviews/${encodeURIComponent(reviewId)}/reply`, { comment });
}

export async function deleteGoogleReviewReply(client: GoogleClient, refreshToken: string, locationId: string, reviewId: string) {
  const token = await accessToken(client, refreshToken);
  await call(token, 'DELETE', `${V4}/${locationId}/reviews/${encodeURIComponent(reviewId)}/reply`);
}
