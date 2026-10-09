/** Real Docker PG17 or explicitly owned empty loopback PG17 cluster; never a Docker shim. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";

export function browserPostgresFixture(argv: readonly string[]) {
  const name = `keryx-browser-${randomUUID()}`, database = `browser_native_${randomUUID().replaceAll("-", "")}`;
  let bin: string | undefined, port: string | undefined, cluster: string | undefined, ownedPid: number | undefined;
  if (argv.length) {
    assert.deepEqual([argv.length, argv[0], argv[2], argv[4]], [6, "--psql-bin", "--port", "--cluster-dir"]);
    assert(isAbsolute(argv[1]) && isAbsolute(argv[5])); bin = realpathSync(argv[1]); cluster = realpathSync(argv[5]);
    port = argv[3]; assert.match(port, /^[1-9]\d{3,4}$/); assert(Number(port) <= 65535);
  }
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec", "PATHEXT"])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { PGCONNECT_TIMEOUT: "3", PGSSLMODE: "disable", PGPASSFILE: join(tmpdir(), `${name}-no-password`),
    PGSERVICEFILE: join(tmpdir(), `${name}-no-service`), PGAPPNAME: name, TZ: "UTC" });
  const executable = (file: string) => join(bin!, process.platform === "win32" ? `${file}.exe` : file);
  const dockerBinary = process.platform === "win32" ? "wsl.exe" : "docker";
  const dockerPrefix = process.platform === "win32" ? ["-d", "Ubuntu", "--", "docker"] : [];
  const docker = (args: string[]) => execFileSync(dockerBinary, [...dockerPrefix, ...args], { env, encoding: "utf8", timeout: 30000, windowsHide: true });
  const client = (db = database) => {
    const args = ["-X", "-w", "-h", "127.0.0.1", ...(port ? ["-p", port] : []), "-U", "postgres", "-d", db, "-qAt", "-v", "ON_ERROR_STOP=1"];
    return bin ? { binary: executable("psql"), args } : { binary: dockerBinary, args: [...dockerPrefix, "exec", "-i", name, "psql", ...args] };
  };
  const sql = (input: string, db = database) => { const command = client(db); return execFileSync(command.binary, command.args,
    { input, env, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }).trim(); };
  const spawnClient = () => { const command = client(); return spawn(command.binary, command.args, { env, timeout: 20000, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); };
  const inspectPortable = () => {
    assert(cluster && port);
    const values = sql("select current_setting('data_directory'),current_setting('listen_addresses'),current_setting('port'),current_setting('server_version_num');", "postgres").split("|");
    assert.equal(realpathSync(values[0]), cluster); assert.equal(values[1], "127.0.0.1"); assert.equal(values[2], port);
    assert.equal(Math.floor(Number(values[3]) / 10000), 17);
    const pid = Number(readFileSync(join(cluster, "postmaster.pid"), "utf8").split("\n")[0]); assert(Number.isSafeInteger(pid) && pid > 0);
    if (ownedPid !== undefined) assert.equal(pid, ownedPid, "Explicit owned cluster process changed unexpectedly");
    ownedPid = pid;
  };
  const control = (operation: "restart" | "stop") => {
    inspectPortable();
    // Background PostgreSQL must not inherit a pipe whose EOF the caller waits for.
    const output = openSync(join(cluster!, `${name}-${operation}.stdout.log`), "wx"), error = openSync(join(cluster!, `${name}-${operation}.stderr.log`), "wx");
    try { execFileSync(executable("pg_ctl"), [operation, "-D", cluster!, "-m", "fast", "-w", "-t", "20"],
      { env, windowsHide: true, timeout: 30000, stdio: ["ignore", output, error] }); }
    finally { closeSync(output); closeSync(error); }
  };
  let started = false;
  const databases = new Set<string>();
  const createDatabase = (db: string) => { assert.match(db, /^[a-z][a-z0-9_]{1,62}$/); sql(`create database ${db};`, "postgres"); databases.add(db); };
  const ready = async () => {
    const deadline = Date.now() + 30000;
    for (;;) { try { assert.equal(sql("select 1;", "postgres"), "1"); return; }
      catch (cause) { assert(Date.now() < deadline, `Owned PostgreSQL unavailable: ${String(cause).slice(0, 128)}`); await new Promise(resolve => setTimeout(resolve, 100)); } }
  };
  return {
    database, sql, spawnClient, createDatabase,
    async start() {
      if (!bin) { docker(["info", "--format", "{{.ServerVersion}}"]); started = true;
        docker(["run", "-d", "--name", name, "--network", "none", "--memory", "256m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]); }
      await ready(); assert.match(sql("show server_version;", "postgres"), /^17\./);
      if (bin) {
        inspectPortable();
        assert.equal(sql("select count(*) from pg_database where datname not in ('postgres','template0','template1');", "postgres"), "0", "Portable fixture requires an explicitly owned empty cluster");
        assert.equal(sql("select count(*) from pg_roles where rolname in ('anon','authenticated','service_role');", "postgres"), "0", "Portable fixture requires fresh synthetic roles");
        started = true;
      }
      createDatabase(database);
    },
    async restart() {
      assert(started);
      if (bin) { const previous = ownedPid; control("restart"); ownedPid = undefined; await ready(); inspectPortable(); assert.notEqual(ownedPid, previous); }
      else { docker(["restart", name]); await ready(); }
    },
    close() {
      if (!started) return;
      if (!bin) { docker(["rm", "-f", "-v", name]); return; }
      inspectPortable();
      for (const db of databases) sql(`drop database ${db} with (force);`, "postgres");
      const previous = ownedPid!; control("stop");
      assert(!existsSync(join(cluster!, "postmaster.pid")), "Owned PostgreSQL master did not stop");
      assert.throws(() => process.kill(previous, 0), error => (error as NodeJS.ErrnoException).code === "ESRCH");
      console.log(JSON.stringify({ scope: "owned portable PostgreSQL fixture", data: cluster, port, stoppedMasterPid: previous, stopExitCode: 0 }));
    },
  };
}
