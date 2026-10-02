import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
export function privateHeadlessTestDirectory() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"keryx-headless-state-"));
  if(process.platform==="win32")execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",`
$ErrorActionPreference='Stop';$id=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;
$a=New-Object System.Security.AccessControl.DirectorySecurity;$a.SetOwner($id);$a.SetAccessRuleProtection($true,$false);
$r=New-Object System.Security.AccessControl.FileSystemAccessRule($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow');
$a.AddAccessRule($r);Set-Acl -LiteralPath $env:KERYX_TEST_HEADLESS_DIRECTORY -AclObject $a`],
{windowsHide:true,timeout:5000,env:{...process.env,KERYX_TEST_HEADLESS_DIRECTORY:root}});
  else fs.chmodSync(root,0o700);
  return root;
}
