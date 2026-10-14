/**
 * Hard stop in front of every paid call. Nothing paid may run unless ALL of these hold:
 *  - the owner explicitly authorised paid calls,
 *  - a spend cap is set and the per-call price (owner-verified from the vendor's page) is known,
 *  - the call would not push the total over the cap or over the call limit.
 */
export type SpendConfig={authorized:boolean;capUsd:number;pricePerCallUsd:number|null;maxCalls?:number};

export class SpendGuardError extends Error{
  constructor(public readonly code:"NOT_AUTHORIZED"|"NO_SPEND_CAP"|"PRICE_UNKNOWN"|"CAP_EXCEEDED"|"CALL_LIMIT",message:string){super(message);}
}

export class SpendGuard{
  private spent=0;private calls=0;
  constructor(private readonly cfg:SpendConfig){}
  /** Throws unless one more paid call is allowed; records it. Call immediately before the network request. */
  reserve():{spentUsd:number;remainingUsd:number}{
    const c=this.cfg;
    if(!c.authorized) throw new SpendGuardError("NOT_AUTHORIZED","Paid calls are not authorised (dry-run).");
    if(!(c.capUsd>0)||!Number.isFinite(c.capUsd)) throw new SpendGuardError("NO_SPEND_CAP","A positive spend cap is required.");
    if(c.pricePerCallUsd===null||!(c.pricePerCallUsd>0)||!Number.isFinite(c.pricePerCallUsd)) throw new SpendGuardError("PRICE_UNKNOWN","The per-call price has not been supplied, so the cost cannot be bounded.");
    if(this.calls>=(c.maxCalls ?? 1)) throw new SpendGuardError("CALL_LIMIT",`Call limit ${(c.maxCalls ?? 1)} reached.`);
    if(this.spent+c.pricePerCallUsd>c.capUsd+1e-12) throw new SpendGuardError("CAP_EXCEEDED",`Estimated $${c.pricePerCallUsd} would exceed the cap $${c.capUsd}.`);
    this.spent+=c.pricePerCallUsd;this.calls++;
    return {spentUsd:this.spent,remainingUsd:c.capUsd-this.spent};
  }
  get callsMade(){return this.calls;}
  get pricePerCallUsd(){return this.cfg.pricePerCallUsd;}
  get plannedSpendUsd(){return this.spent;}
}

/** Dry-run description of what the guard would decide, without reserving anything. */
export function describeSpend(cfg:SpendConfig):{wouldRun:boolean;reason:string}{
  try{new SpendGuard(cfg).reserve();return {wouldRun:true,reason:"all conditions met"};}
  catch(e){return {wouldRun:false,reason:e instanceof SpendGuardError?`${e.code}: ${e.message}`:String(e)};}
}
