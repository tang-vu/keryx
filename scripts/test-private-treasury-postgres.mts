import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

// Isolated disposable PostgreSQL. No host ports/volumes/network or application env files.
const name = `keryx-treasury-test-${Date.now()}`;
const binary = process.platform === "win32" ? "wsl.exe" : "docker";
const prefix = process.platform === "win32" ? ["-d", "Ubuntu", "--", "docker"] : [];
const docker = (args: string[], input?: string) => execFileSync(binary, [...prefix, ...args],
  { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const sql = (input: string) => docker(["exec", "-i", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A"], input);
const concurrent = (input: string) => new Promise<string>((resolve, reject) => {
  const child = execFile(binary, [...prefix, "exec", "-i", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A"],
    { encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout));
  child.stdin!.end(`set role service_role; begin; ${input}; select pg_sleep(0.25); commit;`);
});
const payer = "'0x'||repeat('1',40)", signer = "'0x'||repeat('2',40)", worker = "'11111111-1111-4111-8111-111111111111'";
const job = (digit: string) => `'prv_'||repeat('${digit}',64)`;
const flags = (results: string[]) => results.flatMap(row => row.split(/\s+/).filter(v => v === "t" || v === "f")).sort().join(",");
let started = false;
try {
  docker(["run", "-d", "--name", name, "--network", "none", "--memory", "256m", "--cpus", "1",
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]); started = true;
  for (let retry = 0; ; retry++) {
    try { docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); break; }
    catch {
      if (retry === 60) {
        console.error(docker(["logs", "--tail", "25", name]));
        throw new Error("PostgreSQL unavailable");
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  const migrations = readdirSync("supabase/migrations").filter(file => /\.sql$/.test(file) && Number(file.slice(0, 4)) >= 46 && Number(file.slice(0, 4)) <= 60).sort();
  sql("create role anon; create role authenticated; create role service_role bypassrls;\n" +
    migrations.map(file => readFileSync(`supabase/migrations/${file}`, "utf8")).join("\n") + "\n" +
    readFileSync("scripts/check-private-treasury-release.sql", "utf8"));
  const release = `select public.release_private_treasury(${job("a")},${payer},${signer})`;
  if (flags(await Promise.all([concurrent(release), concurrent(release)])) !== "f,t") throw new Error("Duplicate release race failed");
  const reserve = (digit: string) => `select public.reserve_private_treasury(${job(digit)},${payer},${signer},50000)`;
  if (flags(await Promise.all([concurrent(reserve("b")), concurrent(reserve("c"))])) !== "f,t") throw new Error("Capacity race failed");
  sql(`set role service_role; do $$ declare s record; begin
    select * into s from public.private_treasury_summary(${signer});
    if s.allocated <> '47000' or s.committed <> '17000' or s.confirmed <> '0' or s.invalid <> '0' then raise exception 'summary mismatch'; end if;
    if (select amount_micros from public.private_treasury_releases where job_id=${job("a")}) <> 13000 then raise exception 'wrong release'; end if;
    if not public.reserve_private_treasury(${job("a")},${payer},${signer},50000) then raise exception 'original replay failed'; end if;
    if not public.reserve_private_treasury(${job("d")},${payer},'0x'||repeat('4',40),50000) then raise exception 'second pool denied'; end if;
  end $$;`);
  // Result sealing competes with creator admission on the execution row. Either ordering
  // is valid, but released + admitted must equal the original budget and no late leg enters.
  const seal = `select public.save_private_research_result(${job("d")},${payer},${worker},'{}'); select public.release_private_treasury(${job("d")},${payer},'0x'||repeat('4',40))`;
  const admit = `select public.admit_private_creator_submission(${job("d")},${payer},${worker},repeat('4',64),'0x'||repeat('4',64),10000,
    jsonb_build_object('submission',jsonb_build_object('authorizationId','0x'||repeat('4',64),'amountMicros','10000','payer','0x'||repeat('4',40))))`;
  await Promise.all([concurrent(seal), concurrent(admit)]);
  sql(`do $$ begin
    if (select amount_micros from public.private_treasury_releases where job_id=${job("d")}) +
      (select coalesce(sum(amount_micros),0) from public.private_creator_submissions where job_id=${job("d")}) <> 30000 then raise exception 'seal/admit release mismatch'; end if;
  end $$;`);
  if (flags([await concurrent(admit)]) !== "f") throw new Error("Late creator admission allowed");
  console.log("PASS: PostgreSQL 17 migrations, private permissions, unsealed/foreign denial, duplicate release, capacity contention, result-seal/admission race and pending-spend retention. Synthetic unfunded data only.");
} finally { if (started) docker(["rm", "-f", name]); }
