/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic JSON payloads are checked by concrete field and behavior assertions. */
import {writeFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';
import {createLocalGoogleStorageState} from './local-google-session';
test('two real participant browsers receive a shared start over WebSocket and save an answer',async({page,browser},testInfo)=>{
 const id=crypto.randomUUID();const owner=`browser-owner-${id}@example.test`,peer=`browser-peer-${id}@example.test`;
 const anonymous=await browser.newContext({storageState:{cookies:[],origins:[]}});const spoof=await anonymous.request.post('http://127.0.0.1:4173/api/group-exams',{headers:{origin:'http://127.0.0.1:4173','x-sql-study-user-request':'1','x-baeumzip-authenticated-user-email':owner},data:{action:'question-advance',runId:'forged-run',position:0,expectedProgressRevision:0}});expect(spoof.status(),await spoof.text()).toBe(401);await anonymous.close();
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
 await page.evaluate(()=>{const metrics:unknown[]=[];(window as any).__groupTimings=metrics;for(const name of ['group-exam-metric','group-exam-interaction'])window.addEventListener(name,e=>metrics.push({event:name,...(e as CustomEvent).detail}));});
 await page.getByLabel('풀이 메모',{exact:true}).fill('첫 번째 문항 메모');await page.getByRole('radio').nth(1).check();const advancing=Date.now();await page.getByRole('button',{name:/다음 문항/}).click();await expect(page.getByRole('heading',{name:'2번 문항',exact:true})).toBeVisible();const advanceViewMs=Date.now()-advancing;await expect(page.getByLabel('풀이 메모',{exact:true})).toHaveValue('');await testInfo.attach('local-interaction-latency',{body:JSON.stringify({startViewMs,advanceViewMs,environment:'isolated local preview'}),contentType:'application/json'});expect(advanceViewMs).toBeLessThan(1500);
 expect(frames).toContain('response');
 await expect(page.getByRole('radio').nth(1)).toBeEnabled();
 for(let number=3;number<=5;number++){await page.getByLabel('풀이 메모',{exact:true}).fill('문항 메모');await page.getByRole('radio').nth(1).check();await page.getByRole('button',{name:/다음 문항/}).click();await expect(page.getByRole('heading',{name:`${number}번 문항`,exact:true})).toBeVisible();await expect(page.getByLabel('풀이 메모',{exact:true})).toHaveValue('');await expect(page.getByRole('radio').nth(1)).toBeEnabled();}
 await expect.poll(()=>page.evaluate(()=>(window as any).__groupTimings.filter((m:any)=>m.kind==='next-view').length)).toBe(4);
 const timings=await page.evaluate(()=>(window as any).__groupTimings);const advances=timings.filter((m:any)=>m.route==='question-advance');expect(advances).toHaveLength(4);for(const metric of advances){expect(metric.transport).toBe('websocket');expect(metric.serverTiming).toContain('advance');expect(metric.roundtripMs).toBeGreaterThan(0);}await writeFile(testInfo.outputPath('local-websocket-timings.json'),JSON.stringify({environment:'isolated local preview',startViewMs,advanceViewMs,timings},null,2));
 for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const labels=page.getByRole('radio').locator('..').locator('span:last-child');const lefts=await labels.evaluateAll(es=>es.map(e=>Math.round(e.getBoundingClientRect().left)));expect(new Set(lefts).size).toBe(1);const gaps=await page.getByRole('radio').first().locator('..').evaluate(e=>{const spans=e.querySelectorAll('span');return spans[1].getBoundingClientRect().left-spans[0].getBoundingClientRect().right;});expect(gaps).toBeLessThanOrEqual(9);
  if(width!==320)await page.screenshot({path:testInfo.outputPath(`group-runner-${width}.png`),fullPage:true});}
 await page.getByRole('button',{name:'대기실',exact:true}).click();await expect(page.getByText('● 실시간 연결',{exact:true})).toBeVisible();const history=page.getByRole('region',{name:'날짜별 내 응시 기록'});await expect(history.getByRole('link',{name:'이어 풀기 →'})).toBeVisible();
 await page.getByRole('button',{name:'닉네임 변경'}).click();await page.getByRole('dialog').getByLabel('그룹 닉네임',{exact:true}).fill('새 대표 이름');await page.getByRole('dialog').getByRole('button',{name:'닉네임 저장'}).click();await expect(page.getByText('그룹 닉네임을 변경했습니다.')).toBeVisible();await expect(second.getByText(/새 대표 이름 \(대표\)/)).toBeVisible();
 const detail=await page.context().request.get(`http://127.0.0.1:4173/api/group-exams?scope=group&groupId=${groupId}`);const renamed=await detail.json();expect(renamed.group.public_name).toBe('새 대표 이름');
 await other.close();
});
