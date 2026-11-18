// Deliberate local fixture entrypoint; the Worker does not import this module.
import { startTestProvider } from "../test/support/oidc-provider.ts";
import { openLocalD1, migrate } from "./local-d1.ts";
import { importIntoD1 } from "./catalog-write.ts";
import { phase1Sources } from "./phase1-seed.ts";
import { listenCatalog } from "./web/server.ts";

async function main(){
  if(process.env.NODE_ENV!=="development") throw new Error("Set NODE_ENV=development to run this local test provider.");
  const d1=await openLocalD1(".local/d1-auth-test");
  let provider: Awaited<ReturnType<typeof startTestProvider>> | undefined;
  let app: Awaited<ReturnType<typeof listenCatalog>> | undefined;
  try {
    await migrate(d1.db);await importIntoD1(d1.db,await phase1Sources(),{seedOnly:true});
    provider=await startTestProvider(4181,"localhost");
    const port=Number(process.env.OUAHAD_PREVIEW_PORT ?? 4177);
    if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid preview port");
    app=await listenCatalog(d1.db,{port,authEnvironment:{AUTH_MODE:"test-provider",EMAIL_SIGNIN_MODE:"capture",TEST_OIDC_ISSUER:provider.issuer,
      TEST_OIDC_CLIENT_ID:"test-client",TEST_OIDC_CLIENT_SECRET:"test-secret"}});
    console.log(`TEST PROVIDER ONLY — no real Google verification. ${app.url}/my`);
    console.log("Test account One and Two; isolated .local/d1-auth-test; catalog seeds remain drafts.");
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;try{await app?.close();await provider?.close();}finally{await d1.close();}};
    process.on("SIGINT",()=>void stop());process.on("SIGTERM",()=>void stop());
  }catch(error){await app?.close();await provider?.close();await d1.close();throw error;}
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:"Local auth preview failed");process.exitCode=1;});
