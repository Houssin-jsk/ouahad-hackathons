import { copyFile,readFile,writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
try{
  await copyFile(".env.email.example",".env.email.local",1);
  const source=await readFile(".env.email.local","utf8");
  await writeFile(".env.email.local",source.replace(/^EMAIL_ENCRYPTION_KEY=$/m,"EMAIL_ENCRYPTION_KEY="+randomBytes(32).toString("base64url")));
  console.log("Created ignored .env.email.local with a server-only encryption key. Sending remains disabled. No secret values printed.");
}catch(error){if((error as NodeJS.ErrnoException).code==="EEXIST")console.log("Kept existing .env.email.local unchanged.");else throw error;}
