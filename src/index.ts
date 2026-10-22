interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  OWNER_TELEGRAM_ID?: string;
  WEBAPP_URL?: string;
}
type TelegramUser={id:number;first_name?:string;username?:string};
type Update={message?:{text?:string;chat:{id:number};from?:TelegramUser}};
type Actor={id:number;telegram_id:string};
function reply(value:unknown,status=200):Response{return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function html(s:string):string{return s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]||c))}
async function telegram(env:Env,method:string,body:Record<string,unknown>):Promise<void>{
  if(!env.TELEGRAM_BOT_TOKEN)throw Error("Telegram token is not configured");
  const r=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok)throw Error("Telegram API error "+r.status);
}
async function saveUser(env:Env,u:TelegramUser):Promise<Actor>{
  await env.DB.prepare("INSERT INTO users(telegram_id,username,first_name) VALUES(?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name")
    .bind(String(u.id),u.username??null,u.first_name??null).run();
  const user=await env.DB.prepare("SELECT id,telegram_id FROM users WHERE telegram_id=?").bind(String(u.id)).first<Actor>();
  if(!user)throw Error("Unable to save user");
  if(env.OWNER_TELEGRAM_ID===String(u.id)){
    await env.DB.prepare("INSERT INTO admins(user_id,is_owner,permissions_json) VALUES(?,1,'{}') ON CONFLICT(user_id) DO UPDATE SET is_owner=1").bind(user.id).run();
  }
  return user;
}
async function signedInitData(data:string,token:string):Promise<TelegramUser|null>{
  if(!data||!token)return null;
  const p=new URLSearchParams(data),hash=p.get("hash"),auth=Number(p.get("auth_date")||0);
  if(!hash||!/^[a-f0-9]{64}$/i.test(hash)||!auth||Math.abs(Date.now()/1000-auth)>86400)return null;
  p.delete("hash");p.delete("signature");
  const str=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+"="+v).join("\n");
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey("raw",enc.encode("WebAppData"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const secret=await crypto.subtle.sign("HMAC",key,enc.encode(token));
  const key2=await crypto.subtle.importKey("raw",secret,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key2,enc.encode(str)));
  const expected=Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
  let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^hash.toLowerCase().charCodeAt(i);
  if(diff!==0)return null;
  try{
    const user=JSON.parse(p.get("user")||"null") as TelegramUser|null;
    return user&&Number.isSafeInteger(user.id)&&user.id>0?user:null;
  }catch{return null}
}
async function actor(req:Request,env:Env):Promise<Actor|null>{
  const header=req.headers.get("authorization")||"";
  if(!header.startsWith("tma ")||!env.TELEGRAM_BOT_TOKEN)return null;
  const u=await signedInitData(header.slice(4),env.TELEGRAM_BOT_TOKEN);
  return u?saveUser(env,u):null;
}
async function canAdmin(env:Env,id:number,permission:string):Promise<boolean>{
  const row=await env.DB.prepare("SELECT is_owner,permissions_json FROM admins WHERE user_id=?").bind(id).first<{is_owner:number;permissions_json:string}>();
  if(!row)return false;
  if(row.is_owner===1)return true;
  try{const permissions=JSON.parse(row.permissions_json) as Record<string,boolean>;return permissions["*"]===true||permissions[permission]===true;}catch{return false}
}
async function handleWebhook(req:Request,env:Env):Promise<Response>{
  if(!env.TELEGRAM_WEBHOOK_SECRET||req.headers.get("x-telegram-bot-api-secret-token")!==env.TELEGRAM_WEBHOOK_SECRET)return new Response("unauthorized",{status:401});
  const update=await req.json() as Update;
  if(!update.message?.from)return new Response("ok");
  await saveUser(env,update.message.from);
  const msg=update.message,cmd=(msg.text||"").split(" ")[0];
  if(cmd==="/start"){
    const url=env.WEBAPP_URL;
    const validUrl=url&&url.startsWith("https://")&&!url.includes("replace-after-deploy");
    await telegram(env,"sendMessage",{chat_id:msg.chat.id,text:"👻 <b>BookGhost 2.0</b>\nКнижкові зустрічі, пригоди та події спільноти.",parse_mode:"HTML",...(validUrl?{reply_markup:{inline_keyboard:[[{text:"📚 Відкрити BookGhost",web_app:{url}}]]}}:{})});
  }else if(cmd==="/events"){
    const r=await env.DB.prepare("SELECT title,starts_at FROM events WHERE status='published' ORDER BY starts_at LIMIT 10").all<{title:string;starts_at:string|null}>();
    const lines=r.results.map(e=>"• "+html(e.title)+(e.starts_at?" · "+html(e.starts_at):""));
    await telegram(env,"sendMessage",{chat_id:msg.chat.id,text:lines.length?"📚 <b>Події</b>\n"+lines.join("\n"):"Подій поки немає 👻",parse_mode:"HTML"});
  }else if(cmd==="/help"){
    await telegram(env,"sendMessage",{chat_id:msg.chat.id,text:"/start · Головна\n/events · Події\n/help · Допомога"});
  }
  return new Response("ok");
}
async function routes(req:Request,env:Env):Promise<Response>{
 const url=new URL(req.url),path=url.pathname,method=req.method;
 if(path==="/api/health"&&method==="GET")return reply({ok:true,name:"BookGhost 2.0"});
 if(path==="/api/events"&&method==="GET"){
   const r=await env.DB.prepare("SELECT id,title,description,starts_at,location,registration_open,status FROM events WHERE status='published' ORDER BY starts_at IS NULL, starts_at").all();
   return reply({events:r.results});
 }
 const user=await actor(req,env);if(!user)return reply({error:"unauthorized"},401);
 if(path==="/api/me"&&method==="GET"){
   const admin=await canAdmin(env,user.id,"events.create");
   const r=await env.DB.prepare("SELECT r.status,e.id AS event_id,e.title FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.user_id=? ORDER BY r.id DESC").bind(user.id).all();
   return reply({user:{telegram_id:user.telegram_id},is_admin:admin,registrations:r.results});
 }
 if(path==="/api/admin/events"&&method==="GET"){
   if(!await canAdmin(env,user.id,"events.view"))return reply({error:"forbidden"},403);
   const r=await env.DB.prepare("SELECT id,title,description,status,starts_at,registration_open FROM events ORDER BY id DESC").all();return reply({events:r.results});
 }
 if(path==="/api/admin/events"&&method==="POST"){
   if(!await canAdmin(env,user.id,"events.create"))return reply({error:"forbidden"},403);
   const input=await req.json() as {title?:unknown;description?:unknown};
   if(typeof input.title!=="string"||!input.title.trim()||input.title.length>160)return reply({error:"invalid_title"},400);
   const desc=typeof input.description==="string"?input.description.slice(0,10000):"";
   const r=await env.DB.prepare("INSERT INTO events(title,description,created_by) VALUES(?,?,?)").bind(input.title.trim(),desc,user.id).run();
   return reply({ok:true,id:r.meta.last_row_id},201);
 }
 const edit=path.match(/^\/api\/admin\/events\/(\d+)$/);
 if(edit&&method==="PATCH"){
   if(!await canAdmin(env,user.id,"events.edit"))return reply({error:"forbidden"},403);
   const id=Number(edit[1]),input=await req.json() as {status?:unknown;registration_open?:unknown};
   if(input.status!=="published")return reply({error:"unsupported_change"},400);
   const r=await env.DB.prepare("UPDATE events SET status='published',registration_open=? WHERE id=? AND status='draft'").bind(input.registration_open===1?1:0,id).run();
   return r.meta.changes?reply({ok:true}):reply({error:"not_found_or_not_draft"},404);
 }
 const reg=path.match(/^\/api\/events\/(\d+)\/register$/);
 if(reg&&method==="POST"){
   const id=Number(reg[1]);
   // SQLite D1 batches guarantee statements are sequential but not an atomic capacity reservation.
   // Capacity handling must be hardened before high-volume production use.
   const e=await env.DB.prepare("SELECT id,participant_limit FROM events WHERE id=? AND status='published' AND registration_open=1").bind(id).first<{id:number;participant_limit:number|null}>();
   if(!e)return reply({error:"registration_closed"},409);
   const existing=await env.DB.prepare("SELECT status FROM registrations WHERE event_id=? AND user_id=?").bind(id,user.id).first<{status:string}>();
   if(existing?.status==="active")return reply({ok:true,already_registered:true});
   if(e.participant_limit!==null){
     const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id=? AND status='active'").bind(id).first<{n:number}>();
     if((count?.n||0)>=e.participant_limit)return reply({error:"event_full"},409);
   }
   await env.DB.prepare("INSERT INTO registrations(event_id,user_id,status) VALUES(?,?,'active') ON CONFLICT(event_id,user_id) DO UPDATE SET status='active'").bind(id,user.id).run();
   return reply({ok:true},201);
 }
 return reply({error:"not_found"},404);
}
export default {async fetch(req:Request,env:Env):Promise<Response>{
 try{const p=new URL(req.url).pathname;
   if(p==="/telegram/webhook")return req.method==="POST"?await handleWebhook(req,env):new Response("method not allowed",{status:405});
   if(p.startsWith("/api/"))return await routes(req,env);
   return env.ASSETS.fetch(req);
 }catch(err){console.error("BookGhost request failed",err instanceof Error?err.message:"unknown");return reply({error:"internal_error"},500);}
}};
