import { useEffect, useRef, useState } from "react";
import { apiGet } from "./admin-api-client";
import type { CertificationAdminDomain } from "@shared/admin/content-domains";

type TheoryResource = "theories" | "sw-theories";
type OpenMode = "detail" | "edit";

export async function loadAdminTheory<T extends { id: number; content: string }>(resource: TheoryResource, id: number, domain?: CertificationAdminDomain) {
  const params = new URLSearchParams({ id: String(id) });
  if (domain) params.set("contentDomain", domain);
  const result = await apiGet<{ items: T[] }>(resource, params);
  const theory = result.items.find(item => item.id === id);
  if (!theory || typeof theory.content !== "string") throw new Error("이론 본문을 불러오지 못했습니다. 다시 열어 주세요.");
  return theory;
}

// A closed dialog or a newer selection must never be replaced by an older response.
export function useAdminTheoryLoader<T extends { id: number; content: string }>({ resource, domain, onLoaded, onError }: {
  resource: TheoryResource;
  domain?: CertificationAdminDomain;
  onLoaded: (theory: T, mode: OpenMode) => void;
  onError: (message: string, error: boolean) => void;
}) {
  const sequence = useRef(0);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => () => { sequence.current += 1; }, []);
  function cancel() { sequence.current += 1; setPending(null); }
  async function open(theory: { id: number; title: string }, mode: OpenMode = "detail") {
    const request = ++sequence.current;
    setPending(theory.title);
    try {
      const result = await loadAdminTheory<T>(resource, theory.id, domain);
      if (request === sequence.current) { setPending(null); onLoaded(result, mode); }
    } catch (error) {
      if (request === sequence.current) {
        setPending(null);
        onError(error instanceof Error ? error.message : "이론 조회 실패", true);
      }
    }
  }
  return { open, pending, cancel };
}
