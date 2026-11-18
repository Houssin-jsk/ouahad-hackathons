import { z } from "zod";
export type EmailEnvironment={
  EMAIL_DELIVERY_MODE?:string; EMAIL_PUBLIC_ENABLED?:string; EMAIL_MAILBOX_TEST_VERIFIED?:string;
  EMAIL_FROM?:string; RESEND_API_KEY?:string; EMAIL_ENCRYPTION_KEY?:string; EMAIL_OWNER_ADDRESSES?:string; EMAIL_SMOKE_ALLOWED?:string;
};
export type ResendConfig={mode:"resend";apiKey:string;encryptionKey:string;from:string;publicEnabled:boolean;ownerAddresses:string[];ownerOnly?:boolean};
export function resendConfig(env:EmailEnvironment):ResendConfig|null{
  if(env.EMAIL_DELIVERY_MODE!=="resend")return null;
  try{
    const from=env.EMAIL_FROM??"",match=/^(?:[^<>\r\n]+ <([^<>\s]+@notify\.ouahad\.space)>|([^<>\s]+@notify\.ouahad\.space))$/.exec(from);
    if(!match||!z.email().safeParse(match[1]??match[2]).success||!env.RESEND_API_KEY?.trim()||/[\r\n]/.test(env.RESEND_API_KEY))return null;
    if(!/^[A-Za-z0-9_-]{43}$/.test(env.EMAIL_ENCRYPTION_KEY??""))return null;
    const ownerAddresses=(env.EMAIL_OWNER_ADDRESSES??"").split(",").map((v)=>v.trim().toLowerCase()).filter(Boolean);
    if(ownerAddresses.some((v)=>!z.email().safeParse(v).success))return null;
    return {mode:"resend",apiKey:env.RESEND_API_KEY!,encryptionKey:env.EMAIL_ENCRYPTION_KEY!,from,
      publicEnabled:env.EMAIL_PUBLIC_ENABLED==="true"&&env.EMAIL_MAILBOX_TEST_VERIFIED==="true",ownerAddresses};
  }catch{return null;}
}
