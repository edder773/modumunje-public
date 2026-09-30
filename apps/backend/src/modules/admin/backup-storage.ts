import { getRuntimeEnv } from "@backend/infrastructure/database";
import {
  EXTERNAL_BACKUP_FORMAT,
  EXTERNAL_BACKUP_VERSION,
} from "@shared/admin/backup-contract.mjs";

export { EXTERNAL_BACKUP_FORMAT, EXTERNAL_BACKUP_VERSION };
export const BACKUP_PART_MAX_BYTES = 256 * 1024;
export const BACKUP_PAGE_ROWS = 100;
export const BACKUP_MAX_PARTS = 800;
export const BACKUP_OBJECT_MAX_BYTES = 2 * 1024 * 1024;

export type BackupStorageMode = "database" | "external";

export type BackupObjectReceipt = {
  objectKey: string;
  byteSize: number;
  checksum: string;
};

export interface BackupStorage {
  readonly kind: "private-object-storage" | "local-contract-test";
  put(objectKey: string, body: Uint8Array): Promise<BackupObjectReceipt>;
  get(objectKey: string, maxBytes?: number): Promise<Uint8Array | null>;
  delete(objectKeys: string[]): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function backupObjectChecksum(body: Uint8Array) {
  const copy = Uint8Array.from(body);
  return hex(await crypto.subtle.digest("SHA-256", copy.buffer));
}

type R2CompatibleBucket = {
  put(key: string, value: Uint8Array, options?: Record<string, unknown>): Promise<unknown>;
  get(key: string): Promise<{ size?: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
};

class R2BackupStorage implements BackupStorage {
  readonly kind = "private-object-storage" as const;

  constructor(private readonly bucket: R2CompatibleBucket) {}

  async put(objectKey: string, body: Uint8Array) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.bucket.put(objectKey, body, {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
          customMetadata: { visibility: "private", purpose: "baeumzip-backup" },
        });
        break;
      } catch (error) {
        // R2 10001 is transient. Reusing the same key and bytes is safe even
        // when an earlier write succeeded but its acknowledgement was lost.
        if (attempt >= 3 || !(error instanceof Error) || !/\(10001\)\s*$/u.test(error.message)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt + Math.random() * 150));
      }
    }
    return {
      objectKey,
      byteSize: body.byteLength,
      checksum: await backupObjectChecksum(body),
    };
  }

  async get(objectKey: string, maxBytes = BACKUP_OBJECT_MAX_BYTES) {
    const object = await this.bucket.get(objectKey);
    if (!object) return null;
    if (typeof object.size === "number" && object.size > maxBytes) {
      throw new Error(`백업 객체가 메모리 제한 ${maxBytes}바이트를 초과합니다: ${objectKey}`);
    }
    const body = new Uint8Array(await object.arrayBuffer());
    if (body.byteLength > maxBytes) {
      throw new Error(`백업 객체가 메모리 제한 ${maxBytes}바이트를 초과합니다: ${objectKey}`);
    }
    return body;
  }

  async delete(objectKeys: string[]) {
    if (objectKeys.length) await this.bucket.delete(objectKeys);
  }

  async list(prefix: string) {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, cursor, limit: 1_000 });
      keys.push(...page.objects.map((object) => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return keys;
  }
}

export class InMemoryBackupStorage implements BackupStorage {
  readonly kind = "local-contract-test" as const;
  readonly objects = new Map<string, Uint8Array>();

  async put(objectKey: string, body: Uint8Array) {
    const copy = body.slice();
    this.objects.set(objectKey, copy);
    return {
      objectKey,
      byteSize: copy.byteLength,
      checksum: await backupObjectChecksum(copy),
    };
  }

  async get(objectKey: string, maxBytes = BACKUP_OBJECT_MAX_BYTES) {
    const body = this.objects.get(objectKey);
    if (body && body.byteLength > maxBytes) {
      throw new Error(`백업 객체가 메모리 제한 ${maxBytes}바이트를 초과합니다: ${objectKey}`);
    }
    return body?.slice() ?? null;
  }

  async delete(objectKeys: string[]) {
    for (const objectKey of objectKeys) this.objects.delete(objectKey);
  }

  async list(prefix: string) {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}

export function backupStorageForMode(mode: BackupStorageMode): BackupStorage | null {
  if (mode === "database") return null;
  const binding = getRuntimeEnv().BACKUP_OBJECTS as R2CompatibleBucket | undefined;
  if (!binding) {
    throw new Error(
      "외부 백업 모드를 사용할 수 없습니다. 비공개 R2 `BACKUP_OBJECTS` 연결이 필요합니다.",
    );
  }
  return new R2BackupStorage(binding);
}

export function configuredBackupStorageMode(): BackupStorageMode {
  return getRuntimeEnv().BACKUP_STORAGE_MODE === "external" ? "external" : "database";
}

export function backupStorageStatus() {
  const environment = getRuntimeEnv();
  const configuredMode = configuredBackupStorageMode();
  const externalAvailable = Boolean(environment.BACKUP_OBJECTS);
  return {
    configuredMode,
    externalAvailable,
    defaultMode: configuredMode,
    location: configuredMode === "external"
      ? externalAvailable ? "private-object-storage" : "unavailable"
      : "d1-legacy-chunks",
    warning: externalAvailable
      ? ""
      : configuredMode === "external"
        ? "외부 백업이 기본으로 설정되어 있지만 저장소가 연결되지 않았습니다. 백업을 생성하려면 연결을 복구하거나 D1 보관을 명시적으로 선택해 주세요."
        : "외부 저장소가 연결되지 않아 기존 D1 백업만 사용할 수 있습니다.",
  };
}

export function backupPartGroups(rows: Record<string, unknown>[], maxBytes = BACKUP_PART_MAX_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1_024) {
    throw new Error("백업 파트 크기 제한이 유효하지 않습니다.");
  }
  const encoder = new TextEncoder();
  const groups: Record<string, unknown>[][] = [];
  let current: Record<string, unknown>[] = [];
  let currentBytes = 2;
  for (const row of rows) {
    const rowBytes = encoder.encode(JSON.stringify(row)).byteLength;
    if (rowBytes + 2 > maxBytes) {
      throw new Error(`백업 단일 행이 파트 제한 ${maxBytes}바이트를 초과합니다.`);
    }
    const separatorBytes = current.length ? 1 : 0;
    if (current.length && currentBytes + separatorBytes + rowBytes > maxBytes) {
      groups.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(row);
    currentBytes += (current.length > 1 ? 1 : 0) + rowBytes;
  }
  if (current.length) groups.push(current);
  return groups;
}

export async function readAndVerifyBackupObject(
  storage: BackupStorage,
  expected: BackupObjectReceipt,
  maxBytes = BACKUP_OBJECT_MAX_BYTES,
) {
  if (expected.byteSize > maxBytes) {
    throw new Error(`백업 객체가 메모리 제한 ${maxBytes}바이트를 초과합니다: ${expected.objectKey}`);
  }
  const body = await storage.get(expected.objectKey, maxBytes);
  if (!body) throw new Error(`백업 객체가 없습니다: ${expected.objectKey}`);
  if (body.byteLength !== expected.byteSize) {
    throw new Error(`백업 객체 크기가 일치하지 않습니다: ${expected.objectKey}`);
  }
  const actual = await backupObjectChecksum(body);
  if (actual !== expected.checksum) {
    throw new Error(`백업 객체 무결성 검증값이 일치하지 않습니다: ${expected.objectKey}`);
  }
  return body;
}
