import { verifyUserMutationRequest } from "@backend/common/auth/admin-auth";

export async function POST(request: Request) {
  const denied = verifyUserMutationRequest(request);
  if (denied) return denied;
  return Response.json({ error: "문제 풀이와 모의고사는 로그인 후 이용할 수 있습니다.", code: "LOGIN_REQUIRED" }, {
    status: 401, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
