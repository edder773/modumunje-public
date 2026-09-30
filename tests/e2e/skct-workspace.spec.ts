/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic JSON payloads are checked by concrete field and behavior assertions. */
import { test,expect } from "@playwright/test";
const units=["언어이해","자료해석","창의수리","언어추리","수열추리"].map((name,index)=>({id:`U0${index+1}`,name}));
const item=(position:number)=>({position,sourceItemId:`TOY_${position}`,selectedIndex:null as number|null,finalized:false,elapsedSeconds:0,
  question:{sourceItemId:`TOY_${position}`,unitId:`U0${Math.floor((position-1)/20)+1}`,passage:"검증용 창작 지문입니다. 여러 줄에서도 선택지 본문의 시작 위치가 일정한지 확인합니다.",
    question:`${position}번 검증 문항에서 같은 조건을 고르세요.`,stimulus:null,conditions:[],insertionSentence:null,judgmentItems:[],choiceHasSourceLabel:[false,true,false,true,false],
    displayChoices:["① 줄바꿈이 없는 첫 번째 선택지","② 길이가 긴 두 번째 선택지입니다. 좁은 화면에서 여러 줄로 줄바꿈되어도 번호와 본문의 정렬을 유지해야 합니다.","3. 세 번째 선택지","④ 네 번째 선택지","5) 다섯 번째 선택지"],assetUrls:[]},feedback:undefined as any});
const base=(mode:"practice"|"mock",count:number)=>({id:`workspace-${mode}`,releaseId:"synthetic",unitId:"U01",mode,status:"in_progress" as string,revision:0,activePosition:1 as number|null,activeSince:new Date().toISOString(),startedAt:new Date().toISOString(),submittedAt:null,items:Array.from({length:count},(_,i)=>item(i+1)),correctCount:null,fullMock:undefined as any});
async function home(page:any){await page.route("**/api/skct-personal?view=home",(r:any)=>r.fulfill({json:{available:true,units}}));}
test("bare practice ignores stale stored attempts; fresh practice renders aligned choices one at a time",async({page},testInfo)=>{
  let a=base("practice",1);let oldReads=0;
  await home(page);
  await page.addInitScript(()=>sessionStorage.setItem("skct-personal-current-attempt-v3:practice","old-unrelated-attempt"));
  await page.route("**/api/skct-personal?view=attempt**",r=>{oldReads++;return r.fulfill({status:404,json:{error:"old"}});});
  await page.route("**/api/skct-personal",r=>{const body=r.request().postDataJSON();
    if(body.action==="start"){expect(body.fresh).toBe(true);expect(body.practiceFlowVersion).toBe(3);expect(body.operationId).toBeTruthy();}
    if(body.action==="answer"){a={...a,revision:a.revision+1,activePosition:null,items:a.items.map(q=>({...q,selectedIndex:body.choiceIndex,finalized:true,feedback:{answerIndex:1,correct:true,explanation:"검증용 해설입니다.",distractorExplanations:{}}}))};}
    if(body.action==="append"){a={...a,revision:a.revision+1,activePosition:2,items:[...a.items,item(2)]};expect(body.practiceFlowVersion).toBe(3);}
    return r.fulfill({json:{attempt:a}});
  });
  await page.goto("/learn/skct-personal/practice");await expect(page.getByRole("heading",{name:"문제 풀이 · 영역 선택"})).toBeVisible();expect(oldReads).toBe(0);
  await page.getByRole("button",{name:"문제 풀기",exact:true}).click();await expect(page.locator(".skct-current")).toHaveCount(1);
  await expect(page.getByRole("radio")).toHaveCount(5);await expect(page.locator(".skct-choice-text").first()).toHaveText("줄바꿈이 없는 첫 번째 선택지");
  await expect(page.locator(".skct-choice-label")).toHaveText(["①","②","③","④","⑤"]);
  for(const width of [1280,768,390,320]) {await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const lefts=await page.locator(".skct-choice-text").evaluateAll(es=>es.map(e=>Math.round(e.getBoundingClientRect().left)));expect(new Set(lefts).size).toBe(1);
    const dimensions=await page.locator(".skct-choice input").evaluateAll(es=>es.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));expect(dimensions.every(d=>d.width<25&&d.height<25)).toBe(true);
    if(width===1280||width===390){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:testInfo.outputPath(`single-question-${width}.png`),fullPage:true});}
  }
  await page.getByRole("radio").first().check();await page.getByRole("button",{name:"정답 확인",exact:true}).click();
  await expect(page.getByRole("region",{name:"채점 결과"})).toBeVisible();await page.getByRole("button",{name:"다음 문항",exact:true}).click();
  await expect(page.getByRole("heading",{name:"2번 문항",exact:true})).toBeVisible();await expect(page.locator(".skct-current")).not.toContainText("1번 검증 문항");
  await page.getByRole("button",{name:"이전 문항"}).click();await expect(page.getByRole("heading",{name:"1번 문항",exact:true})).toBeVisible();
});
test("full mock starts all five subjects, has a server timer, and confirms unanswered forward movement",async({page},testInfo)=>{
  let a=base("mock",100);a.fullMock={sectionIndex:0,phase:"answering",sectionDeadlineAt:new Date(Date.now()+900000).toISOString(),breakUntil:null,serverNow:new Date().toISOString()};
  await home(page);await page.route("**/api/skct-personal",r=>{const b=r.request().postDataJSON();
    if(b.action==="start")expect(b.unitId).toBe("ALL");
    if(b.action==="advance"){a.items[b.position-1]={...a.items[b.position-1],selectedIndex:b.choiceIndex??null,finalized:true};a={...a,revision:a.revision+1,activePosition:b.position+1};}
    return r.fulfill({json:{attempt:a}});
  });
  await page.goto("/learn/skct-personal/mock-exams");await expect(page.getByRole("heading",{name:"모의고사 · 전체 영역"})).toBeVisible();
  await expect(page.locator(".skct-full-outline li")).toHaveCount(5);await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.locator(".skct-mode-facts")).toContainText("총 100문항");
  await page.getByRole("button",{name:"모의고사 시작",exact:true}).click();
  await expect(page.getByRole("timer")).toBeVisible();await expect(page.locator(".skct-question-nav")).toHaveCount(0);
  await page.getByRole("button",{name:"다음 문항",exact:true}).click();const dialog=page.getByRole("dialog",{name:"미응답 문항 넘기기"});await expect(dialog).toBeVisible();
  await dialog.getByRole("button",{name:"미응답으로 넘기기"}).click();await expect(page.getByRole("heading",{name:"2번 문항",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"이전 문항"})).toHaveCount(0);
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:testInfo.outputPath("full-mock-desktop.png"),fullPage:true});
});
test("records show area accuracy with ungraded placeholders and denominator details",async({page},testInfo)=>{
  await page.route("**/api/skct-personal?view=records",r=>r.fulfill({json:{records:[],statistics:[{unit_id:"U01",attempts:2,graded_count:20,answered_count:18,correct_count:15,elapsed_seconds:360}],nextCursor:null}}));
  await page.goto("/learn/skct-personal/records");await expect(page.getByRole("heading",{name:"영역별 정답률"})).toBeVisible();
  await expect(page.getByRole("article",{name:"언어이해 학습 통계"})).toContainText("75%");await expect(page.getByRole("article",{name:"언어이해 학습 통계"})).toContainText("20초");
  await expect(page.getByRole("article",{name:"자료해석 학습 통계"})).toContainText("—");
  for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if(width!==320)await page.screenshot({path:testInfo.outputPath(`records-${width}.png`),fullPage:true});}
});
