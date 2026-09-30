import { GET as handleHealthGet } from "@backend/modules/health/health.service";

export const runtime = "edge";
export const GET = (request: Request) => handleHealthGet(request);
