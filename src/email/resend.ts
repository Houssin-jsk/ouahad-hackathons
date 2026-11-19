import type { ResendConfig } from "./config.ts";
export type Mail={from:string;to:string[];subject:string;text:string;html?:string};
export type SendResult={state:"provider_accepted";providerId:string}|{state:"retry_wait"|"quota_wait"|"failed";code:string;retryAfterSeconds?:number;ambiguous?:boolean};
export async function sendResend(config:ResendConfig,key:string,mail:Mail,{fetcher=fetch,timeoutMs=8000}:{fetcher?:typeof fetch;timeoutMs?:number}={}):Promise<SendResult>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    // Fixed provider URL and no redirects: never forward the secret to a redirected endpoint.
    const response=await fetcher("https://api.resend.com/emails",{method:"POST",redirect:"manual",signal:controller.signal,
      headers:{Authorization:"Bearer "+config.apiKey,"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(mail)});
    const reader=response.body?.getReader();let body="",size=0;
    if(reader)try{const decoder=new TextDecoder();while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384)throw new Error();body+=decoder.decode(part.value,{stream:true});}}finally{await reader.cancel();}
    let data:{id?:unknown;name?:unknown}={};try{data=JSON.parse(body);}catch{/* Provider body is never logged or returned. */}
    if(response.ok&&typeof data.id==="string"&&/^[\w-]{1,150}$/.test(data.id))return {state:"provider_accepted",providerId:data.id};
    if(data.name==="daily_quota_exceeded"||data.name==="monthly_quota_exceeded")return {state:"quota_wait",code:data.name};
    const retry=response.headers.get("retry-after"),seconds=retry?Number(retry):NaN;
    const retryAfterSeconds=Number.isFinite(seconds)&&seconds>=0?Math.min(seconds,86400):retry?Math.max(1,Math.min(86400,(Date.parse(retry)-Date.now())/1000)):undefined;
    if(response.status===429||response.status>=500||response.status===408||response.status===409&&data.name==="concurrent_idempotent_requests")return {state:"retry_wait",code:response.status===429?"rate_limit":"provider_transient",...(response.status!==429?{ambiguous:true}:{}),...(Number.isFinite(retryAfterSeconds)?{retryAfterSeconds}:{} )};
    return {state:response.ok?"retry_wait":"failed",code:response.ok?"invalid_provider_response":[401,403].includes(response.status)?"provider_configuration":"provider_rejected",...(response.ok?{ambiguous:true}:{})};
  }catch{return {state:"retry_wait",code:"network_or_timeout",ambiguous:true};}
  finally{clearTimeout(timer);}
}
