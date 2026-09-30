// Append inside the SAME atomic restore batch. Never run after commit.
// A missing fourth slot violates NOT NULL and rolls all restored data back.
export const GROUP_OWNER_SLOT_RECOVERY_SQL = [
  `DELETE FROM study_group_owner_slots WHERE NOT EXISTS (
      SELECT 1 FROM study_groups g WHERE g.id=study_group_owner_slots.group_id AND g.owner_user_key=study_group_owner_slots.owner_user_key AND g.status='active')`,
  `INSERT INTO study_group_owner_slots(group_id,owner_user_key,slot)
      WITH missing AS (SELECT g.id,g.owner_user_key,ROW_NUMBER() OVER(PARTITION BY g.owner_user_key ORDER BY g.created_at,g.id) AS n
        FROM study_groups g WHERE g.status='active' AND NOT EXISTS(SELECT 1 FROM study_group_owner_slots s WHERE s.group_id=g.id)),
      free AS (SELECT owner.owner_user_key,slots.slot,ROW_NUMBER() OVER(PARTITION BY owner.owner_user_key ORDER BY slots.slot) AS n
        FROM (SELECT DISTINCT owner_user_key FROM missing) owner CROSS JOIN (SELECT 1 AS slot UNION ALL SELECT 2 UNION ALL SELECT 3) slots
        WHERE NOT EXISTS(SELECT 1 FROM study_group_owner_slots s WHERE s.owner_user_key=owner.owner_user_key AND s.slot=slots.slot))
      SELECT missing.id,missing.owner_user_key,free.slot FROM missing LEFT JOIN free ON free.owner_user_key=missing.owner_user_key AND free.n=missing.n`
];
