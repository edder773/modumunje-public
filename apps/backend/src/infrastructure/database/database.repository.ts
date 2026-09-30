import { getD1, getDb } from "@backend/infrastructure/database";

export class DatabaseRepository {
  connection() {
    return getD1();
  }

  orm() {
    return getDb();
  }
}
