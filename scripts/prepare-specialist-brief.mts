/** Local request preparation. Never loads credentials, contacts a service or submits a job. */
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { prepareSpecialistBrief } from "../lib/research/specialist-briefs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: npm run research:brief -- --input brief.json\nFields: track (api-platform | saas-competition | scholarly-literature), decision, context, sourceLeads. Prints a prepared request and review checklist. No job, quote or payment is submitted.");
} else {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (args.length !== 2 || args[0] !== "--input") throw new Error("Invalid arguments");
    const inputPath = args[1];
    // Refuse direct remote/device paths before open can use ambient authentication.
    if (/^[a-z]+:\/\//i.test(inputPath) || inputPath === "-" || /^[a-z]:(?![\\/])/iu.test(inputPath)
        || /^[\\/]{2}|^[\\/]\?\?[\\/]/u.test(inputPath)
        || inputPath.split(/[\\/]/u).some(part => /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .:]|$)/iu.test(part))) {
      throw new Error("Local input path required");
    }
    file = await open(args[1], constants.O_RDONLY | constants.O_NONBLOCK);
    if (!(await file.stat()).isFile()) throw new Error("Regular input file required");
    const buffer = Buffer.alloc(8193);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > 8192) throw new Error("Oversized input");
    const value = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8").replace(/^\uFEFF/u, ""));
    console.log(JSON.stringify(prepareSpecialistBrief(value), null, 2));
  } catch {
    console.error("Brief refused. Use --help and supply a bounded JSON input with one shareable question and at most two HTTPS source links.");
    process.exitCode = 1;
  } finally { await file?.close(); }
}
