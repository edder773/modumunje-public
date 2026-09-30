import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {request as httpRequest} from 'node:http';
const origin=process.env.GROUP_REALTIME_ORIGIN??'http://127.0.0.1:4173';
if(!origin.startsWith('http://127.0.0.1:'))throw new Error('This integration test only uses isolated local preview data');
const secret='baeumzip-local-e2e-google-session-secret-v1';
function cookie(email){const now=Math.floor(Date.now()/1000);const value=Buffer.from(JSON.stringify({v:1,sub:email,email,name:'Synthetic tester',iat:now,exp:now+3600})).toString('base64url');return 'baeumzip-google-session='+value+'.'+createHmac('sha256',secret).update(value).digest('base64url');}
async function post(email,body){const r=await fetch(origin+'/api/group-exams',{method:'POST',headers:{origin,cookie:cookie(email),'content-type':'application/json','x-sql-study-user-request':'1'},body:JSON.stringify({idempotencyKey:randomUUID(),...body})});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;}
function open(email,groupId){return new Promise((resolve,reject)=>{const socket=new WebSocket(origin.replace('http:','ws:')+'/api/group-exams/realtime?groupId='+groupId,{headers:{origin,cookie:cookie(email)}});const frames=[];const waiting=[];
 const heartbeat=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ping'}));},1_000);socket.on('close',()=>clearInterval(heartbeat));
 const collect=data=>{const frame=JSON.parse(String(data));frames.push(frame);for(const entry of [...waiting])if(entry.match(frame)){waiting.splice(waiting.indexOf(entry),1);clearTimeout(entry.timer);entry.resolve(frame);}};
 socket.on('message',collect);socket.on('error',reject);
 const wait=match=>{const existing=frames.find(match);if(existing)return Promise.resolve(existing);return new Promise((resolve,reject)=>{const entry={match,resolve,timer:setTimeout(()=>reject(new Error('WebSocket frame timeout')),10_000)};waiting.push(entry);});};
 wait(f=>f.type==='ready').then(()=>resolve({socket,frames,wait,rpc:async(body,path='/api/group-exams',method='POST')=>{const id=randomUUID();socket.send(JSON.stringify({type:'request',id,path,method,body,idempotencyKey:body?.idempotencyKey}));return wait(f=>f.type==='response'&&f.id===id);}}),reject);
 });}
async function rejected(headers){return new Promise((resolve,reject)=>{
 // Vite's upgrade proxy discards non-101 bodies. A regular HTTP request with
 // Upgrade tests the Worker's rejection status without that proxy behavior.
 const req=httpRequest(origin+'/api/group-exams/realtime?groupId=missing',{headers:{...headers,upgrade:'websocket',connection:'close'}},res=>{resolve(res.statusCode);res.resume();});req.on('error',reject);req.end();
});}
const owner=`socket-owner-${randomUUID()}@example.test`,peer=`socket-peer-${randomUUID()}@example.test`;
assert.equal(await rejected({origin,'x-baeumzip-authenticated-user-email':owner}),401);
assert.equal(await rejected({origin:'https://cross-origin.example.test',cookie:cookie(owner)}),403);
const made=await post(owner,{action:'group-create',name:'실시간 검증 그룹',publicName:'대표'});const groupId=made.group.id;
const invited=await post(owner,{action:'invite-create',groupId});await post(peer,{action:'invite-accept',token:invited.invite.token,publicName:'참가자'});
const a=await open(owner,groupId),b=await open(peer,groupId);
try{
 const started=await a.rpc({action:'run-start',mode:'immediate',groupId,idempotencyKey:randomUUID()});assert.equal(started.status,201,JSON.stringify(started));const runId=started.body.run.id;
 await b.wait(f=>f.type==='invalidate');
 const state=await b.rpc(null,`/api/group-exams?scope=sync&groupId=${groupId}`,'GET');assert.equal(state.body.run.id,runId);
 await new Promise(resolve=>setTimeout(resolve,5_200));
 const current=await b.rpc(null,`/api/group-exams?scope=current&runId=${runId}`,'GET');assert.equal(current.status,200,JSON.stringify(current));assert.match(current.body.question.prompt_snapshot,/개인학습 검증 문항/);assert.doesNotMatch(JSON.stringify(current.body),/SYNTHETIC_PRIVATE_EXPLANATION|correct_answers/);
 const body={action:'question-advance',runId,position:0,answers:[1],expectedAnswerRevision:0,expectedProgressRevision:current.body.progress.revision,idempotencyKey:randomUUID()};
 const first=await b.rpc(body);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.body.position,1);
 const replay=await b.rpc(body);assert.deepEqual(replay.body,first.body);
 const forbidden=await b.rpc({action:'settings-update',groupId:'some-other-group',idempotencyKey:randomUUID()});assert.equal(forbidden.status,403);
 console.log(JSON.stringify({passed:true,transport:'real WebSocketPair upgrade',twoParticipants:true,startPush:true,personalDbQuestions:true,answerAck:true,idempotentReplay:true,forgedIdentityRejected:true,crossOriginRejected:true,roomBoundaryRejected:true}));
}finally{a.socket.close();b.socket.close();}
