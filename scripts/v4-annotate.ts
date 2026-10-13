/**
 * Local room annotation tool.   npx tsx scripts/v4-annotate.ts [--port 4170] [--out private-fixtures]
 * Serves a page on http://127.0.0.1:<port> only. Images stay in your browser until you press "Save pack", which writes a
 * pack folder (git-ignored) on this machine. Nothing is uploaded anywhere.
 */
import path from "node:path";
import {createAnnotateServer} from "./v4-annotate-server";
const argv=process.argv.slice(2);
const val=(n:string)=>{const i=argv.indexOf(`--${n}`);return i>=0?argv[i+1]:undefined;};
const port=Number(val("port") ?? 4170),out=path.resolve(val("out") ?? "private-fixtures");
const s=createAnnotateServer({outRoot:out,port});
s.listen(port,"127.0.0.1",()=>console.log(`Room annotation tool: http://127.0.0.1:${port}  (packs are written to ${out})`));
