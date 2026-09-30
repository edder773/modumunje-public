const allowed = new Set(["groups","group","sync","current","result","group-create","settings-update","invite-create","run-start","run-submit","answer-save","question-advance","presence-heartbeat"]);
const inFlight = new Map<string,number>();
export function beginGroupRequest(url:string, init?:RequestInit) {
  const scope = new URL(url,location.origin).searchParams.get("scope");
  let action:unknown;
  try { action=JSON.parse(String(init?.body ?? "{}")).action; } catch { action=undefined; }
  const candidate=String(action ?? scope ?? "other");const route=allowed.has(candidate)?candidate:"other";
  const overlap=inFlight.get(route)??0;inFlight.set(route,overlap+1);
  const started=performance.now();let headersAt=started;
  return {headers:()=>{headersAt=performance.now();},finish:(response?:Response)=>{
    inFlight.set(route,Math.max(0,(inFlight.get(route)??1)-1));
    // Local event only. An operator may collect aggregate timings during a controlled session.
    window.dispatchEvent(new CustomEvent("group-exam-metric",{detail:{route,visibility:document.visibilityState,
      wallMs:performance.now()-started,ttfbMs:headersAt-started,overlap,status:response?.status??0,
      transport:response?.headers.get("X-Group-Transport")??"http",queueMs:Number(response?.headers.get("X-Group-Queue-Ms")??0),
      roundtripMs:response?.headers.has("X-Group-Roundtrip-Ms")?Number(response.headers.get("X-Group-Roundtrip-Ms")):null,
      payloadBytes:Number(response?.headers.get("X-Group-Payload-Bytes")??0),serverTiming:response?.headers.get("Server-Timing")??null}}));
  }};
}
