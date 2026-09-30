import { googleUserFromRequest } from "@backend/common/auth/google-session";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "@shared/auth/authenticated-user";
import { GET,POST } from "./group-exam.service";
import { getD1 } from "@backend/infrastructure/database";
import { withD1Metrics } from "@backend/common/observability/d1-metrics";

type WorkerSocket = WebSocket & { accept():void };
const Pair = (globalThis as unknown as { WebSocketPair:new()=>{0:WorkerSocket;1:WorkerSocket} }).WebSocketPair;

type Client = { socket:WebSocket; groupId:string; runId:string; closed:boolean; invalidate:()=>void };
// Ordinary Workers cannot perform I/O on another request's socket. Each
// authenticated connection reads a small D1 revision via its own heartbeat;
// full exam payloads travel only on RPC or a changed revision.
const connectionCounts=new Map<string,number>();
const json = (body:unknown,status:number)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});

async function authenticatedCall(original:Request,path:string,method:string,body:unknown,idempotencyKey?:string) {
  const user = await googleUserFromRequest(original);
  if (!user) return json({error:"로그인이 필요합니다.",code:"AUTHENTICATION_REQUIRED"},401);
  const headers=new Headers(original.headers);
  headers.delete("upgrade");headers.delete("connection");headers.delete(AUTHENTICATED_USER_EMAIL_HEADER);
  headers.set(AUTHENTICATED_USER_EMAIL_HEADER,user.email);headers.set("x-sql-study-user-request","1");
  headers.set("content-type","application/json");
  if(idempotencyKey)headers.set("idempotency-key",idempotencyKey);
  const request=new Request(new URL(path,original.url),{method,headers,...(method==="POST"?{body:JSON.stringify(body)}:{})});
  return withD1Metrics(()=>method==="POST"?POST(request):GET(request),{request});
}
function send(client:Client,value:unknown){if(!client.closed)try{client.socket.send(JSON.stringify(value));}catch{close(client);}}
function close(client:Client){if(client.closed)return;client.closed=true;try{client.socket.close(1000,"reconnect");}catch{/* already closed */}
  const count=(connectionCounts.get(client.groupId)??1)-1;if(count>0)connectionCounts.set(client.groupId,count);else connectionCounts.delete(client.groupId);}
async function revision(groupId:string){
  return JSON.stringify(await getD1().prepare(`SELECT g.revision,g.status,r.id AS run_id,r.revision AS run_revision,r.status AS run_status
    FROM study_groups g LEFT JOIN study_group_active_runs active ON active.group_id=g.id
    LEFT JOIN study_group_exam_runs r ON r.id=active.run_id WHERE g.id=?`).bind(groupId).first());
}

export async function handleGroupExamWebSocket(request:Request):Promise<Response>{
  if(request.method!=="GET"||request.headers.get("upgrade")?.toLowerCase()!=="websocket")return json({error:"WebSocket 연결이 필요합니다."},426);
  const url=new URL(request.url);
  if(request.headers.get("origin")!==url.origin)return json({error:"연결 출처를 확인해 주세요."},403);
  const requestedGroup=url.searchParams.get("groupId")??"";const runId=url.searchParams.get("runId")??"";
  if((!requestedGroup&&!runId)||requestedGroup.length>100||runId.length>100)return json({error:"시험 연결 정보를 확인해 주세요."},400);
  const path=runId?`/api/group-exams?scope=current&runId=${encodeURIComponent(runId)}`:`/api/group-exams?scope=sync&groupId=${encodeURIComponent(requestedGroup)}`;
  const checked=await authenticatedCall(request,path,"GET",null);if(!checked.ok)return checked;
  const initial=await checked.json() as {run?:{groupId?:string;group_id?:string}};
  const groupId=requestedGroup||String(initial.run?.groupId??initial.run?.group_id??"");
  if(!groupId)return json({error:"그룹 정보를 확인할 수 없습니다."},403);
  if((connectionCounts.get(groupId)??0)>=100)return json({error:"연결이 많습니다. 잠시 후 다시 시도해 주세요."},429);
  const [peer,socket]=Object.values(new Pair());socket.accept();
  let busy=false;let pingBusy=false;let version=await revision(groupId);let received=0;let windowAt=Date.now();
  const client:Client={socket,groupId,runId,closed:false,invalidate:()=>send(client,{type:"invalidate",groupId})};
  connectionCounts.set(groupId,(connectionCounts.get(groupId)??0)+1);
  // Rotate connections so cookie expiry/account revocation cannot leave long-lived authority.
  const expiresAt=Date.now()+10*60*1000;
  const lifetime=setTimeout(()=>close(client),10*60*1000);
  const cleanup=()=>{clearTimeout(lifetime);close(client);};
  socket.addEventListener("close",cleanup);socket.addEventListener("error",cleanup);
  socket.addEventListener("message",async event=>{
    if(client.closed)return;
    if(Date.now()>=expiresAt){cleanup();return;}
    if(Date.now()-windowAt>=60000){windowAt=Date.now();received=0;}
    if(++received>480){socket.close(1008,"rate limit");cleanup();return;}
    if(typeof event.data!=="string"||event.data.length>32768){socket.close(1009,"message too large");cleanup();return;}
    let frame:{type?:string;id?:string;path?:string;method?:string;body?:Record<string,unknown>;idempotencyKey?:string};try{frame=JSON.parse(event.data);}catch{return;}
    if(frame.type==="ping"){
      if(pingBusy)return;pingBusy=true;
      try{const next=await revision(groupId);if(next!==version){version=next;client.invalidate();}send(client,{type:"pong",serverNow:new Date().toISOString()});}
      catch{send(client,{type:"reconnect"});cleanup();}finally{pingBusy=false;}return;
    }
    const id=String(frame.id??"");
    if(frame.type!=="request"||!/^[a-zA-Z0-9-]{1,80}$/u.test(id))return;
    if(busy){send(client,{type:"response",id,status:429,body:{error:"이전 요청을 확인 중입니다."}});return;}
    let target:URL;try{target=new URL(String(frame.path??""),request.url);}catch{send(client,{type:"response",id,status:400,body:{error:"요청 주소가 올바르지 않습니다."}});return;}const method=String(frame.method??"GET");
    const scope=target.searchParams.get("scope")??"";const body=frame.body;
    if(target.origin!==url.origin||target.pathname!=="/api/group-exams"||!["GET","POST"].includes(method)
      ||method==="GET"&&!new Set(["lobby","groups","group","sync","current","result"]).has(scope)
      ||(target.searchParams.get("groupId")&&target.searchParams.get("groupId")!==groupId)
      ||(runId&&target.searchParams.get("runId")&&target.searchParams.get("runId")!==runId)
      ||(body?.groupId&&body.groupId!==groupId)||(runId&&body?.runId&&body.runId!==runId)){
      send(client,{type:"response",id,status:403,body:{error:"이 연결에서 처리할 수 없는 요청입니다."}});return;
    }
    busy=true;try{
      const response=await authenticatedCall(request,target.pathname+target.search,method,body,String(frame.idempotencyKey??""));
      const result=await response.json();send(client,{type:"response",id,status:response.status,body:result});
      if(response.status===401||response.status===403){cleanup();return;}
      if(response.ok&&method==="POST"&&body?.action!=="presence-heartbeat")client.invalidate();
    }catch{send(client,{type:"response",id,status:503,body:{error:"시험 상태를 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요."}});}finally{busy=false;}
  });
  send(client,{type:"ready",groupId,runId,serverNow:new Date().toISOString()});
  return new Response(null,{status:101,webSocket:peer} as ResponseInit & {webSocket:WorkerSocket});
}
