import { authorizeAdminRequest, authorizeLearnerRequest } from '@backend/common/auth/admin-auth';
import { PRIVATE_DIAGRAMS, SKCT_PRIVATE_DIAGRAM_URLS } from './private-diagrams.synthetic';

const headers = {
  'Cache-Control': 'private, no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'Vary': 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

export function protectSkctQuestionAssets<T extends { assetUrls?: unknown }>(question: T): T {
  if (!Array.isArray(question.assetUrls)) return question;
  return {
    ...question,
    assetUrls: question.assetUrls.map((url: unknown) => {
      if (typeof url !== 'string' || !SKCT_PRIVATE_DIAGRAM_URLS[url]) {
        throw Error('Unknown private SKCT diagram reference');
      }
      return SKCT_PRIVATE_DIAGRAM_URLS[url];
    }),
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const retiredIpe = url.pathname.startsWith('/api/private-diagrams/ipe/');
  const asset = PRIVATE_DIAGRAMS[url.pathname];
  if ((!asset && !retiredIpe) || request.method !== 'GET') return new Response(null, { status: 404, headers });
  const authorization = retiredIpe
    ? await authorizeAdminRequest(request)
    : await authorizeLearnerRequest(request);
  if (!authorization.ok) {
    return new Response(authorization.response.body, {
      status: authorization.response.status,
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (retiredIpe) return new Response(null, { status: 410, headers });
  if (!asset) return new Response(null, { status: 404, headers });
  return new Response(asset.svg, {
    status: 200,
    headers: { ...headers, 'Content-Type': 'image/svg+xml; charset=utf-8' },
  });
}
