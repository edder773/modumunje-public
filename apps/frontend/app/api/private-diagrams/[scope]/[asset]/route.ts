import { GET as handleGet } from '@backend/modules/private-diagrams/private-diagrams.service';
import { withApiErrorBoundary } from '@backend/common/http/api-response';
import { withSiteIdentity } from '@frontend/server/auth/site-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
const failure = { code: 'PRIVATE_DIAGRAM_UNAVAILABLE', message: '그림을 불러오지 못했습니다.' };
export const GET = (request: Request) => withSiteIdentity(request, authenticated =>
  withApiErrorBoundary(authenticated, () => handleGet(authenticated), failure));
