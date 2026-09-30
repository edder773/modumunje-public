import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const subject3 = "SQL 고급 활용 및 튜닝";
const expectedIds = [
  717, 718, 719, 720, 740, 732, 817, 765, 715, 928, 768, 769, 749, 723, 734,
  741, 744, 750, 818, 752, 909, 910, 751, 821, 754, 907, 713, 753, 918, 820,
  908, 822, 920, 756, 936, 757, 926, 925, 770, 771, 933, 772, 742, 761, 714,
  922, 758, 911, 912, 759, 760, 917, 778, 905, 906, 904, 779, 927, 824, 924,
  819, 913, 930, 923, 746, 914, 915, 762, 774, 773, 919, 823, 929, 748, 775,
  776, 764, 825, 743, 777, 767, 921, 766, 733, 736, 738, 735, 737, 830, 739,
  780, 781, 782, 938, 828, 783, 784, 785, 724, 728, 725, 722, 730, 745, 747,
  826, 755, 900, 763, 902, 903, 901, 827, 916, 726, 727, 731, 729, 829, 931,
  932, 721,
];

function materialize() {
  return openCanonicalTestDatabase(root);
}

test("the beginner sequence contains every subject-3 theory exactly once", () => {
  const database = materialize();
  const rows = database.prepare(`
    SELECT id, sort_order
    FROM theories
    WHERE category = ?
    ORDER BY sort_order, id
  `).all(subject3);

  assert.equal(rows.length, 122);
  assert.equal(new Set(rows.map((row) => row.id)).size, 122);
  assert.deepEqual(rows.map((row) => row.id), expectedIds);
  assert.deepEqual(
    rows.map((row) => row.sort_order),
    Array.from({ length: 122 }, (_, index) => index + 1),
  );
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("learner lists and next-theory navigation honor database sort_order", () => {
  const app = readFeatureSource(path.join(root, "apps/frontend/src/features/study/components/study-app.tsx"), "utf8");
  assert.match(app, /first\.sortOrder\s*-\s*second\.sortOrder/u);
  assert.doesNotMatch(app, /function theoryTopicOrder/u);
  assert.match(app, /const ordered = \[\.\.\.articles\]\.sort\(compareTheories\)/u);
});
