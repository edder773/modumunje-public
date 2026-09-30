export type GroupSocketStatus = "connecting" | "connected" | "offline";
type Options = { groupId?:string; runId?:string; onInvalidate:()=>void; onReady?:(current:Record<string,unknown>)=>void; onStatus:(status:GroupSocketStatus)=>void };
type Pending = { resolve:(response:Response)=>void; reject:(error:Error)=>void; timer:number; cleanup:()=>void; queuedAt:number; sentAt:number };
const sessions = new Set<GroupSocket>();
class GroupSocket {
  socket:WebSocket|null=null;
  ready=false;
  stopped=false;
  reconnect=0;
  heartbeat=0;
  failures=0;
  pending=new Map<string,Pending>();
  tail:Promise<unknown>=Promise.resolve();
  constructor(readonly options:Options){sessions.add(this);window.addEventListener("online",this.online);this.open();}
  online=()=>{if(!this.ready&&!this.stopped){window.clearTimeout(this.reconnect);this.open();}};
  open(){
    if(this.stopped)return;
    if(this.socket&&this.socket.readyState<2)return;
    this.options.onStatus(navigator.onLine?"connecting":"offline");
    const url=new URL("/api/group-exams/realtime",location.origin);url.protocol=location.protocol==="https:"?"wss:":"ws:";
    if(this.options.groupId)url.searchParams.set("groupId",this.options.groupId);
    if(this.options.runId)url.searchParams.set("runId",this.options.runId);
    const socket=new WebSocket(url);this.socket=socket;
    const opening=window.setTimeout(()=>{if(!this.ready)socket.close();},8_000);
    socket.onmessage=event=>{
      let frame:Record<string,unknown>;try{frame=JSON.parse(String(event.data));}catch{return;}
      if(frame.type==="ready"){
        window.clearTimeout(opening);this.ready=true;this.failures=0;this.options.onStatus("connected");
        this.heartbeat=window.setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:"ping"}));},1_000);
        if(this.options.onReady&&frame.current)this.options.onReady(frame.current as Record<string,unknown>);else this.options.onInvalidate();
      }else if(frame.type==="reconnect"){socket.close();}
      else if(frame.type==="invalidate"){this.options.onInvalidate();}
      else if(frame.type==="response"){
        const pending=this.pending.get(String(frame.id));if(!pending)return;
        this.pending.delete(String(frame.id));window.clearTimeout(pending.timer);pending.cleanup();
        const headers=new Headers({"Cache-Control":"no-store","X-Group-Transport":"websocket",
          "X-Group-Queue-Ms":String(pending.sentAt-pending.queuedAt),"X-Group-Roundtrip-Ms":String(performance.now()-pending.sentAt)});
        const metrics=frame.metrics as Record<string,unknown>|undefined;
        for(const name of ["server-timing","x-request-id","x-group-payload-bytes","x-group-db-ops","x-group-db-statements"]){
          const value=metrics?.[name];if(typeof value==="string"&&value.length<=4096)headers.set(name,value);
        }
        pending.resolve(Response.json(frame.body,{status:Number(frame.status),headers}));
      }
    };
    socket.onerror=()=>socket.close();
    socket.onclose=()=>{
      window.clearTimeout(opening);window.clearInterval(this.heartbeat);this.ready=false;
      for(const pending of this.pending.values()){window.clearTimeout(pending.timer);pending.cleanup();pending.reject(new TypeError("WebSocket disconnected"));}this.pending.clear();
      if(!this.stopped){this.options.onStatus(navigator.onLine?"connecting":"offline");this.reconnect=window.setTimeout(()=>this.open(),Math.min(5_000,500*2**this.failures++)+Math.random()*300);}
    };
  }
  matches(url:URL,body:Record<string,unknown>){
    const group=String(url.searchParams.get("groupId")??body.groupId??"");
    const run=String(url.searchParams.get("runId")??body.runId??"");
    return this.ready&&(!group||group===this.options.groupId)&&(!run||!this.options.runId||run===this.options.runId);
  }
  request(path:string,method:string,body:Record<string,unknown>,init?:RequestInit):Promise<Response>{
    // A connection serializes mutations and reads. Retry uses the caller's original operation key.
    const queuedAt=performance.now();
    const execute=()=>new Promise<Response>((resolve,reject)=>{
      if(init?.signal?.aborted){reject(init.signal.reason);return;}
      if(!this.ready||!this.socket){reject(new TypeError("WebSocket not ready"));return;}
      const id=crypto.randomUUID();
      const abort=()=>{const pending=this.pending.get(id);if(!pending)return;this.pending.delete(id);window.clearTimeout(pending.timer);pending.cleanup();reject(init?.signal?.reason??new TypeError("WebSocket aborted"));};
      const cleanup=()=>init?.signal?.removeEventListener("abort",abort);
      const timer=window.setTimeout(()=>{this.pending.delete(id);cleanup();reject(new TypeError("WebSocket response timeout"));this.socket?.close();},7_000);
      this.pending.set(id,{resolve,reject,timer,cleanup,queuedAt,sentAt:performance.now()});init?.signal?.addEventListener("abort",abort,{once:true});
      try{this.socket.send(JSON.stringify({type:"request",id,path,method,body,idempotencyKey:body.idempotencyKey??new Headers(init?.headers).get("idempotency-key")}));}catch{window.clearTimeout(timer);this.pending.delete(id);cleanup();reject(new TypeError("WebSocket send failed"));this.socket.close();}
    });
    if(method!=="POST"||body.action==="presence-heartbeat")return execute();
    const task=this.tail.catch(()=>undefined).then(execute);this.tail=task;return task;
  }
  stop(){this.stopped=true;sessions.delete(this);window.removeEventListener("online",this.online);window.clearTimeout(this.reconnect);window.clearInterval(this.heartbeat);this.socket?.close();}
}
export function connectGroupSocket(options:Options){const session=new GroupSocket(options);return ()=>session.stop();}
export function groupSocketRequest(path:string,init?:RequestInit):Promise<Response>|null{
  if(typeof window==="undefined")return null;
  const url=new URL(path,location.origin);if(url.origin!==location.origin||url.pathname!=="/api/group-exams")return null;
  let body:Record<string,unknown>={};try{if(typeof init?.body==="string")body=JSON.parse(init.body);}catch{return null;}
  const session=Array.from(sessions).find(value=>value.matches(url,body));
  return session?session.request(url.pathname+url.search,String(init?.method??"GET"),body,init):null;
}
