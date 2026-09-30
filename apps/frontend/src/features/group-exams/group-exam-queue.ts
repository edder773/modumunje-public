export type QueuedGroupExamMutation={
  queueId:string;runId:string;idempotencyKey:string;action:"answer-save"|"question-advance"|"run-submit";
  body:Record<string,unknown>;payloadDigest:string;createdAt:number;attemptCount:number;
  state:"pending"|"inflight"|"conflict";leaseOwner?:string;leaseUntil?:number;
};

const DB_NAME="modumunje-group-exam-v1";
const STORE="mutations";
const DRAFTS="drafts";
const openDb=()=>new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>{
    const db=request.result;
    if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:"queueId"}).createIndex("runId","runId");
    if(!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS,{keyPath:"key"});
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
});
const complete=(transaction:IDBTransaction)=>new Promise<void>((resolve,reject)=>{
  transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
});

export async function putQueue(item:QueuedGroupExamMutation){
  const db=await openDb();const tx=db.transaction(STORE,"readwrite");const store=tx.objectStore(STORE);const request=store.get(item.queueId);
  const result=await new Promise<{item:QueuedGroupExamMutation;inserted:boolean;conflict:boolean}>((resolve,reject)=>{request.onsuccess=()=>{const existing=request.result as QueuedGroupExamMutation|undefined;if(existing){resolve({item:existing,inserted:false,conflict:existing.payloadDigest!==item.payloadDigest||existing.idempotencyKey!==item.idempotencyKey});return;}store.add(item);resolve({item,inserted:true,conflict:false});};request.onerror=()=>reject(request.error);});
  await complete(tx);db.close();return result;
}
export async function getQueue(runId:string){const db=await openDb();const tx=db.transaction(STORE,"readonly");const request=tx.objectStore(STORE).index("runId").getAll(runId);const result=await new Promise<QueuedGroupExamMutation[]>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result as QueuedGroupExamMutation[]);request.onerror=()=>reject(request.error);});await complete(tx);db.close();return result.sort((a,b)=>a.createdAt-b.createdAt);}
export async function claimQueue(queueId:string,owner:string,now=Date.now()){
  const db=await openDb();const tx=db.transaction(STORE,"readwrite");const store=tx.objectStore(STORE);const request=store.get(queueId);
  const claimed=await new Promise<QueuedGroupExamMutation|null>((resolve,reject)=>{request.onsuccess=()=>{const item=request.result as QueuedGroupExamMutation|undefined;if(!item||item.state==="conflict"||(item.leaseUntil&&item.leaseUntil>now&&item.leaseOwner!==owner)){resolve(null);return;}const next={...item,state:"inflight" as const,leaseOwner:owner,leaseUntil:now+30_000,attemptCount:item.attemptCount+1};store.put(next);resolve(next);};request.onerror=()=>reject(request.error);});
  await complete(tx);db.close();return claimed;
}
export async function releaseQueue(queueId:string,state:"pending"|"conflict"="pending"){const db=await openDb();const tx=db.transaction(STORE,"readwrite");const store=tx.objectStore(STORE);const request=store.get(queueId);request.onsuccess=()=>{if(request.result)store.put({...request.result,state,leaseOwner:undefined,leaseUntil:undefined});};await complete(tx);db.close();}
export async function deleteQueue(queueId:string){const db=await openDb();const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(queueId);await complete(tx);db.close();}
export async function deleteQueueIfMatch(queueId:string,idempotencyKey:string,digest:string){
  const db=await openDb();const tx=db.transaction(STORE,"readwrite");const store=tx.objectStore(STORE);const request=store.get(queueId);
  const result=await new Promise<"deleted"|"missing"|"mismatch">((resolve,reject)=>{request.onsuccess=()=>{const item=request.result as QueuedGroupExamMutation|undefined;if(!item){resolve("missing");return;}if(item.idempotencyKey!==idempotencyKey||item.payloadDigest!==digest){resolve("mismatch");return;}store.delete(queueId);resolve("deleted");};request.onerror=()=>reject(request.error);});
  await complete(tx);db.close();return result;
}
export async function saveDraft(runId:string,position:number,answers:number[]){const db=await openDb();const tx=db.transaction(DRAFTS,"readwrite");tx.objectStore(DRAFTS).put({key:`${runId}:${position}`,runId,position,answers,updatedAt:Date.now()});await complete(tx);db.close();}
export async function loadDraft(runId:string,position:number){const db=await openDb();const tx=db.transaction(DRAFTS,"readonly");const request=tx.objectStore(DRAFTS).get(`${runId}:${position}`);const row=await new Promise<{answers:number[]}|undefined>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});await complete(tx);db.close();return row?.answers??null;}
export async function deleteDraft(runId:string,position:number){const db=await openDb();const tx=db.transaction(DRAFTS,"readwrite");tx.objectStore(DRAFTS).delete(`${runId}:${position}`);await complete(tx);db.close();}

export async function payloadDigest(body:Record<string,unknown>){const data=new TextEncoder().encode(JSON.stringify(body,Object.keys(body).sort()));const hash=await crypto.subtle.digest("SHA-256",data);return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");}
