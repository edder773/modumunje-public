import { expect, test } from "@playwright/test";
import { createLocalAdminGoogleStorageState } from "./local-google-session";

test.use({ storageState: createLocalAdminGoogleStorageState() });

test('daily traffic defaults to 14 days, custom periods page without horizontal overflow, and invalid dates preserve the graph', async ({ page, baseURL }, testInfo) => {
  test.skip(!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'local fixtures only');
  const queries: URL[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/events**', route => route.fulfill({ status: 204 }));
  await page.route('**/api/admin?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('resource') !== 'analytics') {
      return route.fulfill({ json: { newCount: 0 } });
    }
    queries.push(url);
    const custom = url.searchParams.get('range') === 'custom';
    const start = custom ? url.searchParams.get('start')! : '2026-09-01';
    const end = custom ? url.searchParams.get('end')! : '2026-09-14';
    return route.fulfill({ json: {
      period: { range: custom ? 'custom' : '14d', start: `${start}T00:00:00+09:00`, end: `${end}T23:59:59+09:00` },
      excludeAdmin: url.searchParams.get('excludeAdmin') !== 'false',
      summary: { pageViews: 140, visitors: 14, returningVisitors: 3, returningRate: 21.4, guestSubmissions: 2, memberSubmissions: 3, submissions: 5 },
      daily: [{ label: start, pageViews: 12345, visitors: 34, returningVisitors: 4, submissions: 5 },
        { label: end, pageViews: 26, visitors: 20, returningVisitors: 6, submissions: 4 }],
      bySubject: [],
      byDate: {
        [start]: [{ examType: 'IPEW', courseName: '정보처리기사 필기', subject: '소프트웨어 설계', memberCount: 3, guestCount: 2, count: 5 }],
        [end]: [{ examType: 'ISEW', courseName: '정보보안기사 필기', subject: '시스템보안', memberCount: 2, guestCount: 2, count: 4 }],
      },
    } });
  });
  await page.goto('/admin/analytics');
  const days = page.locator('.admin-traffic-day');
  await expect(days).toHaveCount(14);
  expect(queries[0].searchParams.get('range')).toBe('14d');
  await expect(page.getByRole('button', { name: '최근 14일', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.admin-traffic-window')).toContainText('2026-09-01 ~ 2026-09-14');
  await expect(days.nth(1)).toHaveAttribute('aria-label', /2026-09-02 · 조회수 0회/);
  await expect(page.getByRole('navigation', { name: '일간 그래프 기간 이동' })).toHaveCount(0);
  const details = page.getByRole('region', { name: '날짜별 상세 통계' });
  const submissions = page.getByRole('region', { name: '자격증별 답안 제출', exact: true });
  await expect(submissions).toContainText('2026년 9월 14일');
  await expect(submissions).toContainText('정보보안기사');
  await days.first().click();
  await expect(submissions).toContainText('2026년 9월 1일');
  await expect(submissions).toContainText('정보처리기사');
  await expect(submissions).not.toContainText('정보보안기사');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('.admin-traffic-plot')).toBeVisible();
    if (width < 600) {
      await expect.poll(async () => {
        const box = await page.getByRole('complementary', { name: '관리자 메뉴' }).boundingBox();
        return box ? box.x + box.width : 0;
      }).toBeLessThanOrEqual(0);
    }
    await page.screenshot({ path: testInfo.outputPath(`traffic-${width}.png`), fullPage: true });
    expect(await page.locator('.admin-traffic-scroll').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await days.first().focus();
  await days.first().press('ArrowRight');
  await expect(days.nth(1)).toBeFocused();
  await expect(details).toContainText('2026년 9월 2일');
  await page.getByLabel('시작일', { exact: true }).fill('2026-08-01');
  await page.getByLabel('종료일', { exact: true }).fill('2026-08-30');
  await page.getByRole('button', { name: '기간 적용', exact: true }).click();
  await expect(page.locator('.admin-applied-period')).toContainText('2026-08-01 ~ 2026-08-30');
  await expect(days).toHaveCount(14);
  await expect(page.locator('.admin-traffic-window')).toContainText('2026-08-01 ~ 2026-08-14');
  await expect(page.getByRole('button', { name: '이전 14일' })).toBeDisabled();
  await page.getByRole('button', { name: '다음 14일' }).click();
  await expect(page.locator('.admin-traffic-window')).toContainText('2026-08-15 ~ 2026-08-28');
  await days.first().focus();
  await expect(details).toContainText('전일과 같음');
  await page.getByRole('button', { name: '다음 14일' }).click();
  await expect(days).toHaveCount(2);
  await expect(page.locator('.admin-traffic-window')).toContainText('2026-08-29 ~ 2026-08-30');
  await expect(page.getByRole('button', { name: '다음 14일' })).toBeDisabled();
  await page.getByRole('button', { name: '재방문 그래프 보기' }).click();
  await expect(page.getByRole('group', { name: '날짜별 전체 방문 브라우저와 재방문 브라우저' })).toBeVisible();
  await expect(days).toHaveCount(2);
  const beforeInvalid = queries.length;
  await page.getByLabel('시작일', { exact: true }).fill('2026-09-20');
  await page.getByRole('button', { name: '기간 적용', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('시작일은 종료일보다 늦을 수 없습니다');
  expect(queries.length).toBe(beforeInvalid);
  await expect(days).toHaveCount(2);
  await page.getByRole('button', { name: '최근 14일', exact: true }).click();
  await expect(days).toHaveCount(14);
  await expect(page.locator('.admin-traffic-window')).toContainText('2026-09-01 ~ 2026-09-14');
  expect(errors).toEqual([]);
});
