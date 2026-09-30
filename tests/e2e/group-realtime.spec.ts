/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic JSON payloads are checked by concrete field and behavior assertions. */
import {test,expect} from '@playwright/test';
import {createLocalGoogleStorageState} from './local-google-session';
test('two real participant browsers receive a shared start over WebSocket and save an answer',async({page,browser},testInfo)=>{
 const id=crypto.randomUUID();const owner=`browser-owner-${id}@example.test`,peer=`browser-peer-${id}@example.test`;
 await page.context().addCookies(createLocalGoogleStorageState({email:owner}).cookies);
 const other=await browser.newContext({storageState:createLocalGoogleStorageState({email:peer})});const second=await other.newPage();
 const post=async(context:any,body:Record<string,unknown>)=>{const response=await context.request.post('http://127.0.0.1:4173/api/group-exams',{headers:{origin:'http://127.0.0.1:4173','x-sql-study-user-request':'1'},data:{idempotencyKey:crypto.randomUUID(),...body}});expect(response.ok(),await response.text()).toBe(true);return response.json();};
 const created=await post(page.context(),{action:'group-create',name:'실시간 학습 그룹',publicName:'대표'});const groupId=created.group.id;
 const invite=await post(page.context(),{action:'invite-create',groupId});await post(other,{action:'invite-accept',token:invite.invite.token,publicName:'참가자'});
 const frames:string[]=[];page.on('websocket',socket=>socket.on('framereceived',event=>{try{frames.push(JSON.parse(String(event.payload)).type);}catch{}}));
 await Promise.all([page.goto('/groups'),second.goto('/groups')]);
 await expect(page.getByText('● 실시간 연결',{exact:true})).toBeVisible();await expect(second.getByText('● 실시간 연결',{exact:true})).toBeVisible();
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:testInfo.outputPath('group-lobby-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'시험 시작',exact:true}).click();const began=Date.now();await page.getByRole('button',{name:'지금 시작',exact:true}).click();
 await expect(page).toHaveURL(/\/groups\/exams\//);await expect(page.locator('main strong').filter({hasText:/^5$/})).toBeVisible();const startViewMs=Date.now()-began;await expect(second.getByRole('button',{name:'시험 전용 화면 열기'})).toBeVisible({timeout:4_000});
 await expect(page.getByRole('radio')).toHaveCount(5,{timeout:10_000});await expect(page.getByText('● 실시간 연결',{exact:true})).toBeVisible();
 await page.getByRole('radio').nth(1).check();const advancing=Date.now();await page.getByRole('button',{name:/다음 문항/}).click();await expect(page.getByRole('heading',{name:'2번 문항',exact:true})).toBeVisible();const advanceViewMs=Date.now()-advancing;await testInfo.attach('local-interaction-latency',{body:JSON.stringify({startViewMs,advanceViewMs,environment:'isolated local preview'}),contentType:'application/json'});expect(advanceViewMs).toBeLessThan(1500);
 expect(frames).toContain('response');
 for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const labels=page.getByRole('radio').locator('..').locator('span:last-child');const lefts=await labels.evaluateAll(es=>es.map(e=>Math.round(e.getBoundingClientRect().left)));expect(new Set(lefts).size).toBe(1);
  if(width!==320)await page.screenshot({path:testInfo.outputPath(`group-runner-${width}.png`),fullPage:true});}
 await other.close();
});
