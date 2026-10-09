"use client";
import {useState} from "react";
import "./validation.css";

export default function Login(){
  const [pw,setPw]=useState(""),[err,setErr]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setErr("");
    try{
      const r=await fetch("/api/validation/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw})});
      if(r.ok){location.reload();return;}
      const j=await r.json().catch(()=>({}));setErr(j.error ?? "Could not sign in.");
    }catch{setErr("Network problem. Try again.");}
    setBusy(false);
  }
  return <div className="v3"><div className="vs-wrap" style={{maxWidth:420}}>
    <h1>Validation studio</h1><p className="vs-sub">Private test interface. Preview only.</p>
    <form className="vs-card" onSubmit={submit}>
      <label htmlFor="pw">Password</label>
      <input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e)=>setPw(e.target.value)} autoFocus/>
      {err&&<p className="vs-err" role="alert">{err}</p>}
      <p><button disabled={busy||!pw} type="submit">{busy?"Checking…":"Sign in"}</button></p>
    </form>
  </div></div>;
}
