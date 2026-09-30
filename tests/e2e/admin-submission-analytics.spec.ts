import { expect, test } from "@playwright/test";
import { createLocalAdminGoogleStorageState } from "./local-google-session";

test.use({ storageState: createLocalAdminGoogleStorageState() });
const rows = [
  { examType: 'ISEW', courseName: '정보보안기사 필기', subject: '시스템보안', memberCount: 4, guestCount: 3, count: 7 },
  { examType: 'IPEW', courseName: '정보처리기사 필기', subject: '시스템보안', memberCount: 1, guestCount: 2, count: 3 },
  { examType: 'ISEW', courseName: '정보보안기사 필기', subject: '네트워크보안', memberCount: 0, guestCount: 2, count: 2 },
  { examType: 'IPEP', courseName: '정보처리기사 실기', subject: '정보처리실무', memberCount: 2, guestCount: 1, count: 3 },
];
const summary = { pageViews: 10, visitors: 3, returningVisitors: 1, returningRate: 33.3,
  submissions: 15, memberSubmissions: 7, guestSubmissions: 8 };

test('certification submissions combine subjects and exam modes in a compact accessible table', async ({ page, baseURL }, testInfo) => {
  test.skip(!baseURL || !['localhost','127.0.0.1'].includes(new URL(baseURL).hostname), 'local fixtures only');
  const errors: string[] = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/events**',route=>route.fulfill({status:204}));
  await page.route('**/api/admin?**',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    summary, bySubject:rows, byDate:{'2026-09-14':rows}, daily:[{label:'2026-09-14',pageViews:10,visitors:3,returningVisitors:1,submissions:15}],
    period:{range:'14d',start:'2026-09-01',end:'2026-09-14'},excludeAdmin:true,
  })}));
  await page.goto('/admin/analytics');
  const section=page.getByRole('region',{name:'자격증별 답안 제출',exact:true});
  await expect(section).toBeVisible();
  await expect(section).toContainText('2026년 9월 14일');
  await expect(page.getByRole('heading',{name:'회원 학습 분야별 풀이'})).toHaveCount(0);
  await expect(section.locator('tbody tr')).toHaveCount(2);
  await expect(section.locator('tfoot')).toContainText('15회');
  await expect(section.locator('tfoot')).toContainText('7회');
  await expect(section.locator('tfoot')).toContainText('8회');
  const securityRow = section.getByRole('row').filter({hasText:'정보보안기사'});
  await expect(securityRow).toContainText('9회');
  const processingRow = section.getByRole('row').filter({hasText:'정보처리기사'});
  await expect(processingRow).toContainText('6회');
  await expect(section.getByRole('combobox')).toHaveCount(0);
  await expect(section).not.toContainText('시스템보안');
  await expect(section).not.toContainText('정보처리실무');
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:1000});
    await expect(section).toBeVisible();
    if (width < 600) {
      expect((await section.locator('.admin-card-head').boundingBox())!.height).toBeLessThan(170);
      await expect.poll(async () => {
        const box = await page.getByRole('complementary', { name: '관리자 메뉴' }).boundingBox();
        return box ? box.x + box.width : 0;
      }).toBeLessThanOrEqual(0);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await section.locator('.admin-submission-scroll').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:testInfo.outputPath(`certification-submissions-${width}.png`),fullPage:true,animations:'disabled'});
  }
  const details=page.getByRole('region',{name:'날짜별 상세 통계'});
  await expect(details).toContainText('전체 답안 제출');
  await expect(details).toContainText('15회');
  expect(errors).toEqual([]);
});

test('guest-only submissions are visible even without page views or member records',async({page,baseURL})=>{
  test.skip(!baseURL || !['localhost','127.0.0.1'].includes(new URL(baseURL).hostname),'local fixtures only');
  await page.route('**/api/events**',route=>route.fulfill({status:204}));
  await page.route('**/api/admin?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    summary:{...summary,pageViews:0,visitors:0,returningVisitors:0,returningRate:null,submissions:2,memberSubmissions:0,guestSubmissions:2},
    bySubject:[rows[2]],byDate:{'2026-09-14':[rows[2]]},daily:[{label:'2026-09-14',pageViews:0,visitors:0,returningVisitors:0,submissions:2}],
    period:{range:'14d',start:'2026-09-01',end:'2026-09-14'},excludeAdmin:true,
  })}));
  await page.goto('/admin/analytics');
  await expect(page.getByRole('region',{name:'자격증별 답안 제출',exact:true})).toBeVisible();
  await expect(page.getByText('통계를 표시할 방문·학습 기록이 아직 없습니다.')).toHaveCount(0);
  await expect(page.locator('.admin-submission-scroll tbody tr')).toContainText('정보보안기사');
});
