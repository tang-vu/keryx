import { expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Python's fixed CLI is Linux-only. Pure binding/decision and pipe-control logic
// run on both hosts; the same collector is separately qualified on real Linux.
const python = process.platform === "win32" ? "python" : "python3";
const script = resolve("scripts/profile-public-origin.py");
const harness = String.raw`
import copy,importlib.util,json,sys,types,unittest.mock as mock
spec=importlib.util.spec_from_file_location('diagnostic',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
if not hasattr(m.os,'sysconf'):m.os.sysconf=lambda key:4096 if key=='SC_PAGE_SIZE' else 100
S='a'*40;root='/root/.local/share/keryx-releases/'+S+'/source/'
prefix=['-i','PATH=/usr/bin:/bin','NODE_ENV=production','KERYX_DECISION_BRIEF=0','KERYX_COMMIT='+S]
web=['/usr/bin/node','--env-file=/root/keryx/.env.local',root+'scripts/next-immutable-server.mjs','--port','3939']
worker=['/usr/bin/node','--env-file=/root/keryx/.env.local','--import',root+'node_modules/tsx/dist/loader.mjs',root+'scripts/a2a-research-worker.mts']
config={'apps':[{'name':name,'script':'/usr/bin/env','interpreter':'none','cwd':'/root/keryx','args':prefix+cmd} for name,cmd in [('keryx',web),('keryx-a2a-worker',worker)]]}
args=types.SimpleNamespace(source=S,config='/root/.local/share/keryx-private-release-archives/fixture/roles.json',config_sha256='b'*64,web_pid=31,worker_pid=32,daemon_pid=30,web_start=200,worker_start=100,daemon_start=50,profile=True)
commands=m.role_commands(config,S)
facts={k:{'pid':pid,'start':start,'parent':30,'uid':[0]*4,'exe':[1,2],'state':'S','cwd':'/root/keryx','argv':cmd,'environment':{'PATH':'/usr/bin:/bin','NODE_ENV':'production','KERYX_COMMIT':S,'KERYX_DECISION_BRIEF':'0'},'ticks':1000,'rss':4096} for k,pid,start,cmd in [('web',31,200,web),('worker',32,100,worker),('daemon',30,50,[])]}
case=sys.argv[2];refused=False
if case.startswith('binding:'):
 tag=case.split(':')[1]
 if tag=='parent':facts['web']['parent']=99
 elif tag=='start':facts['web']['start']=201
 elif tag=='worker-start':facts['worker']['start']=101
 elif tag=='uid':facts['web']['uid']=[1000]*4
 elif tag=='exe':facts['web']['exe']=[9,9]
 elif tag=='state':facts['web']['state']='Z'
 elif tag=='cwd':facts['worker']['cwd']='/other'
 elif tag=='argv':facts['web']['argv']=web+['--inspect']
 elif tag=='environment':facts['web']['environment']['KERYX_COMMIT']='c'*40
 elif tag=='daemon':args.daemon_pid=99
 elif tag=='duplicate':args.worker_pid=args.web_pid
 try:m.verify_facts(args,commands,facts,30,[1,2])
 except m.Refused:refused=True
 assert refused
elif case.startswith('config:'):
 tag=case.split(':')[1]
 if tag=='extra':config['apps'].append(copy.deepcopy(config['apps'][0]))
 elif tag=='duplicate':config['apps'][1]['name']='keryx'
 elif tag=='source':config['apps'][0]['args'][-3]=root.replace(S,'c'*40)+'scripts/next-immutable-server.mjs'
 elif tag=='shell':config['apps'][0]['script']='/bin/sh'
 elif tag=='cwd':config['apps'][1]['cwd']='/other'
 elif tag=='args':config['apps'][0]['args'].append('--inspect')
 elif tag=='shape':config=[]
 try:m.role_commands(config,S)
 except m.Refused:refused=True
 assert refused
elif case=='valid-binding':
 out=m.verify_facts(args,commands,facts,30,[1,2]);assert set(out)=={'web','worker','daemon'} and out['web']['pid']==31 and 'argv' not in out['web']
elif case=='stat':
 fields=['S']+['0']*21;fields[1]='30';fields[11]='120';fields[12]='3';fields[19]='200';fields[21]='4'
 out=m.stat_fields('31 (name with ) parentheses) '+' '.join(fields));assert out['parent']==30 and out['ticks']==123 and out['start']==200 and out['rss']==4*m.os.sysconf('SC_PAGE_SIZE')
elif case=='curl':
 with mock.patch.object(m.subprocess,'run',return_value=types.SimpleNamespace(stdout=b'200 0.123',stderr=b'',returncode=0)) as run:
  assert m.probe_http()=={'status':200,'seconds':0.123,'exitCode':0}
  cmd=run.call_args.args[0];assert cmd[:2]==['/usr/bin/curl','--disable'] and cmd[-1]=='http://127.0.0.1:3939/api/health'
  assert 'Host: keryx.cc' in cmd and 'X-Forwarded-Proto: https' in cmd and '--location' not in cmd and '/dev/null' in cmd and run.call_args.kwargs['timeout']==3
elif case.startswith('observe:'):
 tag=case.split(':')[1];calls=[];snaps=[]
 def snapshot(_):
  if tag=='pre-refusal':raise m.Refused('role-binding')
  out=m.verify_facts(args,commands,facts,30,[1,2]);out['web']['ticks']+=len(snaps)*(0 if tag=='idle' else m.os.sysconf('SC_CLK_TCK'))
  if tag=='post-refusal' and len(snaps)==2:raise m.Refused('process-binding')
  snaps.append(out);return out
 def record(cmd):
  calls.append(cmd)
  return {'data':b'PERFILE2fixture','returncode':1 if tag=='failed' else 0,'stopReason':'helper-output-bound' if tag=='bounded' else None,'helperClosed':True}
 if tag=='check':args.profile=False
 http={'status':200 if tag=='healthy' else 421 if tag=='421' else 0 if tag=='timeout' else 503,'seconds':0.1,'exitCode':28 if tag=='timeout' else 0}
 clock=iter([0.0,1.0]);meta,data,rc=m.observe(args,snapshot=snapshot,probe=lambda:http,recorder=record,sleeper=lambda _:None,clock=lambda:next(clock))
 if tag in ['healthy','idle','check']:assert rc==0 and not data and not calls and not meta['captured']
 elif tag in ['421','pre-refusal']:assert rc==1 and not data and not calls
 elif tag in ['failed','bounded','post-refusal']:assert rc==1 and data==b'PERFILE2fixture' and len(calls)==1 and not meta['captured']
 else:
  assert rc==0 and meta['captured'] and len(calls)==1 and data==b'PERFILE2fixture'
  cmd=calls[0];assert cmd[0]=='/usr/bin/perf' and cmd[cmd.index('-p')+1]=='31' and cmd[-2:]==['/usr/bin/sleep','2'] and 'fp,32' in cmd and '-B' in cmd and '-N' in cmd
  assert not any(x in cmd for x in ['--user-regs','--kcore','--all-cpus','--inspect'])
elif case.startswith('pipes:'):
 tag=case.split(':')[1]
 class Pipe:
  def __init__(self,fd):self.fd=fd;self.closed=False
  def fileno(self):return self.fd
  def close(self):self.closed=True
 class Child:
  pid=2211;returncode=None
  def __init__(self):self.stdout=Pipe(10);self.stderr=Pipe(11)
  def poll(self):return self.returncode
  def wait(self,timeout):self.returncode=0 if self.returncode is None else self.returncode;return self.returncode
  def terminate(self):self.returncode=-15
  def kill(self):self.returncode=-9
 child=Child();chunks={10:[b'PERFILE2'+(b'x'*100 if tag=='stdout' else b''),b''],11:[b'y'*100 if tag=='stderr' else b'',b'']}
 class Selector:
  def __init__(self):self.items={}
  def __enter__(self):return self
  def __exit__(self,*_):pass
  def register(self,file,events,data):self.items[file.fd]=types.SimpleNamespace(fd=file.fd,fileobj=file,data=data)
  def unregister(self,file):del self.items[file.fd]
  def get_map(self):return self.items
  def select(self,_):return [(x,1) for x in list(self.items.values())]
 signals=[]
 def killpg(pid,sig):signals.append((pid,sig));child.returncode=-int(sig)
 with mock.patch.object(m.subprocess,'Popen',return_value=child) as launch,mock.patch.object(m.selectors,'DefaultSelector',Selector),mock.patch.object(m.os,'read',lambda fd,_:chunks[fd].pop(0)),mock.patch.object(m.os,'getpgid',lambda pid:2211,create=True),mock.patch.object(m.os,'killpg',killpg,create=True):
  out=m.collect_child(m.perf_command(31),max_data=16,max_log=16)
 assert child.stdout.closed and child.stderr.closed and out['helperClosed'] and launch.call_args.kwargs['start_new_session'] is True
 if tag=='ok':assert out['returncode']==0 and out['data']==b'PERFILE2' and not signals
 else:assert out['stopReason']=='helper-output-bound' and signals and all(pid==2211 for pid,sig in signals) and len(out['data'])<=16 and len(out['stderr'])<=16
else:raise AssertionError('unknown test case')
print(json.dumps({'case':case,'passed':True}))
`;

const cases = ["valid-binding", "stat", "curl",
  ...["parent", "start", "worker-start", "uid", "exe", "state", "cwd", "argv", "environment", "daemon", "duplicate"].map(value => `binding:${value}`),
  ...["extra", "duplicate", "source", "shell", "cwd", "args", "shape"].map(value => `config:${value}`),
  ...["check", "healthy", "idle", "421", "pre-refusal", "failed", "bounded", "post-refusal", "capture", "timeout"].map(value => `observe:${value}`),
  ...["ok", "stdout", "stderr"].map(value => `pipes:${value}`)];

it.each(cases)("pins native diagnostic policy and owned cleanup: %s", name => {
  const result = JSON.parse(execFileSync(python, ["-I", "-B", "-c", harness, script, name], { encoding: "utf8", timeout: 5_000, windowsHide: true }));
  expect(result).toEqual({ case: name, passed: true });
});
it("refuses invalid CLI identity before reading target/config or launching helpers", () => {
  const result = spawnSync(python, ["-I", "-B", script, "--source", "invalid"], { encoding: "utf8", timeout: 5_000, windowsHide: true });
  expect(result.status).toBe(2); expect(result.stdout).toBe(""); expect(result.stderr).toContain("required");
});
