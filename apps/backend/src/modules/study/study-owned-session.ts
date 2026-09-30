import {
  StudyRequestError
} from "./study-attempt.service";
import {
  StudyRepository
} from "./study.repository";


export async function sessionForUser(studyRepository: StudyRepository, key: string, sessionId: unknown) {
  const session = await studyRepository.findSessionForUser(key, String(sessionId ?? ""));
  if (!session) throw new StudyRequestError(404, "모의고사 세션을 찾지 못했습니다.", "valid exam session is required");
  return { ...session, items: await studyRepository.findSessionItems(session.id) };
}
